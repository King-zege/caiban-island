import type {
  LinkInput,
  LegacyMiscDeadlineActionRequest,
  MiscReminderUpdateRequest,
  NodeInput,
  NodeStatus,
  NodeTimeUpdateRequest,
  NodeTitleUpdateRequest,
  TaskCreateRequest,
  TaskInput,
  TaskNameUpdateRequest,
  TaskNamesUpdateRequest,
  TaskUrgencyUpdateRequest
} from './taskContracts';
import type { ProcurementPlanApplyRequest, ProcurementProjectCreateRequest } from './procurementContracts';
import type { ContractActionReminderRequest, ContractActionStatusRequest, ContractActionUpdateRequest, ContractCreateRequest, ContractLinkInput, ContractStatusRequest, ContractUpdateRequest } from './contractContracts';
import type { WorkspaceProjectBindingRequest } from './knowledgeContracts';
import type { AutomationCreateRequest, AutomationEnabledRequest, AutomationUpdateRequest } from './automationContracts';

export const APP_COMMAND_NAMES = [
  'create_task', 'update_task', 'set_task_name', 'set_task_names', 'set_task_urgency',
  'complete_task', 'cancel_task', 'restore_task', 'delete_task',
  'set_reminders', 'set_misc_reminder', 'add_node', 'update_node',
  'set_node_title', 'set_node_start_time', 'set_node_status', 'reorder_nodes',
  'remove_node', 'add_link', 'remove_link', 'save_note',
  'resolve_legacy_misc_deadline',
  'create_procurement_project', 'apply_procurement_plan',
  'create_contract', 'update_contract', 'set_contract_status', 'restore_contract',
  'add_contract_action', 'update_contract_action', 'set_contract_action_status', 'remove_contract_action',
  'set_contract_action_reminder', 'add_contract_link', 'remove_contract_link', 'save_contract_note',
  'bind_workspace_project', 'create_automation', 'update_automation', 'set_automation_enabled', 'delete_automation'
] as const;

export type AppCommandName = (typeof APP_COMMAND_NAMES)[number];

export type AppCommand =
  | { name: 'create_task'; input: TaskCreateRequest }
  | { name: 'update_task'; input: { taskId: string; task: TaskInput } }
  | { name: 'set_task_name'; input: TaskNameUpdateRequest }
  | { name: 'set_task_names'; input: TaskNamesUpdateRequest }
  | { name: 'set_task_urgency'; input: TaskUrgencyUpdateRequest }
  | { name: 'complete_task' | 'cancel_task' | 'restore_task' | 'delete_task'; input: { taskId: string } }
  | { name: 'set_reminders'; input: { taskId: string; offsets: number[] } }
  | { name: 'set_misc_reminder'; input: MiscReminderUpdateRequest }
  | { name: 'add_node'; input: { taskId: string; node: NodeInput } }
  | { name: 'update_node'; input: { nodeId: string; node: NodeInput } }
  | { name: 'set_node_title'; input: NodeTitleUpdateRequest }
  | { name: 'set_node_start_time'; input: NodeTimeUpdateRequest }
  | { name: 'set_node_status'; input: { nodeId: string; status: NodeStatus } }
  | { name: 'reorder_nodes'; input: { taskId: string; orderedNodeIds: string[] } }
  | { name: 'remove_node'; input: { nodeId: string } }
  | { name: 'add_link'; input: { taskId: string; link: LinkInput } }
  | { name: 'remove_link'; input: { linkId: string } }
  | { name: 'save_note'; input: { taskId: string; body: string } }
  | { name: 'resolve_legacy_misc_deadline'; input: LegacyMiscDeadlineActionRequest }
  | { name: 'create_procurement_project'; input: ProcurementProjectCreateRequest }
  | { name: 'apply_procurement_plan'; input: ProcurementPlanApplyRequest }
  | { name: 'create_contract'; input: ContractCreateRequest }
  | { name: 'update_contract'; input: ContractUpdateRequest }
  | { name: 'set_contract_status'; input: ContractStatusRequest }
  | { name: 'restore_contract'; input: { contractId: string } }
  | { name: 'add_contract_action'; input: { contractId: string; action: import('./contractContracts').ContractActionInput } }
  | { name: 'update_contract_action'; input: ContractActionUpdateRequest }
  | { name: 'set_contract_action_status'; input: ContractActionStatusRequest }
  | { name: 'remove_contract_action'; input: { actionId: string } }
  | { name: 'set_contract_action_reminder'; input: ContractActionReminderRequest }
  | { name: 'add_contract_link'; input: { contractId: string; link: ContractLinkInput } }
  | { name: 'remove_contract_link'; input: { linkId: string } }
  | { name: 'save_contract_note'; input: { contractId: string; body: string } }
  | { name: 'bind_workspace_project'; input: WorkspaceProjectBindingRequest }
  | { name: 'create_automation'; input: AutomationCreateRequest }
  | { name: 'update_automation'; input: AutomationUpdateRequest }
  | { name: 'set_automation_enabled'; input: AutomationEnabledRequest }
  | { name: 'delete_automation'; input: { automationId: string } };

export interface AppCommandResult {
  command: AppCommandName;
  summary: string;
  entityId?: string;
  undoable: boolean;
  data?: unknown;
}

const URGENCY_VALUES = new Set(['critical', 'high', 'normal', 'low']);
const NODE_STATUS_VALUES = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
const PROCUREMENT_METHOD_VALUES = new Set(['open_tender', 'invited_tender', 'competitive_negotiation', 'single_source', 'inquiry', 'framework', 'custom']);
const NODE_SOURCE_VALUES = new Set(['template', 'agent', 'custom']);
const CONTRACT_STATUS_VALUES = new Set(['draft', 'active', 'closing', 'closed', 'terminated', 'archived']);
const CONTRACT_ACTION_TYPE_VALUES = new Set(['payment', 'invoice', 'delivery', 'acceptance', 'renewal', 'expiry', 'archive', 'custom']);
const CONTRACT_ACTION_STATUS_VALUES = new Set(['pending', 'in_progress', 'completed', 'waived']);

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(label + '必须是对象');
  return value as Record<string, unknown>;
}

function exact(record: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = new Set(keys);
  if (Object.keys(record).some((key) => !allowed.has(key)) || keys.some((key) => !(key in record))) {
    throw new Error('命令参数字段不符合 schema');
  }
}

function exactOptional(record: Record<string, unknown>, required: readonly string[], optional: readonly string[]): void {
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(record).some((key) => !allowed.has(key)) || required.some((key) => !(key in record))) {
    throw new Error('命令参数字段不符合 schema');
  }
}

function string(record: Record<string, unknown>, key: string): void {
  if (typeof record[key] !== 'string') throw new Error(key + ' 必须是字符串');
}

function nullableString(record: Record<string, unknown>, key: string): void {
  if (record[key] !== null && typeof record[key] !== 'string') throw new Error(key + ' 必须是字符串或 null');
}

function nullableInteger(record: Record<string, unknown>, key: string): void {
  if (record[key] !== null && (!Number.isSafeInteger(record[key]) || Number(record[key]) < 0)) throw new Error(key + ' 必须是非负整数或 null');
}

function stringArray(record: Record<string, unknown>, key: string): void {
  if (!Array.isArray(record[key]) || !(record[key] as unknown[]).every((item) => typeof item === 'string')) {
    throw new Error(key + ' 必须是字符串数组');
  }
}

function taskIdOnly(input: Record<string, unknown>, key = 'taskId'): void {
  exact(input, [key]);
  string(input, key);
}

function nodeInput(value: unknown): void {
  const node = object(value, '节点');
  exactOptional(node, ['title', 'description', 'startUtc', 'endUtc'], ['stageKey', 'source']);
  string(node, 'title'); string(node, 'description'); nullableString(node, 'startUtc'); nullableString(node, 'endUtc');
  if ('stageKey' in node) nullableString(node, 'stageKey');
  if ('source' in node && !NODE_SOURCE_VALUES.has(String(node.source))) throw new Error('节点来源无效');
}

function procurementCreateInput(value: unknown): void {
  const input = object(value, '采购项目');
  exactOptional(input, ['fullName', 'shortName', 'description', 'urgency', 'deadlineUtc', 'tzId', 'procurementMethod', 'templateId'], ['nodes']);
  string(input, 'fullName'); string(input, 'shortName'); string(input, 'description'); string(input, 'tzId');
  nullableString(input, 'deadlineUtc'); nullableString(input, 'templateId');
  if (!URGENCY_VALUES.has(String(input.urgency))) throw new Error('紧急度无效');
  if (!PROCUREMENT_METHOD_VALUES.has(String(input.procurementMethod))) throw new Error('采购方式无效');
  if ('nodes' in input && (!Array.isArray(input.nodes) || !input.nodes.every((node) => { try { nodeInput(node); return true; } catch { return false; } }))) throw new Error('采购节点计划无效');
}

const CONTRACT_EDIT_FIELDS = ['procurementProjectId', 'fullName', 'shortName', 'contractNo', 'supplierName', 'amountMinor', 'currency', 'signedOn', 'effectiveOn', 'expiresOn', 'tzId'] as const;
const CONTRACT_CREATE_FIELDS = [...CONTRACT_EDIT_FIELDS, 'status'] as const;

function contractCreateInput(value: unknown, update = false): void {
  const input = object(value, '合同');
  const fields = update ? ['contractId', ...CONTRACT_EDIT_FIELDS, 'expectedUpdatedAtUtc'] : [...CONTRACT_CREATE_FIELDS];
  exact(input, fields);
  nullableString(input, 'procurementProjectId'); string(input, 'fullName'); string(input, 'shortName'); string(input, 'contractNo');
  string(input, 'supplierName'); nullableInteger(input, 'amountMinor'); string(input, 'currency'); nullableString(input, 'signedOn');
  nullableString(input, 'effectiveOn'); nullableString(input, 'expiresOn'); string(input, 'tzId');
  if (!update && input.status !== 'draft' && input.status !== 'active') throw new Error('合同编辑状态无效');
  if (update) { string(input, 'contractId'); string(input, 'expectedUpdatedAtUtc'); }
}

function contractActionInput(value: unknown): void {
  const input = object(value, '合同履约动作');
  exact(input, ['type', 'title', 'description', 'dueAtUtc', 'amountMinor', 'relatedActionId']);
  if (!CONTRACT_ACTION_TYPE_VALUES.has(String(input.type))) throw new Error('合同履约动作类型无效');
  string(input, 'title'); string(input, 'description'); nullableString(input, 'dueAtUtc'); nullableInteger(input, 'amountMinor'); nullableString(input, 'relatedActionId');
}

function taskInput(value: unknown): void {
  const task = object(value, '任务');
  const modern = 'fullName' in task || 'shortName' in task;
  exact(task, modern ? ['name', 'fullName', 'shortName', 'description', 'kind', 'urgency', 'deadlineUtc', 'tzId'] : ['name', 'description', 'kind', 'urgency', 'deadlineUtc', 'tzId']);
  string(task, 'name'); string(task, 'description'); string(task, 'tzId'); nullableString(task, 'deadlineUtc');
  if (modern) { string(task, 'fullName'); string(task, 'shortName'); }
  if ((task.kind !== 'task' && task.kind !== 'procurement') || !URGENCY_VALUES.has(String(task.urgency))) throw new Error('任务类型或紧急度无效');
}

function validateInput(name: AppCommandName, value: unknown): void {
  const input = object(value, '命令参数');
  switch (name) {
    case 'create_task':
      if (input.kind === 'task' || input.kind === 'procurement') taskInput(input);
      else if (input.kind === 'misc') {
        exact(input, ['kind', 'name', 'note', 'remindAtUtc', 'tzId']);
        string(input, 'name'); string(input, 'note'); nullableString(input, 'remindAtUtc'); string(input, 'tzId');
      } else throw new Error('任务类型无效');
      break;
    case 'update_task': exact(input, ['taskId', 'task']); string(input, 'taskId'); taskInput(input.task); break;
    case 'set_task_name':
      exact(input, ['taskId', 'name', 'expectedName']); string(input, 'taskId'); string(input, 'name'); string(input, 'expectedName'); break;
    case 'set_task_names':
      exact(input, ['taskId', 'fullName', 'shortName', 'expectedFullName', 'expectedShortName']);
      string(input, 'taskId'); string(input, 'fullName'); string(input, 'shortName'); string(input, 'expectedFullName'); string(input, 'expectedShortName'); break;
    case 'set_task_urgency':
      exact(input, ['taskId', 'urgency', 'expectedUrgency']); string(input, 'taskId');
      if (!URGENCY_VALUES.has(String(input.urgency)) || !URGENCY_VALUES.has(String(input.expectedUrgency))) throw new Error('紧急度无效');
      break;
    case 'complete_task': case 'cancel_task': case 'restore_task': case 'delete_task': taskIdOnly(input); break;
    case 'set_reminders': {
      exact(input, ['taskId', 'offsets']); string(input, 'taskId');
      const offsets = input.offsets;
      if (!Array.isArray(offsets) || !offsets.every((item) => Number.isInteger(item) && Number(item) >= 1 && Number(item) <= 525600)) {
        throw new Error('offsets 必须是有效分钟数组');
      }
      break;
    }
    case 'set_misc_reminder':
      exact(input, ['taskId', 'remindAtUtc', 'expectedRemindAtUtc']); string(input, 'taskId');
      nullableString(input, 'remindAtUtc'); nullableString(input, 'expectedRemindAtUtc'); break;
    case 'add_node': exact(input, ['taskId', 'node']); string(input, 'taskId'); nodeInput(input.node); break;
    case 'update_node': exact(input, ['nodeId', 'node']); string(input, 'nodeId'); nodeInput(input.node); break;
    case 'set_node_title':
      exact(input, ['nodeId', 'title', 'expectedTitle']); string(input, 'nodeId'); string(input, 'title'); string(input, 'expectedTitle'); break;
    case 'set_node_start_time':
      exact(input, ['nodeId', 'startUtc', 'expectedStartUtc']); string(input, 'nodeId');
      nullableString(input, 'startUtc'); nullableString(input, 'expectedStartUtc'); break;
    case 'set_node_status':
      exact(input, ['nodeId', 'status']); string(input, 'nodeId');
      if (!NODE_STATUS_VALUES.has(String(input.status))) throw new Error('节点状态无效');
      break;
    case 'reorder_nodes': exact(input, ['taskId', 'orderedNodeIds']); string(input, 'taskId'); stringArray(input, 'orderedNodeIds'); break;
    case 'remove_node': taskIdOnly(input, 'nodeId'); break;
    case 'add_link': {
      exact(input, ['taskId', 'link']); string(input, 'taskId');
      const link = object(input.link, '资料'); exact(link, ['kind', 'title', 'target']); string(link, 'title'); string(link, 'target');
      if (link.kind !== 'url' && link.kind !== 'file') throw new Error('资料类型无效');
      break;
    }
    case 'remove_link': taskIdOnly(input, 'linkId'); break;
    case 'save_note': exact(input, ['taskId', 'body']); string(input, 'taskId'); string(input, 'body'); break;
    case 'resolve_legacy_misc_deadline':
      exact(input, ['taskId', 'action', 'expectedDeadlineUtc']); string(input, 'taskId'); string(input, 'expectedDeadlineUtc');
      if (input.action !== 'convert' && input.action !== 'clear') throw new Error('旧截止时间操作无效');
      break;
    case 'create_procurement_project': procurementCreateInput(input); break;
    case 'apply_procurement_plan':
      exact(input, ['taskId', 'templateId', 'templateVersion', 'procurementMethod', 'nodes', 'expectedUpdatedAtUtc']);
      string(input, 'taskId'); nullableString(input, 'templateId'); string(input, 'expectedUpdatedAtUtc');
      if (input.templateVersion !== null && (!Number.isInteger(input.templateVersion) || Number(input.templateVersion) < 1)) throw new Error('模板版本无效');
      if (!PROCUREMENT_METHOD_VALUES.has(String(input.procurementMethod))) throw new Error('采购方式无效');
      if (!Array.isArray(input.nodes)) throw new Error('采购节点计划无效');
      input.nodes.forEach(nodeInput);
      break;
    case 'create_contract': contractCreateInput(input); break;
    case 'update_contract': contractCreateInput(input, true); break;
    case 'set_contract_status':
      exact(input, ['contractId', 'status', 'expectedStatus']); string(input, 'contractId');
      if (!CONTRACT_STATUS_VALUES.has(String(input.status)) || !CONTRACT_STATUS_VALUES.has(String(input.expectedStatus))) throw new Error('合同状态无效');
      break;
    case 'restore_contract': taskIdOnly(input, 'contractId'); break;
    case 'add_contract_action': exact(input, ['contractId', 'action']); string(input, 'contractId'); contractActionInput(input.action); break;
    case 'update_contract_action': exact(input, ['actionId', 'input', 'expectedUpdatedAtUtc']); string(input, 'actionId'); string(input, 'expectedUpdatedAtUtc'); contractActionInput(input.input); break;
    case 'set_contract_action_status':
      exact(input, ['actionId', 'status', 'expectedStatus']); string(input, 'actionId');
      if (!CONTRACT_ACTION_STATUS_VALUES.has(String(input.status)) || !CONTRACT_ACTION_STATUS_VALUES.has(String(input.expectedStatus))) throw new Error('履约动作状态无效');
      break;
    case 'remove_contract_action': taskIdOnly(input, 'actionId'); break;
    case 'set_contract_action_reminder': exact(input, ['actionId', 'fireAtUtc', 'expectedFireAtUtc']); string(input, 'actionId'); nullableString(input, 'fireAtUtc'); nullableString(input, 'expectedFireAtUtc'); break;
    case 'add_contract_link': {
      exact(input, ['contractId', 'link']); string(input, 'contractId'); const link = object(input.link, '合同资料'); exact(link, ['kind', 'title', 'target']);
      if (link.kind !== 'url' && link.kind !== 'file') throw new Error('合同资料类型无效'); string(link, 'title'); string(link, 'target'); break;
    }
    case 'remove_contract_link': taskIdOnly(input, 'linkId'); break;
    case 'save_contract_note': exact(input, ['contractId', 'body']); string(input, 'contractId'); string(input, 'body'); break;
    case 'bind_workspace_project':
      exact(input, ['directoryId', 'relativeRoot', 'taskId']); string(input, 'directoryId'); string(input, 'relativeRoot'); string(input, 'taskId'); break;
    case 'create_automation': case 'update_automation': {
      const required = name === 'update_automation'
        ? ['automationId', 'name', 'prompt', 'scheduleKind', 'timeZone', 'localTime', 'weekdays', 'runAtUtc', 'expectedUpdatedAtUtc']
        : ['name', 'prompt', 'scheduleKind', 'timeZone', 'localTime', 'weekdays', 'runAtUtc'];
      exact(input, required); string(input, 'name'); string(input, 'prompt'); string(input, 'timeZone'); string(input, 'localTime'); nullableString(input, 'runAtUtc');
      if (name === 'update_automation') { string(input, 'automationId'); string(input, 'expectedUpdatedAtUtc'); }
      if (!['once', 'daily', 'weekly'].includes(String(input.scheduleKind))) throw new Error('自动化计划类型无效');
      if (!Array.isArray(input.weekdays) || !input.weekdays.every((day) => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6)) throw new Error('自动化星期无效');
      break;
    }
    case 'set_automation_enabled': exact(input, ['automationId', 'enabled', 'expectedUpdatedAtUtc']); string(input, 'automationId'); string(input, 'expectedUpdatedAtUtc'); if (typeof input.enabled !== 'boolean') throw new Error('enabled 必须是布尔值'); break;
    case 'delete_automation': taskIdOnly(input, 'automationId'); break;
  }
}

/** Runtime boundary used by the local CLI. It rejects unknown fields before a command reaches AppService. */
export function parseAppCommand(value: unknown): AppCommand {
  const command = object(value, '请求');
  exact(command, ['name', 'input']);
  if (typeof command.name !== 'string' || !APP_COMMAND_NAMES.includes(command.name as AppCommandName)) throw new Error('命令未注册');
  validateInput(command.name as AppCommandName, command.input);
  return command as unknown as AppCommand;
}
