import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/main/db';
import { AppService } from '../src/main/appService';
import { AgentSessionService } from '../src/main/agentSessionService';
import { AgentActionService } from '../src/main/agentActionService';
import { AgentService } from '../src/main/agentService';
import { createAgentTools, AGENT_TOOL_NAMES } from '../src/main/agentTools';
import { DeepSeekConfigService } from '../src/main/deepSeekConfigService';
import type { SafeStorageAdapter } from '../src/main/mcpTokenVault';
import type { PiAgentRunner, PiRunOptions, PiRunResult } from '../src/main/piAgentAdapter';
import { PiAgentAdapter, visibleDeltaFromPiEvent } from '../src/main/piAgentAdapter';
import type { AgentRunEvent } from '../src/shared/agentContracts';

const dirs: string[] = [];

class FakeSafeStorage implements SafeStorageAdapter {
  isEncryptionAvailable(): boolean { return true; }
  encryptString(value: string): Buffer { return Buffer.from('encrypted:' + value); }
  decryptString(value: Buffer): string {
    const text = value.toString();
    if (!text.startsWith('encrypted:')) throw new Error('bad ciphertext');
    return text.slice(10);
  }
}

function fresh() {
  const dir = mkdtempSync(path.join(tmpdir(), 'caiban-agent-'));
  dirs.push(dir);
  const dbPath = path.join(dir, 'island.db');
  const db = openDatabase(dbPath);
  const app = new AppService(db, dir);
  const sessions = new AgentSessionService(db, dir);
  const deepSeek = new DeepSeekConfigService(app.settings, new FakeSafeStorage());
  deepSeek.save('deepseek-v4-flash', 'test-api-key');
  return { dir, dbPath, db, app, sessions, deepSeek };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

class CompletingRunner implements PiAgentRunner {
  lastOptions: PiRunOptions | null = null;
  constructor(private readonly result: PiRunResult = 'completed') {}
  async run(options: PiRunOptions): Promise<PiRunResult> {
    this.lastOptions = options;
    await options.onEvent({ type: 'text_delta', delta: '已完成' });
    await options.onEvent({ type: 'tool_start', toolCallId: 'tool-1', toolName: 'list_active_tasks' });
    await options.onEvent({ type: 'tool_end', toolCallId: 'tool-1', toolName: 'list_active_tasks', isError: false });
    await options.onEvent({ type: 'assistant_message', text: '这是用户可见结论', inputTokens: 11, outputTokens: 7 });
    return this.result;
  }
}

class BlockingRunner implements PiAgentRunner {
  async run(options: PiRunOptions): Promise<PiRunResult> {
    return await new Promise((resolve) => {
      if (options.signal.aborted) resolve('cancelled');
      else options.signal.addEventListener('abort', () => resolve('cancelled'), { once: true });
    });
  }
}

describe('P14 Agent 会话与 DeepSeek 配置', () => {
  it('数据库迁移 v2，完整会话可重启恢复、删除与导出', () => {
    const f = fresh();
    const session = f.sessions.create('deepseek-v4-flash', '规划电脑采购');
    f.sessions.append(session.id, 'user', '规划电脑采购');
    f.sessions.append(session.id, 'assistant', '先核对需求');
    const exported = f.sessions.export(session.id, 'json');
    expect(existsSync(exported)).toBe(true);
    expect(readFileSync(exported, 'utf8')).toContain('先核对需求');
    f.db.close();

    const reopened = openDatabase(f.dbPath);
    const restored = new AgentSessionService(reopened, f.dir).get(session.id);
    expect(restored.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    const version = reopened.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number };
    expect(version.version).toBe(2);
    const service = new AgentSessionService(reopened, f.dir);
    service.delete(session.id);
    expect(service.list()).toHaveLength(0);
    reopened.close();
  });

  it('用户可以一次清空全部本机会话', () => {
    const f = fresh();
    f.sessions.create('deepseek-v4-flash', '会话一');
    f.sessions.create('deepseek-v4-pro', '会话二');
    expect(f.sessions.clear()).toBe(2);
    expect(f.sessions.list()).toEqual([]);
  });

  it('DeepSeek Base URL 固定，模型仅允许 Flash/Pro，Key 只以密文保存', () => {
    const f = fresh();
    expect(f.deepSeek.status()).toEqual({ configured: true, baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' });
    expect(f.app.settings.get('deepseek_api_key_encrypted')).not.toContain('test-api-key');
    f.deepSeek.save('deepseek-v4-pro', '');
    expect(f.deepSeek.status().model).toBe('deepseek-v4-pro');
    expect(() => f.deepSeek.save('unsupported' as 'deepseek-v4-pro', '')).toThrow('不支持');
  });

  it('Agent 单次运行持久化可见消息与用量，且只暴露五个 allowlist 工具', async () => {
    const f = fresh();
    const events: AgentRunEvent[] = [];
    const runner = new CompletingRunner();
    const service = new AgentService(f.app, f.sessions, f.deepSeek, (event) => events.push(event), runner);
    const started = service.start({ input: '看看当前任务' });
    await service.waitForIdle();

    const detail = f.sessions.get(started.session.id);
    expect(detail.messages.map((message) => message.role)).toEqual(['user', 'tool', 'assistant']);
    expect(detail.messages.some((message) => message.content.includes('推理'))).toBe(false);
    expect(detail.session.inputTokens).toBe(11);
    expect(detail.session.outputTokens).toBe(7);
    expect(runner.lastOptions?.tools.map((tool) => tool.name)).toEqual(AGENT_TOOL_NAMES);
    expect(events.some((event) => event.type === 'state' && event.state === 'completed')).toBe(true);
  });

  it('全局只允许一个活跃 run，取消会中止 provider 并保留输入', async () => {
    const f = fresh();
    const events: AgentRunEvent[] = [];
    const service = new AgentService(f.app, f.sessions, f.deepSeek, (event) => events.push(event), new BlockingRunner());
    const started = service.start({ input: '持续规划' });
    expect(() => service.start({ input: '第二个运行' })).toThrow('已有 Agent 任务');
    expect(service.cancel()).toBe(true);
    await service.waitForIdle();
    expect(f.sessions.get(started.session.id).messages[0].content).toBe('持续规划');
    expect(events.some((event) => event.type === 'state' && event.state === 'cancelled')).toBe(true);
  });

  it('达到模型轮次上限时保留会话并发出可重试状态', async () => {
    const f = fresh();
    const events: AgentRunEvent[] = [];
    const service = new AgentService(f.app, f.sessions, f.deepSeek, (event) => events.push(event), new CompletingRunner('limit_reached'));
    service.start({ input: '复杂规划' });
    await service.waitForIdle();
    expect(events.some((event) => event.type === 'state' && event.state === 'limit_reached')).toBe(true);
    expect(events.some((event) => event.type === 'error' && event.retryable)).toBe(true);
  });
});

describe('P14 工具与轻量操作提案', () => {
  it('工具集不含文件、shell、URL 或正式写入工具', () => {
    const f = fresh();
    const names = createAgentTools(f.app, 'session-1').map((tool) => tool.name);
    expect(names).toEqual(AGENT_TOOL_NAMES);
    expect(names.some((name) => /(file|shell|url|archive|delete_task)/i.test(name))).toBe(false);
  });

  it('轻量操作确认前不生效，确认只执行一次', () => {
    const f = fresh();
    const task = f.app.createTask({ name: '采购', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    const node = f.app.addNode(task.id, { title: '询价', description: '', startUtc: null, endUtc: null });
    const actions = new AgentActionService(f.app);
    const draft = actions.propose({ taskId: task.id, sessionId: 'session-1', kind: 'set_node_status', nodeId: node.id, status: 'in_progress' });
    expect(f.app.tasks.getTaskDetail(task.id).nodes[0].status).toBe('pending');
    expect(() => f.app.drafts.updatePayload(draft.id, draft.payload)).toThrow('不可编辑');
    expect(f.app.confirmDraft(draft.id).type).toBe('action');
    expect(f.app.tasks.getTaskDetail(task.id).nodes[0].status).toBe('in_progress');
    expect(() => f.app.confirmDraft(draft.id)).toThrow('草稿已处理');
  });

  it('提案保存预期旧值，数据变化后拒绝覆盖并要求重新规划', () => {
    const f = fresh();
    const task = f.app.createTask({ name: '采购', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    const node = f.app.addNode(task.id, { title: '询价', description: '', startUtc: null, endUtc: null });
    const draft = new AgentActionService(f.app).propose({ taskId: task.id, sessionId: 'session-1', kind: 'set_node_status', nodeId: node.id, status: 'in_progress' });
    f.app.setNodeStatus(node.id, 'completed');
    expect(() => f.app.confirmDraft(draft.id)).toThrow('数据已变化');
    expect(f.app.tasks.getTaskDetail(task.id).nodes[0].status).toBe('completed');
    expect(f.app.drafts.get(draft.id).state).toBe('pending');
  });

  it('节点增改删排与提醒都只能生成单个 action 草稿', () => {
    const f = fresh();
    const task = f.app.createTask({ name: '采购', description: '', kind: 'task', urgency: 'normal', deadlineUtc: '2026-09-01T00:00:00.000Z', tzId: 'Asia/Shanghai' });
    const first = f.app.addNode(task.id, { title: '询价', description: '', startUtc: null, endUtc: null });
    const second = f.app.addNode(task.id, { title: '比价', description: '', startUtc: null, endUtc: null });
    const actions = new AgentActionService(f.app);
    const requests = [
      actions.propose({ taskId: task.id, sessionId: 's', kind: 'set_reminders', offsets: [60, 1440] }),
      actions.propose({ taskId: task.id, sessionId: 's', kind: 'add_node', node: { title: '比价', description: '', startUtc: null, endUtc: null } }),
      actions.propose({ taskId: task.id, sessionId: 's', kind: 'update_node', nodeId: first.id, node: { title: '正式询价', description: '', startUtc: null, endUtc: null } }),
      actions.propose({ taskId: task.id, sessionId: 's', kind: 'delete_node', nodeId: first.id }),
      actions.propose({ taskId: task.id, sessionId: 's', kind: 'reorder_nodes', orderedNodeIds: [second.id, first.id] })
    ];
    expect(requests.every((draft) => draft.payload.type === 'action')).toBe(true);
    expect(f.app.tasks.getTaskDetail(task.id).nodes).toHaveLength(2);
    expect(f.app.reminders.offsetsForTask(task.id)).toEqual([]);
  });
});

describe('Pi 事件可见性映射', () => {
  const assistant = {
    role: 'assistant' as const,
    content: [], api: 'openai-completions', provider: 'deepseek', model: 'deepseek-v4-flash',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop' as const, timestamp: Date.now()
  };

  it('只映射 text_delta，thinking_delta 永不展示', () => {
    const textEvent: AgentEvent = { type: 'message_update', message: assistant, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '可见', partial: assistant } };
    const thinkingEvent: AgentEvent = { type: 'message_update', message: assistant, assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: '内部推理', partial: assistant } };
    expect(visibleDeltaFromPiEvent(textEvent)).toBe('可见');
    expect(visibleDeltaFromPiEvent(thinkingEvent)).toBeNull();
  });

  it('Pi faux provider 完成真实多轮工具循环，不使用网络或真实 Key', async () => {
    const f = fresh();
    f.app.createTask({ name: '测试任务', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    const faux = fauxProvider({ provider: 'faux', models: [{ id: 'deepseek-v4-flash' }] });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('list_active_tasks', {}, { id: 'tool-list' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('已读取 1 个活跃任务')
    ]);
    const models = createModels();
    models.setProvider(faux.provider);
    const runtimeModel = models.getModel('faux', 'deepseek-v4-flash');
    if (!runtimeModel) throw new Error('faux model missing');
    const adapter = new PiAgentAdapter(() => ({ model: runtimeModel, streamFn: models.streamSimple.bind(models) }));
    const events: string[] = [];
    const result = await adapter.run({
      sessionId: 'faux-session', input: '读取任务', history: [], model: 'deepseek-v4-flash', apiKey: 'test-only',
      systemPrompt: '只使用提供的工具。', tools: createAgentTools(f.app, 'faux-session'), signal: new AbortController().signal,
      onEvent: (event) => { events.push(event.type); }
    });
    expect(result).toBe('completed');
    expect(faux.state.callCount).toBe(2);
    expect(events).toContain('tool_start');
    expect(events).toContain('tool_end');
    expect(events).toContain('assistant_message');
  });
});
