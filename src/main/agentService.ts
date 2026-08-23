import type { AppService } from './appService';
import type { AgentSessionService } from './agentSessionService';
import type { DeepSeekConfigService } from './deepSeekConfigService';
import { createAgentTools } from './agentTools';
import { PiAgentAdapter, type PiAdapterEvent, type PiAgentRunner } from './piAgentAdapter';
import type {
  AgentRunEvent,
  AgentRunRequest,
  AgentSessionDetail,
  AgentSessionSummary
} from '../shared/agentContracts';

const RUN_TIMEOUT_MS = 3 * 60 * 1000;

const SYSTEM_PROMPT = `你是采办岛的原生采购任务 Agent。你可以读取本地任务并提出规划草稿或轻量操作提案。
严格规则：
1. 任何正式数据修改都只能调用 propose_* 工具生成待确认草稿；不能声称已经修改。
2. propose_task_action 一次只能提出一个操作。允许节点四态、提醒，以及节点新增、修改、删除、重排。
3. 禁止修改任务名称、说明、deadline、紧急度；禁止完成、取消、归档、恢复或永久删除任务。
4. 禁止文件、shell、URL 请求和额外网络访问；不要索取或复述 API Key、Authorization 或本地绝对路径。
5. 只输出用户可见结论，不输出内部推理。信息不足时先使用只读工具核对。`;

export class AgentRunError extends Error {}

interface ActiveRun {
  sessionId: string;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  promise: Promise<void>;
  timedOut: boolean;
}

export class AgentService {
  private active: ActiveRun | null = null;

  constructor(
    private readonly appSvc: AppService,
    private readonly sessions: AgentSessionService,
    private readonly deepSeek: DeepSeekConfigService,
    private readonly emit: (event: AgentRunEvent) => void,
    private readonly runner: PiAgentRunner = new PiAgentAdapter()
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
    this.emit({ type: 'state', sessionId: this.active.sessionId, state: 'cancelling' });
    this.active.controller.abort();
    return true;
  }

  listSessions(): AgentSessionSummary[] { return this.sessions.list(); }
  getSession(id: string): AgentSessionDetail { return this.sessions.get(id); }

  deleteSession(id: string): void {
    if (this.active?.sessionId === id) throw new AgentRunError('当前会话正在运行，请先取消');
    this.sessions.delete(id);
  }

  clearSessions(): number {
    if (this.active) throw new AgentRunError('Agent 正在运行，请先取消');
    return this.sessions.clear();
  }

  exportSession(id: string, format: 'json' | 'markdown'): string { return this.sessions.export(id, format); }

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
      timer: setTimeout(() => {
        active.timedOut = true;
        controller.abort();
      }, RUN_TIMEOUT_MS),
      promise: Promise.resolve()
    };
    this.active = active;
    this.emit({ type: 'state', sessionId: session.id, state: 'running' });
    active.promise = this.execute(active, session, input, key, existing).finally(() => {
      clearTimeout(active.timer);
      if (this.active === active) this.active = null;
    });
  }

  private async execute(active: ActiveRun, session: AgentSessionSummary, input: string, key: string, history: AgentSessionDetail['messages']): Promise<void> {
    try {
      const result = await this.runner.run({
        sessionId: session.id,
        input,
        history,
        model: session.model,
        apiKey: key,
        systemPrompt: SYSTEM_PROMPT,
        tools: createAgentTools(this.appSvc, session.id),
        signal: active.controller.signal,
        onEvent: (event) => this.handleRunnerEvent(session.id, event)
      });
      if (active.timedOut) {
        this.emit({ type: 'error', sessionId: session.id, message: '本次运行超过 3 分钟，输入和会话已保留，可重试', retryable: true });
        this.emit({ type: 'state', sessionId: session.id, state: 'limit_reached' });
      } else if (result === 'limit_reached') {
        this.emit({ type: 'error', sessionId: session.id, message: '已达到 12 个模型轮次上限，输入和会话已保留', retryable: true });
        this.emit({ type: 'state', sessionId: session.id, state: 'limit_reached' });
      } else {
        this.emit({ type: 'state', sessionId: session.id, state: result === 'cancelled' ? 'cancelled' : 'completed' });
      }
    } catch (error) {
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
    const label = event.isError ? '执行失败' : event.draftId ? '已生成待确认草稿' : '读取完成';
    const message = this.sessions.append(sessionId, 'tool', `${event.toolName}：${label}`, event.toolName);
    this.emit({ type: 'message', sessionId, message });
    this.emit({ type: 'tool_end', sessionId, toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError, draftId: event.draftId });
  }
}
