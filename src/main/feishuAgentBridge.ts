import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  CardActionEvent,
  LarkChannel,
  Logger,
  NormalizedMessage,
  SendResult
} from '@larksuiteoapi/node-sdk';
import type {
  AgentApprovalDecision,
  AgentApprovalRequest,
  AgentRunEvent
} from '../shared/agentContracts';
import type {
  FeishuBotConfigInput,
  FeishuBotConnectionState,
  FeishuBotStatus,
  FeishuPairedUser,
  FeishuPairingCode
} from '../shared/feishuAgentContracts';
import type { AgentPermissionService } from './agentPermissionService';
import type { AgentService } from './agentService';
import type { SafeStorageAdapter } from './safeStorageAdapter';
import type { SettingsService } from './settingsService';

const APP_ID_KEY = 'feishu_bot_app_id';
const APP_SECRET_KEY = 'feishu_bot_app_secret_encrypted';
const ENABLED_KEY = 'feishu_bot_enabled';
const PAIRING_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const EVENT_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_EVENT_ROWS = 50_000;
const SUPPORTED_CONTENT = new Set(['text', 'post']);

interface ChannelFactoryInput { appId: string; appSecret: string }
export type FeishuChannelFactory = (input: ChannelFactoryInput) => Promise<LarkChannel>;

interface PairingEntry { code: string; expiresAt: number }
interface AttemptEntry { startedAt: number; count: number }
interface RemoteRun {
  sessionId: string;
  chatId: string;
  senderId: string;
  sourceMessageId: string;
  progressMessageId: string;
  visibleText: string;
  phaseLabel: string;
  approvalMessageId: string | null;
  approval: AgentApprovalRequest | null;
  updateTimer: ReturnType<typeof setTimeout> | null;
}

const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined
};

async function defaultChannelFactory(input: ChannelFactoryInput): Promise<LarkChannel> {
  const lark = await import('@larksuiteoapi/node-sdk');
  return lark.createLarkChannel({
    appId: input.appId,
    appSecret: input.appSecret,
    transport: 'websocket',
    logger: silentLogger,
    loggerLevel: lark.LoggerLevel.error,
    includeRawEvent: false,
    handshakeTimeoutMs: 15_000,
    policy: { requireMention: true, dmMode: 'open', respondToMentionAll: false },
    safety: {
      staleMessageWindowMs: 5 * 60 * 1000,
      dedup: { ttl: 10 * 60 * 1000, maxEntries: 2_000 },
      chatQueue: { enabled: false }
    },
    outbound: { streamThrottleMs: 500, streamMaxElementChars: 28_000, retry: { maxAttempts: 2, baseDelayMs: 500 } },
    source: 'caiban-island'
  });
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+\S+/giu, 'Bearer [已隐藏]')
    .replace(/sk-[A-Za-z0-9_-]+/gu, '[已隐藏]')
    .replace(/[A-Za-z]:\\[^\s]+/gu, '[本地路径]')
    .slice(0, 240);
}

function errorCategory(error: unknown): string {
  const value = safeError(error);
  if (/401|403|permission|auth|credential|凭据|权限/iu.test(value)) return 'authentication';
  if (/429|rate/iu.test(value)) return 'rate_limit';
  if (/timeout|network|socket|connect/iu.test(value)) return 'network';
  return 'provider';
}

function safeMarkdown(value: string): string {
  return value
    .replace(/Authorization\s*:\s*\S+/giu, 'Authorization: [已隐藏]')
    .replace(/Bearer\s+\S+/giu, 'Bearer [已隐藏]')
    .replace(/sk-[A-Za-z0-9_-]+/gu, '[已隐藏]')
    .replace(/[A-Za-z]:\\[^\s]+/gu, '[本地绝对路径]')
    .replace(/\\\\[^\s]+/gu, '[网络路径]')
    .replace(/[<>]/gu, (character) => character === '<' ? '‹' : '›')
    .slice(0, 28_000);
}

function progressCard(title: string, phase: string, text: string, tone: 'blue' | 'green' | 'red' | 'orange' = 'blue'): object {
  return {
    schema: '2.0', config: { update_multi: true },
    header: { title: { tag: 'plain_text', content: title }, template: tone },
    body: { elements: [
      { tag: 'markdown', content: `**状态**：${safeMarkdown(phase)}` },
      { tag: 'markdown', content: safeMarkdown(text || '正在等待 Agent 输出…') }
    ] }
  };
}

function approvalCard(request: AgentApprovalRequest): object {
  const changes = request.changes.map((change) => `- ${change.label}：${change.before} → ${change.after}`).join('\n');
  const button = (label: string, decision: AgentApprovalDecision, type: string): object => ({
    tag: 'button', text: { tag: 'plain_text', content: label }, type,
    behaviors: [{ type: 'callback', value: { kind: 'agent_approval', approvalId: request.id, decision } }]
  });
  return {
    schema: '2.0', config: { update_multi: true },
    header: { title: { tag: 'plain_text', content: '采办岛操作审批' }, template: request.risk === 'high' ? 'red' : 'orange' },
    body: { elements: [
      { tag: 'markdown', content: `**${safeMarkdown(request.summary)}**\n风险：${request.risk}\n${safeMarkdown(changes)}` },
      { tag: 'column_set', flex_mode: 'none', columns: [
        { tag: 'column', width: 'weighted', weight: 1, elements: [button('批准', 'approve', 'primary')] },
        { tag: 'column', width: 'weighted', weight: 1, elements: [button('拒绝', 'deny', 'danger')] },
        { tag: 'column', width: 'weighted', weight: 1, elements: [button('取消任务', 'cancel', 'default')] }
      ] }
    ] }
  };
}

function resolvedApprovalCard(request: AgentApprovalRequest, decision: AgentApprovalDecision): object {
  const label = decision === 'approve' ? '已批准' : decision === 'deny' ? '已拒绝' : '已取消';
  return progressCard('采办岛操作审批', label, request.summary, decision === 'approve' ? 'green' : 'orange');
}

function isApprovalValue(value: unknown): value is { kind: 'agent_approval'; approvalId: string; decision: AgentApprovalDecision } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.kind === 'agent_approval' && typeof record.approvalId === 'string'
    && (record.decision === 'approve' || record.decision === 'deny' || record.decision === 'cancel');
}

export class FeishuAgentBridgeError extends Error {}

export class FeishuAgentBridge {
  private channel: LarkChannel | null = null;
  private channelUnsubscribers: Array<() => void> = [];
  private releaseAgentListener: (() => void) | null = null;
  private connectionState: FeishuBotConnectionState = 'disabled';
  private botName: string | null = null;
  private botOpenId: string | null = null;
  private lastErrorCategory: string | null = null;
  private readonly pairingCodes = new Map<string, PairingEntry>();
  private readonly attempts = new Map<string, AttemptEntry>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;
  private remote: RemoteRun | null = null;

  constructor(
    private readonly db: DatabaseSync,
    private readonly settings: SettingsService,
    private readonly safeStorage: SafeStorageAdapter,
    private readonly agent: AgentService,
    private readonly permissions: AgentPermissionService,
    private readonly channelFactory: FeishuChannelFactory = defaultChannelFactory
  ) {
    this.releaseAgentListener = this.agent.subscribe((event) => this.handleAgentEvent(event));
    this.cleanupEvents();
    this.cleanupTimer = setInterval(() => this.cleanupEvents(), EVENT_CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  status(): FeishuBotStatus {
    return {
      appId: this.settings.get(APP_ID_KEY)?.trim() ?? '',
      configured: Boolean(this.settings.get(APP_ID_KEY) && this.settings.get(APP_SECRET_KEY)),
      enabled: this.enabled(),
      connectionState: this.connectionState,
      botName: this.botName,
      botOpenId: this.botOpenId,
      lastErrorCategory: this.lastErrorCategory,
      pairedUsers: this.listPairedUsers()
    };
  }

  enabled(): boolean { return this.settings.get(ENABLED_KEY) === '1'; }

  async saveConfig(input: FeishuBotConfigInput): Promise<FeishuBotStatus> {
    const appId = input.appId.trim();
    if (!appId || appId.length > 200 || /[\u0000-\u001f\u007f]/u.test(appId)) throw new FeishuAgentBridgeError('App ID 必须为 1–200 个可见字符');
    const secret = input.appSecret.trim();
    if (!secret && !this.settings.get(APP_SECRET_KEY)) throw new FeishuAgentBridgeError('请输入 App Secret');
    let encrypted: string | null = null;
    if (secret) {
      if (secret.length > 8192) throw new FeishuAgentBridgeError('App Secret 不能超过 8192 个字符');
      if (!this.safeStorage.isEncryptionAvailable()) throw new FeishuAgentBridgeError('系统加密不可用，无法安全保存 App Secret');
      encrypted = this.safeStorage.encryptString(secret).toString('base64');
    }
    await this.disconnect(true);
    this.settings.set(APP_ID_KEY, appId);
    if (encrypted) this.settings.set(APP_SECRET_KEY, encrypted);
    this.settings.set(ENABLED_KEY, input.enabled ? '1' : '0');
    if (input.enabled) await this.connect().catch(() => undefined);
    else this.connectionState = 'disabled';
    return this.status();
  }

  async start(): Promise<void> {
    if (!this.enabled()) { this.connectionState = 'disabled'; return; }
    await this.connect();
  }

  async testConnection(): Promise<string> {
    const credentials = this.credentials();
    const testChannel = await this.channelFactory(credentials);
    try {
      await testChannel.connect();
      return `连接成功：${testChannel.botIdentity?.name ?? '飞书机器人'}`;
    } finally {
      await testChannel.disconnect().catch(() => undefined);
    }
  }

  generatePairingCode(): FeishuPairingCode {
    if (!this.status().configured) throw new FeishuAgentBridgeError('请先保存飞书机器人 App ID/App Secret');
    const code = randomBytes(6).toString('base64url').replace(/[-_]/gu, 'A').slice(0, 8).toUpperCase();
    const expiresAt = Date.now() + PAIRING_TTL_MS;
    this.pairingCodes.clear();
    this.pairingCodes.set(code, { code, expiresAt });
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  revokeUser(openId: string): FeishuBotStatus {
    const normalizedOpenId = openId.trim();
    if (!normalizedOpenId || normalizedOpenId.length > 200 || /[\u0000-\u001f\u007f]/u.test(normalizedOpenId)) {
      throw new FeishuAgentBridgeError('飞书用户 ID 无效');
    }
    const now = new Date().toISOString();
    this.db.prepare('UPDATE feishu_agent_users SET revoked_at=? WHERE open_id=?').run(now, normalizedOpenId);
    const origin = this.agent.activeOrigin();
    if (origin?.type === 'feishu' && origin.senderId === normalizedOpenId) this.agent.cancel();
    return this.status();
  }

  async dispose(): Promise<void> {
    clearInterval(this.cleanupTimer);
    await this.disconnect(true);
    this.releaseAgentListener?.();
    this.releaseAgentListener = null;
  }

  private async connect(): Promise<void> {
    if (this.channel) return;
    this.connectionState = 'connecting';
    this.lastErrorCategory = null;
    try {
      const channel = await this.channelFactory(this.credentials());
      this.channel = channel;
      this.channelUnsubscribers = [
        channel.on('message', (message) => this.handleMessage(message)),
        channel.on('cardAction', (event) => this.handleCardAction(event)),
        channel.on('reconnecting', () => { this.connectionState = 'reconnecting'; }),
        channel.on('reconnected', () => { this.connectionState = 'connected'; this.lastErrorCategory = null; }),
        channel.on('error', (error) => { this.connectionState = 'error'; this.lastErrorCategory = errorCategory(error); })
      ];
      await channel.connect();
      this.botName = channel.botIdentity?.name ?? null;
      this.botOpenId = channel.botIdentity?.openId ?? null;
      this.connectionState = 'connected';
    } catch (error) {
      this.connectionState = 'error';
      this.lastErrorCategory = errorCategory(error);
      await this.disconnect(false);
      this.connectionState = 'error';
      throw new FeishuAgentBridgeError(`飞书机器人连接失败：${safeError(error)}`);
    }
  }

  private async disconnect(cancelRemote: boolean): Promise<void> {
    if (cancelRemote && this.agent.activeOrigin()?.type === 'feishu') {
      this.agent.cancel();
      if (this.remote) {
        this.remote.phaseLabel = '已取消';
        this.remote.visibleText = '飞书机器人已禁用、授权已撤销或应用正在退出。';
        await this.flushProgress('orange');
      }
    }
    if (this.remote?.updateTimer) clearTimeout(this.remote.updateTimer);
    this.remote = null;
    for (const unsubscribe of this.channelUnsubscribers.splice(0)) unsubscribe();
    const channel = this.channel;
    this.channel = null;
    if (channel) await channel.disconnect().catch(() => undefined);
    this.botName = null;
    this.botOpenId = null;
    this.connectionState = this.enabled() ? 'disconnected' : 'disabled';
  }

  private credentials(): ChannelFactoryInput {
    const appId = this.settings.get(APP_ID_KEY)?.trim();
    const encrypted = this.settings.get(APP_SECRET_KEY);
    if (!appId || !encrypted) throw new FeishuAgentBridgeError('尚未配置飞书机器人 App ID/App Secret');
    try { return { appId, appSecret: this.safeStorage.decryptString(Buffer.from(encrypted, 'base64')) }; }
    catch { throw new FeishuAgentBridgeError('App Secret 解密失败，请重新配置'); }
  }

  private listPairedUsers(): FeishuPairedUser[] {
    return this.db.prepare(`SELECT open_id AS openId,display_name AS displayName,paired_at AS pairedAt,last_seen_at AS lastSeenAt
      FROM feishu_agent_users WHERE revoked_at IS NULL ORDER BY paired_at,open_id`).all() as unknown as FeishuPairedUser[];
  }

  private isPaired(openId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM feishu_agent_users WHERE open_id=? AND revoked_at IS NULL').get(openId));
  }

  private touchUser(openId: string): void {
    this.db.prepare('UPDATE feishu_agent_users SET last_seen_at=? WHERE open_id=? AND revoked_at IS NULL').run(new Date().toISOString(), openId);
  }

  private recordEvent(eventId: string, kind: 'message' | 'card_action', chatId: string, outcome: string): boolean {
    const result = this.db.prepare(`INSERT OR IGNORE INTO feishu_agent_events(event_id,kind,chat_id,outcome,processed_at)
      VALUES(?,?,?,?,?)`).run(eventId, kind, chatId, outcome, new Date().toISOString());
    return Number(result.changes) === 1;
  }

  private cleanupEvents(): void {
    const now = Date.now();
    this.db.prepare('DELETE FROM feishu_agent_events WHERE processed_at < ?').run(new Date(now - EVENT_RETENTION_MS).toISOString());
    this.db.prepare(`DELETE FROM feishu_agent_events WHERE event_id IN (
      SELECT event_id FROM feishu_agent_events ORDER BY processed_at DESC,event_id DESC LIMIT -1 OFFSET ?
    )`).run(MAX_EVENT_ROWS);
    for (const [senderId, attempt] of this.attempts) {
      if (now - attempt.startedAt >= ATTEMPT_WINDOW_MS) this.attempts.delete(senderId);
    }
    for (const [code, entry] of this.pairingCodes) {
      if (entry.expiresAt < now) this.pairingCodes.delete(code);
    }
  }

  private async handleMessage(message: NormalizedMessage): Promise<void> {
    if (!this.recordEvent(message.messageId, 'message', message.chatId, 'received')) return;
    const content = message.content.trim();
    if (message.chatType === 'group' && !message.mentionedBot) return;
    const bind = content.match(/^\/bind\s+([A-Z0-9]{8})$/iu);
    if (bind) { await this.handlePairing(message, bind[1].toUpperCase()); return; }
    if (!this.isPaired(message.senderId)) { await this.sendText(message.chatId, '此机器人尚未授权。请在采办岛桌面端生成配对码，再私聊发送 `/bind 配对码`。', message.messageId); return; }
    this.touchUser(message.senderId);
    if (!SUPPORTED_CONTENT.has(message.rawContentType) || message.resources.length > 0) {
      await this.sendText(message.chatId, '首版仅支持纯文本和富文本消息，不会下载图片、文件、音视频或表情。', message.messageId); return;
    }
    if (content === '/help') { await this.sendText(message.chatId, '`/new` 新会话 · `/status` 查看状态 · `/cancel` 取消本人发起的任务', message.messageId); return; }
    if (content === '/status') { await this.sendText(message.chatId, this.agent.isRunning() ? 'Agent 正在执行任务。' : 'Agent 当前空闲。', message.messageId); return; }
    if (content === '/cancel') {
      const origin = this.agent.activeOrigin();
      const allowed = origin?.type === 'feishu' && origin.chatId === message.chatId && origin.senderId === message.senderId;
      await this.sendText(message.chatId, allowed && this.agent.cancel() ? '已请求取消当前任务。' : '当前没有由你在此聊天发起的任务。', message.messageId); return;
    }
    if (content === '/new') {
      if (this.agent.isRunning()) { await this.sendText(message.chatId, 'Agent 正忙，请任务结束后再新建会话。', message.messageId); return; }
      this.bindChat(message.chatId, message.chatType, null);
      await this.sendText(message.chatId, '已切换到新会话；下一条消息将创建新的 Agent 会话。', message.messageId); return;
    }
    if (this.agent.isRunning()) { await this.sendText(message.chatId, 'Agent 已在执行另一项任务。为避免过时写入，本条消息未排队，请稍后重试。', message.messageId); return; }
    await this.launchRemote(message, content);
  }

  private async handlePairing(message: NormalizedMessage, code: string): Promise<void> {
    if (message.chatType !== 'p2p') { await this.sendText(message.chatId, '配对只能在机器人私聊中完成。', message.messageId); return; }
    const now = Date.now();
    const attempts = this.attempts.get(message.senderId);
    if (attempts && now - attempts.startedAt < ATTEMPT_WINDOW_MS && attempts.count >= MAX_ATTEMPTS) {
      await this.sendText(message.chatId, '配对尝试过多，请十分钟后再试。', message.messageId); return;
    }
    const nextAttempts = !attempts || now - attempts.startedAt >= ATTEMPT_WINDOW_MS
      ? { startedAt: now, count: 1 } : { ...attempts, count: attempts.count + 1 };
    this.attempts.set(message.senderId, nextAttempts);
    const entry = this.pairingCodes.get(code);
    if (!entry || entry.expiresAt < now) { await this.sendText(message.chatId, '配对码无效或已过期。', message.messageId); return; }
    this.pairingCodes.delete(code);
    this.attempts.delete(message.senderId);
    const at = new Date().toISOString();
    const displayName = (message.senderName?.trim() || `飞书用户 ${message.senderId.slice(-6)}`).slice(0, 120);
    this.db.prepare(`INSERT INTO feishu_agent_users(open_id,display_name,paired_at,last_seen_at,revoked_at)
      VALUES(?,?,?,?,NULL) ON CONFLICT(open_id) DO UPDATE SET display_name=excluded.display_name,paired_at=excluded.paired_at,last_seen_at=excluded.last_seen_at,revoked_at=NULL`)
      .run(message.senderId, displayName, at, at);
    await this.sendText(message.chatId, '配对成功。你现在可以在私聊中直接发任务，或在群聊中 @机器人。', message.messageId);
  }

  private async launchRemote(message: NormalizedMessage, content: string): Promise<void> {
    const channel = this.requireChannel();
    const sent = await channel.send(message.chatId, { card: progressCard('采办岛 Agent', '正在连接模型', '') }, { replyTo: message.messageId });
    this.remote = {
      sessionId: '', chatId: message.chatId, senderId: message.senderId, sourceMessageId: message.messageId,
      progressMessageId: sent.messageId, visibleText: '', phaseLabel: '正在连接模型', approvalMessageId: null,
      approval: null, updateTimer: null
    };
    try {
      const sessionId = this.chatSession(message.chatId);
      const origin = { type: 'feishu' as const, chatId: message.chatId, senderId: message.senderId, messageId: message.messageId };
      const detail = sessionId
        ? this.agent.send({ sessionId, input: content }, origin)
        : this.agent.start({ input: content }, origin);
      if (this.remote) this.remote.sessionId = detail.session.id;
      this.bindChat(message.chatId, message.chatType, detail.session.id);
    } catch (error) {
      if (this.remote) {
        this.remote.phaseLabel = '启动失败';
        this.remote.visibleText = safeError(error);
        await this.flushProgress('red');
        this.remote = null;
      }
    }
  }

  private chatSession(chatId: string): string | null {
    const row = this.db.prepare('SELECT session_id AS sessionId FROM feishu_agent_chats WHERE chat_id=?').get(chatId) as { sessionId: string | null } | undefined;
    return row?.sessionId ?? null;
  }

  private bindChat(chatId: string, chatType: 'p2p' | 'group', sessionId: string | null): void {
    this.db.prepare(`INSERT INTO feishu_agent_chats(chat_id,chat_type,session_id,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(chat_id) DO UPDATE SET chat_type=excluded.chat_type,session_id=excluded.session_id,updated_at=excluded.updated_at`)
      .run(chatId, chatType, sessionId, new Date().toISOString());
  }

  private handleAgentEvent(event: AgentRunEvent): void {
    const remote = this.remote;
    if (!remote || (remote.sessionId && event.sessionId !== remote.sessionId)) return;
    if (event.type === 'thinking_delta') return;
    if (event.type === 'text_delta') { remote.visibleText += event.delta; remote.phaseLabel = '正在生成回复'; this.scheduleProgress(); return; }
    if (event.type === 'tool_start') { remote.phaseLabel = `正在使用工具：${event.toolName}`; this.scheduleProgress(); return; }
    if (event.type === 'tool_end') { remote.phaseLabel = event.isError ? `工具失败：${event.toolName}` : `工具完成：${event.toolName}`; this.scheduleProgress(); return; }
    if (event.type === 'message' && event.message.role === 'assistant') { remote.visibleText = event.message.content; this.scheduleProgress(); return; }
    if (event.type === 'approval_required') { void this.sendApproval(event.request); return; }
    if (event.type === 'approval_resolved') { void this.resolveApprovalCard(event.decision); return; }
    if (event.type === 'error') { remote.phaseLabel = '执行失败'; remote.visibleText = event.message; void this.flushProgress('red'); return; }
    if (event.type === 'state' && ['completed', 'cancelled', 'error', 'limit_reached'].includes(event.state)) {
      remote.phaseLabel = event.state === 'completed' ? '已完成' : event.state === 'cancelled' ? '已取消' : '执行失败';
      void this.finishRemote(event.state === 'completed' ? 'green' : event.state === 'cancelled' ? 'orange' : 'red');
    }
  }

  private scheduleProgress(): void {
    if (!this.remote || this.remote.updateTimer) return;
    this.remote.updateTimer = setTimeout(() => {
      if (this.remote) this.remote.updateTimer = null;
      void this.flushProgress();
    }, 500);
  }

  private async flushProgress(tone: 'blue' | 'green' | 'red' | 'orange' = 'blue'): Promise<void> {
    const remote = this.remote;
    if (!remote) return;
    await this.requireChannel().updateCard(remote.progressMessageId, progressCard('采办岛 Agent', remote.phaseLabel, remote.visibleText, tone)).catch(() => undefined);
  }

  private async finishRemote(tone: 'green' | 'red' | 'orange'): Promise<void> {
    const remote = this.remote;
    if (!remote) return;
    if (remote.updateTimer) clearTimeout(remote.updateTimer);
    remote.updateTimer = null;
    await this.flushProgress(tone);
    this.remote = null;
  }

  private async sendApproval(request: AgentApprovalRequest): Promise<void> {
    const remote = this.remote;
    if (!remote) return;
    const sent = await this.requireChannel().send(remote.chatId, { card: approvalCard(request) }, { replyTo: remote.sourceMessageId });
    remote.approval = request;
    remote.approvalMessageId = sent.messageId;
    remote.phaseLabel = '等待操作审批';
    await this.flushProgress('orange');
  }

  private async resolveApprovalCard(decision: AgentApprovalDecision): Promise<void> {
    const remote = this.remote;
    if (!remote?.approval || !remote.approvalMessageId) return;
    await this.requireChannel().updateCard(remote.approvalMessageId, resolvedApprovalCard(remote.approval, decision)).catch(() => undefined);
    remote.approval = null;
    remote.approvalMessageId = null;
  }

  private async handleCardAction(event: CardActionEvent): Promise<void> {
    if (!isApprovalValue(event.action.value)) return;
    const value = event.action.value;
    const dedup = `${event.messageId}:${event.operator.openId}:${value.approvalId}:${value.decision}`;
    if (!this.recordEvent(dedup, 'card_action', event.chatId, 'received')) return;
    const remote = this.remote;
    const valid = this.isPaired(event.operator.openId) && remote?.senderId === event.operator.openId
      && remote.chatId === event.chatId && remote.approval?.id === value.approvalId
      && this.permissions.currentApproval()?.id === value.approvalId;
    if (!valid) {
      await this.sendText(event.chatId, '该审批已过期，或你不是本次任务的发起人。');
      return;
    }
    if (!this.permissions.resolveApproval(value.approvalId, value.decision)) {
      await this.sendText(event.chatId, '审批已处理，请勿重复操作。');
    }
  }

  private async sendText(chatId: string, markdown: string, replyTo?: string): Promise<SendResult> {
    return this.requireChannel().send(chatId, { markdown: safeMarkdown(markdown) }, replyTo ? { replyTo } : undefined);
  }

  private requireChannel(): LarkChannel {
    if (!this.channel) throw new FeishuAgentBridgeError('飞书机器人尚未连接');
    return this.channel;
  }
}
