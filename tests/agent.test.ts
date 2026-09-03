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
import { AgentProviderConfigService } from '../src/main/agentProviderConfigService';
import { DeepSeekConfigService } from '../src/main/deepSeekConfigService';
import { MemoryService } from '../src/main/memoryService';
import type { SafeStorageAdapter } from '../src/main/safeStorageAdapter';
import type { PiAdapterEvent, PiAgentRunner, PiRunOptions, PiRunResult } from '../src/main/piAgentAdapter';
import { createPiModelRuntime, PiAgentAdapter, thinkingDeltaFromPiEvent, visibleDeltaFromPiEvent } from '../src/main/piAgentAdapter';
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
    expect(f.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({ version: 13 });
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

  it('Peng 三协议固定端点、共用加密 Key 并分别保存模型', () => {
    const f = fresh();
    const config = new AgentProviderConfigService(f.app.settings, new FakeSafeStorage());
    config.saveConfig({
      provider: 'peng_deepseek', baseUrl: 'https://api.peng-us.com/v1',
      model: 'deepseek/peng-prod', apiKey: 'peng-secret'
    });
    expect(config.runtime()).toEqual({
      provider: 'peng_deepseek', baseUrl: 'https://api.peng-us.com/v1',
      protocol: 'openai-completions', model: 'deepseek/peng-prod', apiKey: 'peng-secret'
    });
    config.saveConfig({ provider: 'peng_anthropic', baseUrl: 'https://api.peng-us.com', model: 'claude/peng-prod', apiKey: '' });
    expect(config.runtime()).toMatchObject({ provider: 'peng_anthropic', baseUrl: 'https://api.peng-us.com', model: 'claude/peng-prod', apiKey: 'peng-secret' });
    expect(f.app.settings.get('peng_api_key_encrypted')).not.toContain('peng-secret');
    expect(config.status()).toMatchObject({
      provider: 'peng_anthropic', pengKeyConfigured: true,
      configured: true,
      configuredProviders: expect.arrayContaining(['deepseek', 'peng_deepseek', 'peng_anthropic'])
    });
  });

  it('旧企业配置只在原地址为 Peng 时迁移，其他网关密文保持隔离并提示重配', () => {
    const peng = fresh(); const storage = new FakeSafeStorage();
    peng.app.settings.set('agent_provider', 'enterprise');
    peng.app.settings.set('enterprise_base_url', 'https://api.peng-us.com/v1/chat/completions/');
    peng.app.settings.set('enterprise_model', 'legacy-peng-model');
    peng.app.settings.set('enterprise_api_key_encrypted', storage.encryptString('legacy-peng-key').toString('base64'));
    const migrated = new AgentProviderConfigService(peng.app.settings, storage);
    expect(migrated.runtime()).toMatchObject({ provider: 'peng_deepseek', baseUrl: 'https://api.peng-us.com/v1', model: 'legacy-peng-model', apiKey: 'legacy-peng-key' });
    expect(peng.app.settings.get('enterprise_api_key_encrypted')).toBeNull();

    const other = fresh();
    other.app.settings.set('agent_provider', 'enterprise');
    other.app.settings.set('enterprise_base_url', 'https://gateway.corp.example/v1');
    other.app.settings.set('enterprise_model', 'legacy-other-model');
    const legacyCiphertext = storage.encryptString('legacy-other-key').toString('base64');
    other.app.settings.set('enterprise_api_key_encrypted', legacyCiphertext);
    const isolated = new AgentProviderConfigService(other.app.settings, storage);
    expect(isolated.status()).toMatchObject({ provider: 'deepseek', pengMigrationRequired: true, pengKeyConfigured: false });
    expect(other.app.settings.get('enterprise_api_key_encrypted')).toBe(legacyCiphertext);
  });

  it('Peng 拒绝被 UI 或调用方改写固定 Base URL', () => {
    const f = fresh(); const config = new AgentProviderConfigService(f.app.settings, new FakeSafeStorage());
    expect(() => config.saveConfig({ provider: 'peng_openai', baseUrl: 'https://api.peng-us.com/v1/responses', model: 'gpt-prod', apiKey: 'key' })).toThrow('Peng 服务地址由应用固定管理');
    expect(() => config.saveConfig({ provider: 'peng_anthropic', baseUrl: 'https://api.peng-us.com/v1', model: 'claude-prod', apiKey: 'key' })).toThrow('Peng 服务地址由应用固定管理');
  });

  it('系统加密不可用时不切换当前 Provider 或写入 Peng 配置', () => {
    const f = fresh();
    const unavailableStorage: SafeStorageAdapter = {
      isEncryptionAvailable: () => false,
      encryptString: () => { throw new Error('should not encrypt'); },
      decryptString: () => { throw new Error('should not decrypt'); }
    };
    const config = new AgentProviderConfigService(f.app.settings, unavailableStorage);
    expect(() => config.saveConfig({
      provider: 'peng_openai', baseUrl: 'https://api.peng-us.com/v1',
      model: 'openai/gpt-enterprise', apiKey: 'cannot-store'
    })).toThrow('系统加密不可用');
    expect(config.status()).toMatchObject({ provider: 'deepseek' });
    expect(f.app.settings.get('peng_api_key_encrypted')).toBeNull();
  });

  it.each([
    ['peng_deepseek', 'https://api.peng-us.com/v1/chat/completions', 'Authorization'],
    ['peng_openai', 'https://api.peng-us.com/v1/responses', 'Authorization'],
    ['peng_anthropic', 'https://api.peng-us.com/v1/messages', 'x-api-key']
  ] as const)('Peng %s 先发现模型，再按真实协议发送固定最小消息', async (provider, expectedUrl, authHeader) => {
    const f = fresh();
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      if (String(input).endsWith('/models')) return new Response('{"data":[{"id":"model-prod"},{"id":"model-prod"}]}', { status: 200 });
      if (provider === 'peng_openai') return new Response('{"output":[]}', { status: 200 });
      if (provider === 'peng_anthropic') return new Response('{"content":[]}', { status: 200 });
      return new Response('{"choices":[]}', { status: 200 });
    });
    const config = new AgentProviderConfigService(f.app.settings, new FakeSafeStorage(), fetchMock as typeof fetch);
    config.saveConfig({
      provider, baseUrl: provider === 'peng_anthropic' ? 'https://api.peng-us.com' : 'https://api.peng-us.com/v1',
      model: 'model-prod', apiKey: 'peng-test-key'
    });

    await expect(config.test()).resolves.toBe('连接成功（HTTP 200）');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.peng-us.com/v1/models');
    const [requestUrl, requestInit] = fetchMock.mock.calls[1] ?? [];
    expect(requestUrl).toBe(expectedUrl);
    expect(requestInit).toMatchObject({ method: 'POST' });
    expect((requestInit as RequestInit).headers).toHaveProperty(authHeader);
    const body = JSON.parse(String((requestInit as RequestInit).body)) as { model: string };
    expect(body.model).toBe('model-prod');
    expect(JSON.stringify(body)).not.toContain('采购');
  });

  it('Peng 模型发现清洗、去重并稳定排序模型 ID', async () => {
    const f = fresh();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [
      { id: 'z-model' }, { id: 'a-model' }, { id: 'z-model' }, { id: '' }, { missing: true }, null
    ] }), { status: 200 }));
    const config = new AgentProviderConfigService(f.app.settings, new FakeSafeStorage(), fetchMock as typeof fetch);
    await expect(config.discoverPengModels('temporary-key')).resolves.toMatchObject({ models: ['a-model', 'z-model'] });
    expect(fetchMock).toHaveBeenCalledWith('https://api.peng-us.com/v1/models', expect.objectContaining({
      method: 'GET', headers: { Authorization: 'Bearer temporary-key' }
    }));
  });

  it.each([
    [400, 'model_not_allowed', false], [401, 'authentication', false], [403, 'authentication', false], [404, 'model_not_allowed', false],
    [429, 'rate_limit', true], [500, 'provider', true], [503, 'provider', true]
  ] as const)('Peng 模型发现将 HTTP %s 归类为 %s', async (status, category, retryable) => {
    const f = fresh();
    const config = new AgentProviderConfigService(f.app.settings, new FakeSafeStorage(), vi.fn(async () => new Response('{}', { status })) as typeof fetch);
    const error = await config.discoverPengModels('temporary-key').catch((caught: unknown) => caught);
    expect(error).toMatchObject({ category, retryable });
  });

  it('Peng 测试拒绝成功状态下的异常协议响应', async () => {
    const f = fresh();
    const fetchMock = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/models')
      ? new Response('{"data":[{"id":"model-prod"}]}', { status: 200 })
      : new Response('{"unexpected":true}', { status: 200 }));
    const config = new AgentProviderConfigService(f.app.settings, new FakeSafeStorage(), fetchMock as typeof fetch);
    config.saveConfig({ provider: 'peng_openai', baseUrl: 'https://api.peng-us.com/v1', model: 'model-prod', apiKey: 'test-key' });
    const error = await config.test().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ category: 'invalid_response', retryable: false });
  });

  it('GLM 使用官方端点与模型白名单，独立保存 API Key', () => {
    const f = fresh();
    const config = new AgentProviderConfigService(f.app.settings, new FakeSafeStorage());
    config.saveConfig({
      provider: 'glm', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
      model: 'glm-5.2', apiKey: 'glm-secret'
    });
    expect(config.runtime()).toEqual({
      provider: 'glm', protocol: 'openai-completions', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
      model: 'glm-5.2', apiKey: 'glm-secret'
    });
    expect(() => config.saveConfig({
      provider: 'glm', baseUrl: 'https://untrusted.example/v4', model: 'glm-5.2', apiKey: ''
    })).toThrow('不支持的 GLM 服务地址');
    expect(() => config.saveConfig({
      provider: 'glm', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-unknown', apiKey: ''
    })).toThrow('不支持的 GLM 模型');
  });

  it('Agent run 将 Peng Provider、固定 Base URL 与模型传给运行时', async () => {
    const f = fresh(); const runner = new CompletingRunner();
    f.deepSeek.saveConfig({
      provider: 'peng_openai', baseUrl: 'https://api.peng-us.com/v1',
      model: 'deepseek/analysis-pro', apiKey: 'corp-key'
    });
    const service = new AgentService(f.app, f.sessions, f.deepSeek, () => undefined, runner, f.memories);
    const started = service.start({ input: '检查企业模型连接' });
    await service.waitForIdle();

    expect(runner.lastOptions).toMatchObject({
      provider: 'peng_openai', baseUrl: 'https://api.peng-us.com/v1',
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

  it.each([
    ['peng_deepseek', 'https://api.peng-us.com/v1', 'openai-completions'],
    ['peng_openai', 'https://api.peng-us.com/v1', 'openai-responses'],
    ['peng_anthropic', 'https://api.peng-us.com', 'anthropic-messages']
  ] as const)('Peng %s 在 Pi 运行时绑定明确协议且不重复拼接 /v1', (provider, baseUrl, api) => {
    const runtime = createPiModelRuntime({ provider, protocol: api, baseUrl, model: 'synthetic-model', apiKey: 'test-only' });
    expect(runtime.model).toMatchObject({ provider, baseUrl, api });
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
