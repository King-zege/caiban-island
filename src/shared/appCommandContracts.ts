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
  TaskUrgencyUpdateRequest
} from './taskContracts';

export const APP_COMMAND_NAMES = [
  'create_task', 'update_task', 'set_task_name', 'set_task_urgency',
  'complete_task', 'cancel_task', 'restore_task', 'delete_task',
  'set_reminders', 'set_misc_reminder', 'add_node', 'update_node',
  'set_node_title', 'set_node_start_time', 'set_node_status', 'reorder_nodes',
  'remove_node', 'add_link', 'remove_link', 'save_note',
  'resolve_legacy_misc_deadline', 'confirm_legacy_draft'
] as const;

export type AppCommandName = (typeof APP_COMMAND_NAMES)[number];

export type AppCommand =
  | { name: 'create_task'; input: TaskCreateRequest }
  | { name: 'update_task'; input: { taskId: string; task: TaskInput } }
  | { name: 'set_task_name'; input: TaskNameUpdateRequest }
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
  | { name: 'confirm_legacy_draft'; input: { draftId: string } };

export interface AppCommandResult {
  command: AppCommandName;
  summary: string;
  entityId?: string;
  undoable: boolean;
  data?: unknown;
}

const URGENCY_VALUES = new Set(['critical', 'high', 'normal', 'low']);
const NODE_STATUS_VALUES = new Set(['pending', 'in_progress', 'completed', 'cancelled']);

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

function string(record: Record<string, unknown>, key: string): void {
  if (typeof record[key] !== 'string') throw new Error(key + ' 必须是字符串');
}

function nullableString(record: Record<string, unknown>, key: string): void {
  if (record[key] !== null && typeof record[key] !== 'string') throw new Error(key + ' 必须是字符串或 null');
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
  exact(node, ['title', 'description', 'startUtc', 'endUtc']);
  string(node, 'title'); string(node, 'description'); nullableString(node, 'startUtc'); nullableString(node, 'endUtc');
}

function taskInput(value: unknown): void {
  const task = object(value, '任务');
  exact(task, ['name', 'description', 'kind', 'urgency', 'deadlineUtc', 'tzId']);
  string(task, 'name'); string(task, 'description'); string(task, 'tzId'); nullableString(task, 'deadlineUtc');
  if (task.kind !== 'task' || !URGENCY_VALUES.has(String(task.urgency))) throw new Error('任务类型或紧急度无效');
}

function validateInput(name: AppCommandName, value: unknown): void {
  const input = object(value, '命令参数');
  switch (name) {
    case 'create_task':
      if (input.kind === 'task') taskInput(input);
      else if (input.kind === 'misc') {
        exact(input, ['kind', 'name', 'note', 'remindAtUtc', 'tzId']);
        string(input, 'name'); string(input, 'note'); nullableString(input, 'remindAtUtc'); string(input, 'tzId');
      } else throw new Error('任务类型无效');
      break;
    case 'update_task': exact(input, ['taskId', 'task']); string(input, 'taskId'); taskInput(input.task); break;
    case 'set_task_name':
      exact(input, ['taskId', 'name', 'expectedName']); string(input, 'taskId'); string(input, 'name'); string(input, 'expectedName'); break;
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
    case 'confirm_legacy_draft': taskIdOnly(input, 'draftId'); break;
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
