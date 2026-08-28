import type { AppService } from './appService';
import type { AgentSessionService } from './agentSessionService';
import type { DeepSeekConfigService } from './deepSeekConfigService';
import { createAgentTools } from './agentTools';
import { PiAgentAdapter, type PiAdapterEvent, type PiAgentRunner } from './piAgentAdapter';
import type { AgentContextProvider } from './agentContext';
import type { MemoryService } from './memoryService';
import type {
  AgentRunEvent,
  AgentRunRequest,
  AgentRunSnapshot,
  AgentRunState,
  AgentSessionDetail,
  AgentSessionSummary
} from '../shared/agentContracts';

const RUN_TIMEOUT_MS = 3 * 60 * 1000;

const SYSTEM_PROMPT = `你是采办岛的原生采购任务 Agent。你可以读取本地任务并提出规划草稿或轻量操作提案。
严格规则：
1. 任何正式数据修改都只能调用 propose_* 工具生成待确认草稿；不能声称已经修改。
1a. 新建规划必须分类：需要多阶段推进、节点、截止或紧急程度的是采购项目 kind=task；单步骤、主要用于记录或到时提醒的是杂事 kind=misc。杂事不得包含节点。
2. propose_task_action 一次只能提出一个操作。允许节点四态、提醒，以及节点新增、修改、删除、重排。
3. 禁止修改任务名称、说明、deadline、紧急度；禁止完成、取消、归档、恢复或永久删除任务。
4. 禁止文件、shell、URL 请求和额外网络访问；不要索取或复述 API Key、Authorization 或本地绝对路径。
5. 只输出用户可见结论，不输出内部推理。信息不足时先使用只读工具核对。
6. 规划前可用 search_archived_cases 检索有限归档案例；它不是正式数据写入能力。
7. 用户要求修订某份待确认任务方案时，propose_task_draft 必须携带该方案的 replacesDraftId；新建独立任务时不要携带。`;

export class AgentRunError extends Error {}

interface ActiveRun {
  sessionId: string;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  promise: Promise<void>;
  timedOut: boolean;
  state: AgentRunState;
  startedAt: string;
  latestDraftId?: string;
  latestMemoryProposalId?: string;
}

export class AgentService {
  private active: ActiveRun | null = null;
  private surfaceVisible = false;
  private readonly contextCache = new Map<string, string>();

  constructor(
    private readonly appSvc: AppService,
    private readonly sessions: AgentSessionService,
    private readonly deepSeek: DeepSeekConfigService,
    private readonly emit: (event: AgentRunEvent) => void,
    private readonly runner: PiAgentRunner = new PiAgentAdapter(),
    private readonly memories?: MemoryService,
    private readonly contextProviders: AgentContextProvider[] = []
  ) {}

  start(request: AgentRunRequest): AgentSessionDetail {
    this.assertCanRun(request.input);
    this.deepSeek.apiKey();
    const session = this.sessions.create(this.deepSeek.model(), request.input);
    this.launch(session, request.input);
    return this.sessions.get(session.id);
  }

  send(request: AgentRunRequest): AgentSessionDetail {
    if (!request.sessionId) throw new AgentRunError('缺少会话 ID');
    this.assertCanRun(request.input);
    const detail = this.sessions.get(request.sessionId);
    this.launch(detail.session, request.input);
    return detail;
  }

  cancel(): boolean {
    if (!this.active) return false;
    this.active.state = 'cancelling';
    this.emit({ type: 'state', sessionId: this.active.sessionId, state: 'cancelling' });
    this.active.controller.abort();
    return true;
  }

  listSessions(): AgentSessionSummary[] { return this.sessions.list(); }
  getSession(id: string): AgentSessionDetail {
    const detail = this.sessions.get(id);
    this.contextCache.delete(id);
    return detail;
  }

  deleteSession(id: string): void {
    if (this.active?.sessionId === id) throw new AgentRunError('当前会话正在运行，请先取消');
    this.sessions.delete(id);
    this.contextCache.delete(id);
  }

  clearSessions(): number {
    if (this.active) throw new AgentRunError('Agent 正在运行，请先取消');
    const cleared = this.sessions.clear();
    this.contextCache.clear();
    return cleared;
  }

  exportSession(id: string, format: 'json' | 'markdown'): string { return this.sessions.export(id, format); }

  runSnapshot(): AgentRunSnapshot {
    if (!this.active) return { sessionId: null, state: 'idle', startedAt: null };
    return {
      sessionId: this.active.sessionId,
      state: this.active.state,
      startedAt: this.active.startedAt,
      latestDraftId: this.active.latestDraftId,
      latestMemoryProposalId: this.active.latestMemoryProposalId
    };
  }

  setSurfaceVisible(visible: boolean): void { this.surfaceVisible = visible; }
  isSurfaceVisible(): boolean { return this.surfaceVisible; }

  async waitForIdle(): Promise<void> {
    await this.active?.promise;
  }

  async dispose(): Promise<void> {
    this.cancel();
    await this.waitForIdle();
  }

  private assertCanRun(input: string): void {
    if (this.active) throw new AgentRunError('已有 Agent 任务正在运行');
    const trimmed = input.trim();
    if (!trimmed) throw new AgentRunError('请输入要处理的内容');
    if (trimmed.length > 12000) throw new AgentRunError('单条消息不能超过 12000 字符');
  }

  private launch(session: AgentSessionSummary, rawInput: string): void {
    const input = rawInput.trim();
    const key = this.deepSeek.apiKey();
    const existing = this.sessions.get(session.id).messages;
    const userMessage = this.sessions.append(session.id, 'user', input);
    this.emit({ type: 'message', sessionId: session.id, message: userMessage });
    const controller = new AbortController();
    const active: ActiveRun = {
      sessionId: session.id,
      controller,
      timedOut: false,
      state: 'running',
      startedAt: new Date().toISOString(),
      timer: setTimeout(() => {
        active.timedOut = true;
        controller.abort();
      }, RUN_TIMEOUT_MS),
      promise: Promise.resolve()
    };
    this.active = active;
    this.emit({ type: 'state', sessionId: session.id, state: 'running' });
    active.promise = this.execute(active, session, input, key, existing, userMessage).finally(() => {
      clearTimeout(active.timer);
      if (this.active === active) this.active = null;
    });
  }

  private async execute(
    active: ActiveRun,
    session: AgentSessionSummary,
    input: string,
    key: string,
    history: AgentSessionDetail['messages'],
    currentMessage: AgentSessionDetail['messages'][number]
  ): Promise<void> {
    try {
      const result = await this.runner.run({
        sessionId: session.id,
        input,
        history,
        model: session.model,
        apiKey: key,
        systemPrompt: this.systemPrompt(session.id, [...history, currentMessage]),
        tools: createAgentTools(this.appSvc, session.id, this.sessions, this.memories),
        signal: active.controller.signal,
        onEvent: (event) => this.handleRunnerEvent(session.id, event)
      });
      if (active.timedOut) {
        active.state = 'limit_reached';
        this.emit({ type: 'error', sessionId: session.id, message: '本次运行超过 3 分钟，输入和会话已保留，可重试', retryable: true });
        this.emit({ type: 'state', sessionId: session.id, state: 'limit_reached' });
      } else if (result === 'limit_reached') {
        active.state = 'limit_reached';
        this.emit({ type: 'error', sessionId: session.id, message: '已达到 12 个模型轮次上限，输入和会话已保留', retryable: true });
        this.emit({ type: 'state', sessionId: session.id, state: 'limit_reached' });
      } else {
        active.state = result === 'cancelled' ? 'cancelled' : 'completed';
        this.emit({ type: 'state', sessionId: session.id, state: active.state });
      }
    } catch (error) {
      active.state = 'error';
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ type: 'error', sessionId: session.id, message, retryable: true });
      this.emit({ type: 'state', sessionId: session.id, state: 'error' });
    }
  }

  private handleRunnerEvent(sessionId: string, event: PiAdapterEvent): void {
    if (event.type === 'text_delta') {
      this.emit({ type: 'text_delta', sessionId, delta: event.delta });
      return;
    }
    if (event.type === 'assistant_message') {
      const message = this.sessions.append(sessionId, 'assistant', event.text);
      this.sessions.addUsage(sessionId, event.inputTokens, event.outputTokens);
      this.emit({ type: 'message', sessionId, message });
      return;
    }
    if (event.type === 'tool_start') {
      this.emit({ type: 'tool_start', sessionId, toolCallId: event.toolCallId, toolName: event.toolName });
      return;
    }
    const label = event.isError ? '执行失败' : event.draftId ? '已生成待确认草稿' : event.memoryProposalId ? '已生成待审核记忆' : '读取完成';
    if (!event.isError && this.active?.sessionId === sessionId) {
      if (event.draftId) this.active.latestDraftId = event.draftId;
      if (event.memoryProposalId) this.active.latestMemoryProposalId = event.memoryProposalId;
    }
    const message = this.sessions.append(sessionId, 'tool', `${event.toolName}：${label}`, event.toolName);
    this.emit({ type: 'message', sessionId, message });
    this.emit({ type: 'tool_end', sessionId, toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError, draftId: event.draftId, memoryProposalId: event.memoryProposalId });
  }

  private systemPrompt(sessionId: string, messages: AgentSessionDetail['messages']): string {
    let context = this.contextCache.get(sessionId);
    if (context === undefined) {
      context = this.contextProviders.map((provider) => {
        const snapshot = provider.snapshot(sessionId);
        return `[上下文：${snapshot.id}]\n${snapshot.content}`;
      }).join('\n\n');
      this.contextCache.set(sessionId, context);
    }
    const evidence = messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-12)
      .map((message) => `- ${message.id}（${message.role}）：${message.content.replace(/\s+/g, ' ').slice(0, 120)}`)
      .join('\n');
    const pendingPlans = this.appSvc.drafts.listPending(sessionId)
      .filter((draft) => draft.payload.type === 'task')
      .map((draft) => `- draftId=${draft.id}：${JSON.stringify(draft.payload)}`)
      .join('\n');
    return `${SYSTEM_PROMPT}\n8. 长期记忆只能通过 propose_memory 提议并引用下列证据消息 ID；未确认提案不是事实。\n9. 需要召回旧会话时只能使用 search_sessions。\n\n${context}\n\n[当前会话待确认任务方案]\n${pendingPlans || '无'}\n\n[当前会话可引用证据]\n${evidence}`;
  }
}
