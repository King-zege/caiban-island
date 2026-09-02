import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/main/db';
import { AppService } from '../src/main/appService';
import { AgentSessionService } from '../src/main/agentSessionService';
import { AgentService } from '../src/main/agentService';
import { createAgentTools } from '../src/main/agentTools';
import { AgentProviderConfigError, AgentProviderConfigService, normalizeEnterpriseBaseUrl } from '../src/main/agentProviderConfigService';
import { DeepSeekConfigService } from '../src/main/deepSeekConfigService';
import { MemoryService } from '../src/main/memoryService';
import type { SafeStorageAdapter } from '../src/main/safeStorageAdapter';
import type { PiAdapterEvent, PiAgentRunner, PiRunOptions, PiRunResult } from '../src/main/piAgentAdapter';
import { PiAgentAdapter, thinkingDeltaFromPiEvent, visibleDeltaFromPiEvent } from '../src/main/piAgentAdapter';
import type { AgentRunEvent } from '../src/shared/agentContracts';

const dirs: string[] = [];
class FakeSafeStorage implements SafeStorageAdapter {
  isEncryptionAvailable(): boolean { return true; }
  encryptString(value: string): Buffer { return Buffer.from('encrypted:' + value); }
  decryptString(value: Buffer): string { return value.toString().slice('encrypted:'.length); }
}
function fresh() {
  const dir = mkdtempSync(path.join(tmpdir(), 'caiban-agent-')); dirs.push(dir);
  const dbPath = path.join(dir, 'island.db'); const db = openDatabase(dbPath);
  const app = new AppService(db, dir); const sessions = new AgentSessionService(db, dir);
  const deepSeek = new DeepSeekConfigService(app.settings, new FakeSafeStorage());
  const memories = new MemoryService(db); deepSeek.save('deepseek-v4-flash', 'test-api-key');
  return { dir, dbPath, db, app, sessions, deepSeek, memories };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); for (const dir of dirs.splice(0)) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } } });

class CompletingRunner implements PiAgentRunner {
  lastOptions: PiRunOptions | null = null;
  constructor(private readonly result: PiRunResult = 'completed') {}
  async run(options: PiRunOptions): Promise<PiRunResult> {
    this.lastOptions = options;
    await options.onEvent({ type: 'thinking_delta', delta: '临时分析过程' });
    await options.onEvent({ type: 'text_delta', delta: '已完成' });
    await options.onEvent({ type: 'tool_start', toolCallId: 'tool-1', toolName: 'list_active_tasks' });
    await options.onEvent({ type: 'tool_end', toolCallId: 'tool-1', toolName: 'list_active_tasks', isError: false });
    await options.onEvent({ type: 'assistant_message', text: '这是用户可见结论', inputTokens: 11, outputTokens: 7 });
    return this.result;
  }
}
class BlockingRunner implements PiAgentRunner {
  async run(options: PiRunOptions): Promise<PiRunResult> {
    return new Promise((resolve) => options.signal.addEventListener('abort', () => resolve('cancelled'), { once: true }));
  }
}

describe('Agent 会话、事件与多 Provider 配置', () => {
  it('migration v7 后会话可恢复、删除与导出', () => {
    const f = fresh(); const session = f.sessions.create('deepseek-v4-flash', '规划电脑采购');
    f.sessions.append(session.id, 'user', '规划电脑采购'); f.sessions.append(session.id, 'assistant', '先核对需求');
    const exported = f.sessions.export(session.id, 'json');
    expect(existsSync(exported)).toBe(true); expect(readFileSync(exported, 'utf8')).toContain('先核对需求');
    expect(f.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({ version: 12 });
    f.sessions.delete(session.id); expect(f.sessions.list()).toEqual([]);
  });

  it('连接测试调用 /models，不发送对话正文，Key 只保存密文', async () => {
    const f = fresh();
    const fetchMock = vi.fn(async () => new Response('{"object":"list","data":[]}', { status: 200 }));
    const config = new DeepSeekConfigService(f.app.settings, new FakeSafeStorage(), fetchMock as typeof fetch);
    config.save('deepseek-v4-pro', 'temporary-test-key');
    expect(f.app.settings.get('deepseek_api_key_encrypted')).not.toContain('temporary-test-key');
    await expect(config.test()).resolves.toContain('200');
    expect(fetchMock).toHaveBeenCalledWith('https://api.deepseek.com/models', expect.objectContaining({ method: 'GET' }));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('ping');
  });

  it('企业网关保存自定义模型并规范化 Chat Completions 地址', () => {
    const f = fresh();
    const config = new AgentProviderConfigService(f.app.settings, new FakeSafeStorage());
    config.saveConfig({
      provider: 'enterprise',
      baseUrl: 'https://gateway.corp.example/v1/chat/completions/',
      model: 'anthropic/claude-enterprise-prod',
      apiKey: 'enterprise-secret'
    });

    expect(config.runtime()).toEqual({
      provider: 'enterprise',
      baseUrl: 'https://gateway.corp.example/v1',
      model: 'anthropic/claude-enterprise-prod',
      apiKey: 'enterprise-secret'
    });
    expect(f.app.settings.get('enterprise_api_key_encrypted')).not.toContain('enterprise-secret');
    expect(config.status()).toMatchObject({
      provider: 'enterprise',
      configured: true,
      configuredProviders: expect.arrayContaining(['deepseek', 'enterprise'])
    });
  });

  it('企业 Base URL 拒绝明文远程地址、嵌入凭据与查询参数', () => {
    expect(() => normalizeEnterpriseBaseUrl('http://gateway.corp.example/v1')).toThrow(AgentProviderConfigError);
    expect(() => normalizeEnterpriseBaseUrl('https://user:secret@gateway.corp.example/v1')).toThrow(AgentProviderConfigError);
    expect(() => normalizeEnterpriseBaseUrl('https://gateway.corp.example/v1?token=secret')).toThrow(AgentProviderConfigError);
    expect(normalizeEnterpriseBaseUrl('http://127.0.0.1:9000/v1/')).toBe('http://127.0.0.1:9000/v1');
  });

  it('系统加密不可用时不切换当前 Provider 或写入企业配置', () => {
    const f = fresh();
    const unavailableStorage: SafeStorageAdapter = {
      isEncryptionAvailable: () => false,
      encryptString: () => { throw new Error('should not encrypt'); },
      decryptString: () => { throw new Error('should not decrypt'); }
    };
    const config = new AgentProviderConfigService(f.app.settings, unavailableStorage);
    expect(() => config.saveConfig({
      provider: 'enterprise', baseUrl: 'https://gateway.corp.example/v1',
      model: 'openai/gpt-enterprise', apiKey: 'cannot-store'
    })).toThrow('系统加密不可用');
    expect(config.status()).toMatchObject({ provider: 'deepseek' });
    expect(f.app.settings.get('enterprise_base_url')).toBeNull();
  });

  it('企业网关连接测试只向选定模型发送固定最小消息', async () => {
    const f = fresh();
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response('{"choices":[]}', { status: 200 }));
    const config = new AgentProviderConfigService(f.app.settings, new FakeSafeStorage(), fetchMock as typeof fetch);
    config.saveConfig({
      provider: 'enterprise', baseUrl: 'https://gateway.corp.example/v1',
      model: 'openai/gpt-enterprise', apiKey: 'enterprise-test-key'
    });

    await expect(config.test()).resolves.toBe('连接成功（HTTP 200）');
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(requestUrl).toBe('https://gateway.corp.example/v1/chat/completions');
    expect(requestInit).toMatchObject({ method: 'POST' });
    expect((requestInit as RequestInit).headers).toMatchObject({ Authorization: 'Bearer enterprise-test-key' });
    const body = JSON.parse(String((requestInit as RequestInit).body)) as { model: string; messages: Array<{ content: string }> };
    expect(body).toMatchObject({ model: 'openai/gpt-enterprise', messages: [{ content: '仅回复 OK' }] });
    expect(JSON.stringify(body)).not.toContain('采购');
  });

  it('GLM 使用官方端点与模型白名单，独立保存 API Key', () => {
    const f = fresh();
    const config = new AgentProviderConfigService(f.app.settings, new FakeSafeStorage());
    config.saveConfig({
      provider: 'glm', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
      model: 'glm-5.2', apiKey: 'glm-secret'
    });
    expect(config.runtime()).toEqual({
      provider: 'glm', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
      model: 'glm-5.2', apiKey: 'glm-secret'
    });
    expect(() => config.saveConfig({
      provider: 'glm', baseUrl: 'https://untrusted.example/v4', model: 'glm-5.2', apiKey: ''
    })).toThrow('不支持的 GLM 服务地址');
    expect(() => config.saveConfig({
      provider: 'glm', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-unknown', apiKey: ''
    })).toThrow('不支持的 GLM 模型');
  });

  it('Agent run 将企业 Provider、Base URL 与模型传给运行时', async () => {
    const f = fresh(); const runner = new CompletingRunner();
    f.deepSeek.saveConfig({
      provider: 'enterprise', baseUrl: 'https://gateway.corp.example/v1',
      model: 'deepseek/analysis-pro', apiKey: 'corp-key'
    });
    const service = new AgentService(f.app, f.sessions, f.deepSeek, () => undefined, runner, f.memories);
    const started = service.start({ input: '检查企业模型连接' });
    await service.waitForIdle();

    expect(runner.lastOptions).toMatchObject({
      provider: 'enterprise', baseUrl: 'https://gateway.corp.example/v1',
      model: 'deepseek/analysis-pro', apiKey: 'corp-key'
    });
    expect(f.sessions.get(started.session.id).session.model).toBe('deepseek/analysis-pro');
  });

  it('main 为事件分配单调序号，并在终态快照保留可恢复状态', async () => {
    const f = fresh(); const events: AgentRunEvent[] = []; const runner = new CompletingRunner();
    const service = new AgentService(f.app, f.sessions, f.deepSeek, (event) => events.push(event), runner, f.memories);
    const started = service.start({ input: '看看当前任务' }); await service.waitForIdle();
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
    expect(events.some((event) => event.type === 'thinking_delta')).toBe(true);
    expect(f.sessions.get(started.session.id).messages.map((message) => message.role)).toEqual(['user', 'tool', 'assistant']);
    expect(JSON.stringify(f.sessions.get(started.session.id))).not.toContain('临时分析过程');
    expect(service.runSnapshot()).toMatchObject({ sessionId: started.session.id, state: 'completed', phase: 'completed', partialText: '', partialThinking: '', activeTool: null });
    expect(runner.lastOptions?.tools.map((tool) => tool.name)).toContain('execute_app_command');
    expect(runner.lastOptions?.systemPrompt).toContain('每轮只执行最新一条用户消息');
  });

  it('全局只允许一个 run，显式取消保留输入与取消终态', async () => {
    const f = fresh(); const service = new AgentService(f.app, f.sessions, f.deepSeek, () => undefined, new BlockingRunner(), f.memories);
    const started = service.start({ input: '持续规划' }); expect(() => service.start({ input: '第二个运行' })).toThrow('已有 Agent 任务');
    expect(service.cancel()).toBe(true); await service.waitForIdle();
    expect(f.sessions.get(started.session.id).messages[0].content).toBe('持续规划');
    expect(service.runSnapshot()).toMatchObject({ state: 'cancelled', phase: 'cancelled' });
  });

  it('整次运行超时后明确结束并保留可重试错误', async () => {
    vi.useFakeTimers();
    const f = fresh(); const service = new AgentService(f.app, f.sessions, f.deepSeek, () => undefined, new BlockingRunner(), f.memories);
    service.start({ input: '等待超时' });
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    await service.waitForIdle();
    expect(service.runSnapshot()).toMatchObject({ state: 'limit_reached', phase: 'error', error: { category: 'timeout', retryable: true } });
    vi.useRealTimers();
  });
});

describe('Pi 生产事件协议', () => {
  const assistant = {
    role: 'assistant' as const, content: [], api: 'openai-completions', provider: 'deepseek', model: 'deepseek-v4-flash',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop' as const, timestamp: Date.now()
  };
  it('将正文与临时思考流分离映射', () => {
    const textEvent: AgentEvent = { type: 'message_update', message: assistant, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '可见', partial: assistant } };
    const thinkingEvent: AgentEvent = { type: 'message_update', message: assistant, assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: '内部推理', partial: assistant } };
    expect(visibleDeltaFromPiEvent(textEvent)).toBe('可见'); expect(visibleDeltaFromPiEvent(thinkingEvent)).toBeNull();
    expect(thinkingDeltaFromPiEvent(textEvent)).toBeNull(); expect(thinkingDeltaFromPiEvent(thinkingEvent)).toBe('内部推理');
  });

  it('faux provider 完成真实工具循环并原生创建杂事', async () => {
    const f = fresh(); const session = f.sessions.create('deepseek-v4-flash', '提醒我联系物业');
    const faux = fauxProvider({ provider: 'faux', models: [{ id: 'deepseek-v4-flash' }] });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('execute_app_command', { command: 'create_task', input: { kind: 'misc', name: '联系物业', note: '续门禁卡', remindAtUtc: null, tzId: 'Asia/Shanghai' } }, { id: 'tool-create' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('已创建杂事')
    ]);
    const models = createModels(); models.setProvider(faux.provider); const model = models.getModel('faux', 'deepseek-v4-flash');
    if (!model) throw new Error('faux model missing');
    const adapter = new PiAgentAdapter(() => ({ model, streamFn: models.streamSimple.bind(models) }));
    const events: PiAdapterEvent[] = [];
    await adapter.run({ sessionId: session.id, input: '提醒我联系物业', history: [], model: 'deepseek-v4-flash', apiKey: 'test-only', systemPrompt: '只使用工具。', tools: createAgentTools(f.app, session.id, f.sessions, f.memories), signal: new AbortController().signal, onEvent: (event) => { events.push(event); } });
    const toolEnd = events.find((event) => event.type === 'tool_end');
    if (toolEnd?.type === 'tool_end' && toolEnd.isError) throw new Error(toolEnd.errorMessage ?? 'tool failed');
    expect(f.app.tasks.listActive()[0].task).toMatchObject({ kind: 'misc', name: '联系物业', remindAtUtc: null });
  });

  it('发给 DeepSeek 的每个工具参数 schema 顶层都是 object', () => {
    const f = fresh(); const session = f.sessions.create('deepseek-v4-flash', '检查工具 schema');
    const tools = createAgentTools(f.app, session.id, f.sessions, f.memories);
    for (const tool of tools) {
      expect(tool.parameters).toMatchObject({ type: 'object' });
    }
    const command = tools.find((tool) => tool.name === 'execute_app_command');
    expect(command?.parameters).toMatchObject({ type: 'object', anyOf: expect.any(Array) });
  });

  it('DeepSeek provider 最终 HTTP payload 保留 execute_app_command 的 object schema', async () => {
    const f = fresh(); const session = f.sessions.create('deepseek-v4-flash', '检查 DeepSeek payload');
    const models = createModels(); models.setProvider(deepseekProvider());
    const model = models.getModel('deepseek', 'deepseek-v4-flash');
    if (!model) throw new Error('deepseek model missing');
    let capturedPayload: unknown;
    const stream = models.streamSimple(model, {
      systemPrompt: '只检查工具 schema。',
      messages: [{ role: 'user', content: '创建一张测试卡片', timestamp: Date.now() }],
      tools: createAgentTools(f.app, session.id, f.sessions, f.memories)
    }, {
      apiKey: 'test-only',
      onPayload: (payload) => {
        capturedPayload = JSON.parse(JSON.stringify(payload)) as unknown;
        throw new Error('payload-captured-before-network');
      }
    });
    for await (const _event of stream) { /* drain the provider error event */ }
    expect(capturedPayload).toBeDefined();
    const payload = capturedPayload as { tools?: Array<{ function?: { name?: string; parameters?: unknown } }> };
    const command = payload.tools?.find((tool) => tool.function?.name === 'execute_app_command');
    expect(command?.function?.parameters).toMatchObject({ type: 'object', anyOf: expect.any(Array) });
  });

  it('空响应明确失败并可由上层归类重试', async () => {
    const faux = fauxProvider({ provider: 'faux', models: [{ id: 'deepseek-v4-flash' }] });
    faux.setResponses([fauxAssistantMessage('')]); const models = createModels(); models.setProvider(faux.provider);
    const model = models.getModel('faux', 'deepseek-v4-flash'); if (!model) throw new Error('faux model missing');
    const adapter = new PiAgentAdapter(() => ({ model, streamFn: models.streamSimple.bind(models) }));
    await expect(adapter.run({ sessionId: 'empty', input: '回答', history: [], model: 'deepseek-v4-flash', apiKey: 'test-only', systemPrompt: '回答。', tools: [], signal: new AbortController().signal, onEvent: () => undefined })).rejects.toThrow('空响应');
  });

  it.each(['401 unauthorized', '429 rate limited', '503 provider unavailable', 'stream disconnected'])(
    '将生产异常终止明确传给上层：%s', async (message) => {
      const faux = fauxProvider({ provider: 'faux', models: [{ id: 'deepseek-v4-flash' }] });
      faux.setResponses([fauxAssistantMessage('', { stopReason: 'error', errorMessage: message })]);
      const models = createModels(); models.setProvider(faux.provider); const model = models.getModel('faux', 'deepseek-v4-flash');
      if (!model) throw new Error('faux model missing');
      const adapter = new PiAgentAdapter(() => ({ model, streamFn: models.streamSimple.bind(models) }));
      await expect(adapter.run({ sessionId: message, input: '回答', history: [], model: 'deepseek-v4-flash', apiKey: 'test-only', systemPrompt: '回答。', tools: [], signal: new AbortController().signal, onEvent: () => undefined })).rejects.toThrow(message);
    }
  );
});
