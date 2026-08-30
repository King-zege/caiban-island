import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  AgentApprovalDecision,
  AgentApprovalRequest,
  AgentPermissionMode,
  AgentPermissionSettings,
  AgentToolRisk,
  AuthorizedDirectory
} from '../shared/agentContracts';
import { APP_COMMAND_REGISTRY } from './appCommandService';
import type { AppCommandName } from '../shared/appCommandContracts';
import type { SettingsService } from './settingsService';

const MODE_KEY = 'agent_permission_mode';
const BYPASS_ACCEPTED_KEY = 'agent_bypass_warning_accepted';
const DIRECTORIES_KEY = 'agent_authorized_directories';

interface PendingApproval {
  request: AgentApprovalRequest;
  resolve: (decision: AgentApprovalDecision) => void;
}

type ApprovalListener =
  | { type: 'required'; request: AgentApprovalRequest }
  | { type: 'resolved'; request: AgentApprovalRequest; decision: AgentApprovalDecision };

function isMode(value: string | null): value is AgentPermissionMode {
  return value === 'confirm_all' || value === 'auto_reversible' || value === 'bypass';
}

function shortValue(value: unknown): string {
  if (value === null || value === undefined) return '未设置';
  if (typeof value === 'string') return value.length > 120 ? value.slice(0, 117) + '…' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `${value.length} 项`;
  return '结构化内容';
}

function approvalChanges(args: unknown): AgentApprovalRequest['changes'] {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return [];
  const outer = args as Record<string, unknown>;
  const record = typeof outer.input === 'object' && outer.input !== null && !Array.isArray(outer.input)
    ? outer.input as Record<string, unknown>
    : outer;
  const changes: AgentApprovalRequest['changes'] = [];
  const pairs: Array<[string, string, string]> = [
    ['名称', 'expectedName', 'name'], ['紧急度', 'expectedUrgency', 'urgency'],
    ['提醒', 'expectedRemindAtUtc', 'remindAtUtc'], ['节点标题', 'expectedTitle', 'title'],
    ['节点开始时间', 'expectedStartUtc', 'startUtc'], ['状态', 'before', 'status']
  ];
  for (const [label, beforeKey, afterKey] of pairs) {
    if (afterKey in record) changes.push({ label, before: shortValue(record[beforeKey]), after: shortValue(record[afterKey]) });
  }
  if (changes.length === 0) changes.push({ label: '操作', before: '保持当前数据', after: '应用请求中的变更' });
  return changes;
}

export class AgentPermissionError extends Error {}

export class AgentPermissionService {
  private pending: PendingApproval | null = null;
  private listener: ((event: ApprovalListener) => void) | null = null;

  constructor(private readonly settings: SettingsService) {}

  snapshot(): AgentPermissionSettings {
    const savedMode = this.settings.get(MODE_KEY);
    let primarySeen = false;
    const authorizedDirectories = this.settings.getJson<AuthorizedDirectory[]>(DIRECTORIES_KEY, [])
      .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.path === 'string')
      .map((entry) => {
        const isPrimaryWorkspace = entry.isPrimaryWorkspace === true && !primarySeen;
        if (isPrimaryWorkspace) primarySeen = true;
        return { ...entry, isPrimaryWorkspace };
      });
    return {
      mode: isMode(savedMode) ? savedMode : 'confirm_all',
      bypassWarningAccepted: this.settings.get(BYPASS_ACCEPTED_KEY) === 'true',
      authorizedDirectories
    };
  }

  setMode(mode: AgentPermissionMode, bypassWarningAccepted = false): AgentPermissionSettings {
    if (mode === 'bypass' && !(bypassWarningAccepted || this.snapshot().bypassWarningAccepted)) {
      throw new AgentPermissionError('首次启用 Bypass 前必须确认风险');
    }
    this.settings.set(MODE_KEY, mode);
    if (mode === 'bypass' && bypassWarningAccepted) this.settings.set(BYPASS_ACCEPTED_KEY, 'true');
    return this.snapshot();
  }

  addDirectory(directoryPath: string): AgentPermissionSettings {
    if (!path.isAbsolute(directoryPath)) throw new AgentPermissionError('授权目录必须是绝对路径');
    const normalized = path.resolve(directoryPath);
    if (normalized.startsWith('\\\\') || normalized.startsWith('\\\\?\\') || normalized.startsWith('\\\\.\\')) {
      throw new AgentPermissionError('不支持网络路径或设备路径');
    }
    const current = this.snapshot().authorizedDirectories;
    if (!current.some((entry) => path.normalize(entry.path).toLowerCase() === path.normalize(normalized).toLowerCase())) {
      current.push({ id: randomUUID(), label: path.basename(normalized) || normalized, path: normalized, createdAt: new Date().toISOString() });
      this.settings.setJson(DIRECTORIES_KEY, current);
    }
    return this.snapshot();
  }

  removeDirectory(id: string): AgentPermissionSettings {
    const remaining = this.snapshot().authorizedDirectories.filter((entry) => entry.id !== id);
    this.settings.setJson(DIRECTORIES_KEY, remaining);
    return this.snapshot();
  }

  setPrimaryDirectory(id: string): AgentPermissionSettings {
    const directories = this.snapshot().authorizedDirectories;
    if (!directories.some((entry) => entry.id === id)) throw new AgentPermissionError('目录未授权');
    this.settings.setJson(DIRECTORIES_KEY, directories.map((entry) => ({
      ...entry,
      isPrimaryWorkspace: entry.id === id
    })));
    return this.snapshot();
  }

  onApproval(listener: (event: ApprovalListener) => void): () => void {
    this.listener = listener;
    return () => { if (this.listener === listener) this.listener = null; };
  }

  currentApproval(): AgentApprovalRequest | null { return this.pending?.request ?? null; }

  resolveApproval(id: string, decision: AgentApprovalDecision): boolean {
    if (!this.pending || this.pending.request.id !== id) return false;
    const pending = this.pending;
    this.pending = null;
    this.listener?.({ type: 'resolved', request: pending.request, decision });
    pending.resolve(decision);
    return true;
  }

  cancelPending(): void {
    if (this.pending) this.resolveApproval(this.pending.request.id, 'cancel');
  }

  riskForTool(toolName: string, args?: unknown): AgentToolRisk {
    const commandName = toolName === 'execute_app_command' && typeof args === 'object' && args !== null && 'command' in args
      ? (args as { command?: unknown }).command
      : toolName;
    const command = typeof commandName === 'string' ? APP_COMMAND_REGISTRY.get(commandName as AppCommandName) : undefined;
    if (command) return command.risk;
    if (['list_active_tasks', 'get_task_detail', 'list_contracts', 'get_contract_detail', 'search_archived_cases', 'list_authorized_files', 'read_authorized_file', 'search_sessions', 'get_workspace_tree', 'search_workspace', 'get_source_excerpt', 'refresh_workspace_index'].includes(toolName)) return 'read';
    if (toolName === 'write_authorized_file' || toolName === 'move_authorized_file' || toolName === 'delete_authorized_file' || toolName === 'propose_memory') return 'high';
    if (toolName.startsWith('propose_')) return 'high';
    return 'high';
  }

  async beforeToolCall(
    sessionId: string,
    toolCallId: string,
    toolName: string,
    args: unknown,
    signal?: AbortSignal
  ): Promise<{ block: true; reason: string } | undefined> {
    const risk = this.riskForTool(toolName, args);
    const mode = this.snapshot().mode;
    const needsApproval = risk !== 'read' && (mode === 'confirm_all' || (mode === 'auto_reversible' && risk === 'high'));
    if (!needsApproval) return undefined;
    if (this.pending) return { block: true, reason: '已有操作等待确认' };
    const commandName = toolName === 'execute_app_command' && typeof args === 'object' && args !== null && 'command' in args
      ? (args as { command?: unknown }).command
      : toolName;
    const definition = typeof commandName === 'string' ? APP_COMMAND_REGISTRY.get(commandName as AppCommandName) : undefined;
    const request: AgentApprovalRequest = {
      id: randomUUID(), sessionId, toolCallId, toolName,
      summary: definition?.summary ?? '执行受保护操作', risk,
      changes: approvalChanges(args), createdAt: new Date().toISOString()
    };
    const decision = await new Promise<AgentApprovalDecision>((resolve) => {
      this.pending = { request, resolve };
      this.listener?.({ type: 'required', request });
      if (signal) {
        const cancel = () => this.resolveApproval(request.id, 'cancel');
        if (signal.aborted) cancel();
        else signal.addEventListener('abort', cancel, { once: true });
      }
    });
    if (decision !== 'approve') return { block: true, reason: decision === 'deny' ? '用户拒绝了此操作' : '用户取消了此操作' };
    return undefined;
  }
}
