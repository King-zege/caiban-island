import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CardActionEvent, LarkChannel, NormalizedMessage, SendResult } from '@larksuiteoapi/node-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentPermissionService } from '../src/main/agentPermissionService';
import { AgentProviderConfigService } from '../src/main/agentProviderConfigService';
import { AgentService } from '../src/main/agentService';
import { AgentSessionService } from '../src/main/agentSessionService';
import { AppService } from '../src/main/appService';
import { migrate, openDatabase } from '../src/main/db';
import { FeishuAgentBridge } from '../src/main/feishuAgentBridge';
import type { FeishuChannelFactory } from '../src/main/feishuAgentBridge';
import type { FeishuBotStatus } from '../src/shared/types';
import type { PiAgentRunner, PiRunOptions, PiRunResult } from '../src/main/piAgentAdapter';
import type { SafeStorageAdapter } from '../src/main/safeStorageAdapter';

const dirs: string[] = [];
const bridges: FeishuAgentBridge[] = [];
const databases: Array<{ close(): void }> = [];

class FakeSafeStorage implements SafeStorageAdapter {
  isEncryptionAvailable(): boolean { return true; }
  encryptString(value: string): Buffer { return Buffer.from([...value].reverse().join(''));
  }
  decryptString(value: Buffer): string { return [...value.toString()].reverse().join(''); }
}

class FakeChannel {
  readonly botIdentity = { openId: 'bot-open-id', name: '采办岛测试机器人' };
  readonly sent: Array<{ to: string; input: unknown; options: unknown }> = [];
  readonly updated: Array<{ messageId: string; card: object }> = [];
  connected = false;
  private readonly handlers = new Map<string, Array<(event: unknown) => unknown>>();

  on(name: string, handler: (event: unknown) => unknown): () => void {
    const list = this.handlers.get(name) ?? [];
    list.push(handler); this.handlers.set(name, list);
    return () => this.handlers.set(name, (this.handlers.get(name) ?? []).filter((candidate) => candidate !== handler));
  }
  async connect(): Promise<void> { this.connected = true; }
  async disconnect(): Promise<void> { this.connected = false; }
  async send(to: string, input: unknown, options?: unknown): Promise<SendResult> {
    this.sent.push({ to, input, options });
    return { messageId: `out-${this.sent.length}` } as SendResult;
  }
  async updateCard(messageId: string, card: object): Promise<void> { this.updated.push({ messageId, card }); }
  async emit(name: 'message' | 'cardAction', event: NormalizedMessage | CardActionEvent): Promise<void> {
    for (const handler of this.handlers.get(name) ?? []) await handler(event);
  }
  async emitLifecycle(name: 'reconnecting' | 'reconnected' | 'error', event?: unknown): Promise<void> {
    for (const handler of this.handlers.get(name) ?? []) await handler(event);
  }
}

class BlockingRunner implements PiAgentRunner {
  async run(options: PiRunOptions): Promise<PiRunResult> {
    return await new Promise((resolve) => options.signal.addEventListener('abort', () => resolve('cancelled'), { once: true }));
  }
}

class CompletingRunner implements PiAgentRunner {
  async run(options: PiRunOptions): Promise<PiRunResult> {
    await options.onEvent({ type: 'thinking_delta', delta: '不应发送到飞书' });
    await options.onEvent({ type: 'text_delta', delta: '任务已完成 C:\\Secret\\scope.docx sk-private' });
    await options.onEvent({ type: 'assistant_message', text: '任务已完成 C:\\Secret\\scope.docx sk-private', inputTokens: 1, outputTokens: 1 });
    return 'completed';
  }
}

class ApprovalRunner implements PiAgentRunner {
  async run(options: PiRunOptions): Promise<PiRunResult> {
    await options.onEvent({ type: 'tool_start', toolCallId: 'write-1', toolName: 'execute_app_command' });
    const blocked = await options.beforeToolCall?.('write-1', 'execute_app_command', {
      command: 'create_task', input: { kind: 'misc', name: '合成任务', note: '', remindAtUtc: null, tzId: 'Asia/Shanghai' }
    }, options.signal);
    await options.onEvent({ type: 'tool_end', toolCallId: 'write-1', toolName: 'execute_app_command', isError: Boolean(blocked?.block) });
    return 'completed';
  }
}

function message(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    messageId: 'message-1', chatId: 'chat-1', chatType: 'p2p', senderId: 'user-1', senderName: '测试用户',
    content: '整理合成采购任务', rawContentType: 'text', resources: [], mentions: [], mentionAll: false,
    mentionedBot: false, createTime: Date.now(), ...overrides
  };
}

function fresh(
  runner: PiAgentRunner,
  approvalMode: 'confirm_all' | 'bypass' = 'bypass',
  options: { channel?: FakeChannel; channelFactory?: FeishuChannelFactory; emitStatus?: (status: FeishuBotStatus) => void } = {}
) {
  const dir = mkdtempSync(path.join(tmpdir(), 'caiban-p30-')); dirs.push(dir);
  const db = openDatabase(path.join(dir, 'island.db'));
  databases.push(db);
  const app = new AppService(db, dir);
  const sessions = new AgentSessionService(db, dir);
  const safeStorage = new FakeSafeStorage();
  const provider = new AgentProviderConfigService(app.settings, safeStorage);
  provider.saveConfig({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: 'test-only-key' });
  const permissions = new AgentPermissionService(app.settings);
  if (approvalMode === 'bypass') permissions.setMode('bypass', true);
  const agent = new AgentService(app, sessions, provider, () => undefined, runner, undefined, [], permissions);
  const channel = options.channel ?? new FakeChannel();
  const channelFactory = options.channelFactory ?? (async () => channel as unknown as LarkChannel);
  const bridge = new FeishuAgentBridge(db, app.settings, safeStorage, agent, permissions, channelFactory, options.emitStatus);
  bridges.push(bridge);
  return { db, app, sessions, permissions, agent, channel, bridge };
}

async function enableAndPair(f: ReturnType<typeof fresh>, senderId = 'user-1', chatId = 'chat-1'): Promise<void> {
  await f.bridge.saveConfig({ appId: 'cli_testapp', appSecret: 'test-app-secret', enabled: true });
  const pairing = f.bridge.generatePairingCode();
  await f.channel.emit('message', message({ messageId: `bind-${senderId}`, senderId, chatId, content: `/bind ${pairing.code}` }));
}

afterEach(async () => {
  for (const bridge of bridges.splice(0)) await bridge.dispose();
  for (const database of databases.splice(0)) database.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('P30 飞书远程 Agent', () => {
  it('v12→v13 迁移可幂等执行，失败时不伪造 v13 记录', () => {
    const f = fresh(new CompletingRunner());
    migrate(f.db); migrate(f.db);
    expect(f.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({ version: 13 });
    f.db.exec(`
      DROP TABLE feishu_agent_events;
      DROP TABLE feishu_agent_chats;
      DROP TABLE feishu_agent_users;
      DELETE FROM schema_migrations WHERE version = 13;
      CREATE TABLE feishu_agent_users(open_id TEXT PRIMARY KEY);
    `);
    expect(() => migrate(f.db)).toThrow();
    expect(f.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({ version: 12 });
  });

  it('长连接配置只保存密文，配对码单次有效且消息跨重启去重表不保存正文', async () => {
    const f = fresh(new CompletingRunner());
    await enableAndPair(f);
    expect(f.bridge.status()).toMatchObject({ configured: true, enabled: true, connectionState: 'connected', botName: '采办岛测试机器人' });
    await f.channel.emitLifecycle('reconnecting');
    expect(f.bridge.status().connectionState).toBe('reconnecting');
    await f.channel.emitLifecycle('reconnected');
    expect(f.bridge.status().connectionState).toBe('connected');
    expect(f.app.settings.get('feishu_bot_app_secret_encrypted')).not.toContain('test-app-secret');
    expect(f.bridge.status().pairedUsers).toHaveLength(1);
    expect(f.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({ version: 13 });

    const before = f.channel.sent.length;
    await f.channel.emit('message', message({ messageId: 'bind-user-1', content: '不应被重复处理' }));
    expect(f.channel.sent).toHaveLength(before);
    await f.channel.emit('message', message({ messageId: 'completed-run', content: '整理合成采购任务' }));
    await f.agent.waitForIdle();
    expect(JSON.stringify(f.channel.updated)).toContain('任务已完成');
    const outbound = JSON.stringify(f.channel.sent) + JSON.stringify(f.channel.updated);
    expect(outbound).not.toContain('不应发送到飞书');
    expect(outbound).not.toContain('sk-private');
    expect(outbound).not.toContain('Secret');
    const events = f.db.prepare('SELECT event_id AS eventId,kind,chat_id AS chatId,outcome FROM feishu_agent_events ORDER BY event_id').all();
    expect(JSON.stringify(events)).not.toContain('整理合成采购任务');
    expect(JSON.stringify(f.db.prepare('SELECT key,value FROM settings').all())).not.toContain('test-app-secret');
  });

  it('配对码十分钟过期且同一用户连续失败会被限速', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));
    const f = fresh(new CompletingRunner());
    await f.bridge.saveConfig({ appId: 'cli_testapp', appSecret: 'test-app-secret', enabled: true });
    const expired = f.bridge.generatePairingCode();
    vi.setSystemTime(new Date('2026-09-02T00:11:00.000Z'));
    await f.channel.emit('message', message({ messageId: 'expired-code', content: `/bind ${expired.code}` }));
    expect(f.bridge.status().pairedUsers).toHaveLength(0);
    for (let index = 0; index < 5; index += 1) {
      await f.channel.emit('message', message({ messageId: `bad-code-${index}`, content: '/bind AAAAAAAA' }));
    }
    await f.channel.emit('message', message({ messageId: 'rate-limited-code', content: '/bind BBBBBBBB' }));
    expect(JSON.stringify(f.channel.sent.at(-1)?.input)).toContain('尝试过多');
    vi.useRealTimers();
  });

  it('群聊必须提及机器人，附件不会下载且只返回首版能力提示', async () => {
    const f = fresh(new CompletingRunner()); await enableAndPair(f);
    const before = f.channel.sent.length;
    await f.channel.emit('message', message({ messageId: 'group-no-mention', chatId: 'group-1', chatType: 'group', mentionedBot: false }));
    expect(f.channel.sent).toHaveLength(before);
    await f.channel.emit('message', message({
      messageId: 'group-file', chatId: 'group-1', chatType: 'group', mentionedBot: true, rawContentType: 'file',
      resources: [{ type: 'file', fileKey: 'synthetic-file-key', fileName: '合成.txt' }]
    }));
    expect(JSON.stringify(f.channel.sent.at(-1)?.input)).toContain('不会下载');
  });

  it('全局忙碌时不排队，状态可查且只有原发起人可取消；会话删除后映射置空', async () => {
    const f = fresh(new BlockingRunner()); await enableAndPair(f);
    await f.channel.emit('message', message({ messageId: 'run-1', content: '持续处理合成任务' }));
    const origin = f.agent.activeOrigin();
    expect(origin).toMatchObject({ type: 'feishu', chatId: 'chat-1', senderId: 'user-1' });
    await f.channel.emit('message', message({ messageId: 'busy-1', content: '第二个任务' }));
    expect(JSON.stringify(f.channel.sent.at(-1)?.input)).toContain('未排队');
    await f.channel.emit('message', message({ messageId: 'status-1', content: '/status' }));
    expect(JSON.stringify(f.channel.sent.at(-1)?.input)).toContain('正在执行');
    await f.channel.emit('message', message({ messageId: 'cancel-other', senderId: 'user-2', content: '/cancel' }));
    expect(f.agent.isRunning()).toBe(true);
    await f.channel.emit('message', message({ messageId: 'cancel-owner', content: '/cancel' }));
    await f.agent.waitForIdle();
    expect(f.agent.isRunning()).toBe(false);

    const row = f.db.prepare('SELECT session_id AS sessionId FROM feishu_agent_chats WHERE chat_id=?').get('chat-1') as { sessionId: string };
    f.agent.deleteSession(row.sessionId);
    expect(f.db.prepare('SELECT session_id AS sessionId FROM feishu_agent_chats WHERE chat_id=?').get('chat-1')).toEqual({ sessionId: null });
  });

  it('撤销当前发起人或禁用机器人会取消对应远程 run', async () => {
    const f = fresh(new BlockingRunner()); await enableAndPair(f);
    await f.channel.emit('message', message({ messageId: 'revoke-run', content: '等待撤销' }));
    f.bridge.revokeUser('user-1');
    await f.agent.waitForIdle();
    expect(f.agent.isRunning()).toBe(false);
    expect(f.bridge.status().pairedUsers).toHaveLength(0);

    await enableAndPair(f);
    await f.channel.emit('message', message({ messageId: 'disable-run', content: '等待禁用' }));
    await f.bridge.saveConfig({ appId: 'cli_testapp', appSecret: '', enabled: false });
    await f.agent.waitForIdle();
    expect(f.bridge.status()).toMatchObject({ enabled: false, connectionState: 'disabled' });
    expect(f.agent.isRunning()).toBe(false);
    expect(f.channel.connected).toBe(false);
  });

  it('审批卡仅允许本次飞书 run 的原发起人处理，桌面处理也同步更新卡片', async () => {
    const f = fresh(new ApprovalRunner(), 'confirm_all'); await enableAndPair(f);
    const secondCode = f.bridge.generatePairingCode();
    await f.channel.emit('message', message({ messageId: 'bind-user-2', chatId: 'chat-2', senderId: 'user-2', senderName: '另一合成用户', content: `/bind ${secondCode.code}` }));
    await f.channel.emit('message', message({ messageId: 'approval-run', content: '创建合成任务' }));
    await vi.waitFor(() => expect(f.permissions.currentApproval()).not.toBeNull());
    const approval = f.permissions.currentApproval();
    if (!approval) throw new Error('approval missing');
    expect(JSON.stringify(f.channel.sent)).not.toContain('不应发送到飞书');

    await f.channel.emit('cardAction', {
      messageId: 'approval-card', chatId: 'chat-1', operator: { openId: 'user-2' },
      action: { tag: 'button', value: { kind: 'agent_approval', approvalId: approval.id, decision: 'approve' } }
    });
    expect(f.permissions.currentApproval()?.id).toBe(approval.id);
    expect(JSON.stringify(f.channel.sent.at(-1)?.input)).toContain('不是本次任务的发起人');

    expect(f.permissions.resolveApproval(approval.id, 'approve')).toBe(true);
    await f.agent.waitForIdle();
    await vi.waitFor(() => expect(f.channel.updated.some((update) => JSON.stringify(update.card).includes('已批准'))).toBe(true));
    expect(f.permissions.resolveApproval(approval.id, 'approve')).toBe(false);
    const sentBeforeExpiredClick = f.channel.sent.length;
    const expiredAction: CardActionEvent = {
      messageId: 'approval-card', chatId: 'chat-1', operator: { openId: 'user-1' },
      action: { tag: 'button', value: { kind: 'agent_approval', approvalId: approval.id, decision: 'approve' } }
    };
    await f.channel.emit('cardAction', expiredAction);
    expect(JSON.stringify(f.channel.sent.at(-1)?.input)).toContain('审批已过期');
    await f.channel.emit('cardAction', expiredAction);
    expect(f.channel.sent).toHaveLength(sentBeforeExpiredClick + 1);
  });

  it('飞书来源即使全局为 Bypass，所有写操作仍要求原发起人审批', async () => {
    const f = fresh(new ApprovalRunner(), 'bypass');
    await enableAndPair(f);
    await f.channel.emit('message', message({ messageId: 'bypass-remote-write', content: '创建合成任务' }));
    await vi.waitFor(() => expect(f.permissions.currentApproval()).not.toBeNull());
    const approval = f.permissions.currentApproval();
    expect(approval?.risk).not.toBe('read');
    expect(JSON.stringify(f.channel.sent)).toContain('采办岛操作审批');
    if (approval) f.permissions.resolveApproval(approval.id, 'approve');
    await f.agent.waitForIdle();
  });

  it('初始连接失败会按退避自动重试，且状态变更会推送到 renderer', async () => {
    vi.useFakeTimers();
    const working = new FakeChannel();
    let attempts = 0;
    const statuses: FeishuBotStatus[] = [];
    const factory: FeishuChannelFactory = async () => {
      attempts += 1;
      if (attempts === 1) {
        const failing = new FakeChannel();
        failing.connect = async () => { throw new Error('WebSocket handshake timeout'); };
        return failing as unknown as LarkChannel;
      }
      return working as unknown as LarkChannel;
    };
    const f = fresh(new CompletingRunner(), 'bypass', { channel: working, channelFactory: factory, emitStatus: (status) => statuses.push(status) });
    const first = await f.bridge.saveConfig({ appId: 'cli_retryapp', appSecret: 'test-app-secret', enabled: true });
    expect(first).toMatchObject({ connectionState: 'reconnecting', retryAttempt: 1, lastErrorCategory: 'long_connection' });
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(f.bridge.status().connectionState).toBe('connected'));
    expect(attempts).toBe(2);
    expect(statuses.some((status) => status.connectionState === 'reconnecting')).toBe(true);
    expect(statuses.at(-1)?.connectionState).toBe('connected');
  });

  it('诊断报告只记录元数据并脱敏 SDK 错误、消息正文和凭据', async () => {
    const statuses: FeishuBotStatus[] = [];
    const f = fresh(new CompletingRunner(), 'bypass', { emitStatus: (status) => statuses.push(status) });
    f.bridge.setDiagnosticsEnabled(true);
    await enableAndPair(f);
    await f.channel.emit('message', message({ messageId: 'diagnostic-duplicate', content: '敏感采购正文' }));
    await f.channel.emit('message', message({ messageId: 'diagnostic-duplicate', content: '敏感采购正文' }));
    for (let index = 0; index < 210; index += 1) {
      await f.channel.emit('message', message({ messageId: 'diagnostic-duplicate', content: `正文-${index}` }));
    }
    await f.agent.waitForIdle();
    await f.channel.emitLifecycle('error', new Error('close 1006 App Secret=test-app-secret Bearer token-value C:\\Private\\file.docx'));
    const report = f.bridge.diagnosticReport();
    expect(report.entryCount).toBeGreaterThan(0);
    expect(report.entryCount).toBeLessThanOrEqual(200);
    expect(report.text).toContain('duplicateEventCount');
    expect(report.text).not.toContain('敏感采购正文');
    expect(report.text).not.toContain('test-app-secret');
    expect(report.text).not.toContain('token-value');
    expect(report.text).not.toContain('C:\\Private');
    expect(f.bridge.status()).toMatchObject({ lastErrorCategory: 'long_connection', diagnosticsEnabled: true });
    expect(statuses.length).toBeGreaterThan(0);
    f.bridge.setDiagnosticsEnabled(false);
    expect(f.bridge.diagnosticReport().entryCount).toBe(0);
  });

  it('拒绝格式错误的 App ID，避免保存无法连接的配置', async () => {
    const f = fresh(new CompletingRunner());
    await expect(f.bridge.saveConfig({ appId: 'invalid_app', appSecret: 'test-app-secret', enabled: true }))
      .rejects.toThrow('cli_');
    expect(f.bridge.status().configured).toBe(false);
  });

  it('独立连接测试返回错误前会移除 App Secret、Authorization 与本机路径', async () => {
    const working = new FakeChannel();
    let calls = 0;
    const factory: FeishuChannelFactory = async (input) => {
      calls += 1;
      if (calls === 1) return working as unknown as LarkChannel;
      const failing = new FakeChannel();
      failing.connect = async () => { throw new Error(`App Secret=${input.appSecret} Authorization: Bearer synthetic-token C:\\Private\\test.txt`); };
      return failing as unknown as LarkChannel;
    };
    const f = fresh(new CompletingRunner(), 'bypass', { channel: working, channelFactory: factory });
    await f.bridge.saveConfig({ appId: 'cli_testconnection', appSecret: 'test-app-secret', enabled: true });
    let errorMessage = '';
    try { await f.bridge.testConnection(); } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
    expect(errorMessage).toContain('连接测试失败');
    expect(errorMessage).not.toContain('test-app-secret');
    expect(errorMessage).not.toContain('synthetic-token');
    expect(errorMessage).not.toContain('C:\\Private');
  });
});
