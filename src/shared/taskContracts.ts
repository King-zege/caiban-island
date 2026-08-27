export const URGENCIES = ['critical', 'high', 'normal', 'low'] as const;
export type Urgency = (typeof URGENCIES)[number];

export const KINDS = ['task', 'misc'] as const;
export type TaskKind = (typeof KINDS)[number];

export type TaskStatus = 'active' | 'archived';

export const NODE_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export interface Task {
  id: string;
  name: string;
  description: string;
  kind: TaskKind;
  urgency: Urgency;
  deadlineUtc: string | null;
  remindAtUtc: string | null;
  tzId: string;
  status: TaskStatus;
  createdAtUtc: string;
  updatedAtUtc: string;
  archivedAt: string | null;
  archiveOutcome: 'completed' | 'cancelled' | null;
}

export interface TaskNode {
  id: string;
  taskId: string;
  title: string;
  description: string;
  startUtc: string | null;
  endUtc: string | null;
  status: NodeStatus;
  position: number;
}

export interface NodeInput {
  title: string;
  description: string;
  startUtc: string | null;
  endUtc: string | null;
}

export interface NodeTimeUpdateRequest {
  nodeId: string;
  startUtc: string | null;
  expectedStartUtc: string | null;
}

export interface NodeTitleUpdateRequest {
  nodeId: string;
  title: string;
  expectedTitle: string;
}

export type ReminderEvent =
  | { type: 'fallback'; message: string }
  | { type: 'open-node'; taskId: string; nodeId: string }
  | { type: 'open-misc'; taskId: string };

export type LinkKind = 'url' | 'file';

export interface TaskLink {
  id: string;
  taskId: string;
  kind: LinkKind;
  title: string;
  target: string;
  meta: string;
}

export interface LinkInput {
  kind: LinkKind;
  title: string;
  target: string;
}

export interface TaskInput {
  name: string;
  description: string;
  kind: TaskKind;
  urgency: Urgency;
  deadlineUtc: string | null;
  tzId: string;
}

export interface ProjectTaskCreateRequest {
  kind: 'task';
  name: string;
  description: string;
  urgency: Urgency;
  deadlineUtc: string | null;
  tzId: string;
}

export interface MiscTaskCreateRequest {
  kind: 'misc';
  name: string;
  note: string;
  remindAtUtc: string | null;
  tzId: string;
}

export type TaskCreateRequest = ProjectTaskCreateRequest | MiscTaskCreateRequest;

export type MiscReminderState = 'none' | 'scheduled' | 'fired' | 'legacy_deadline';

export interface MiscReminderSummary {
  state: MiscReminderState;
  fireAtUtc: string | null;
  legacyDeadlineUtc: string | null;
}

export interface MiscReminderUpdateRequest {
  taskId: string;
  remindAtUtc: string | null;
  expectedRemindAtUtc: string | null;
}

export interface LegacyMiscDeadlineActionRequest {
  taskId: string;
  action: 'convert' | 'clear';
  expectedDeadlineUtc: string;
}

export interface TaskUrgencyUpdateRequest {
  taskId: string;
  urgency: Urgency;
  expectedUrgency: Urgency;
}

export interface TaskNameUpdateRequest {
  taskId: string;
  name: string;
  expectedName: string;
}

export interface ProgressInfo {
  done: number;
  total: number;
  nextTitle: string | null; // total=0 → 尚未拆分
}

export interface TaskCardNode {
  id: string;
  title: string;
  startUtc: string | null;
  status: NodeStatus;
  position: number;
}

export interface TaskCard {
  task: Task;
  progress: ProgressInfo;
  nodes: TaskCardNode[];
  overdue: boolean;
  miscReminder: MiscReminderSummary | null;
}

export interface TaskDetail {
  task: Task;
  nodes: TaskNode[];
  links: TaskLink[];
  note: string;
  miscReminder: MiscReminderSummary | null;
}

export interface ArchivedItem {
  id: string;
  name: string;
  kind: string;
  urgency: string;
  outcome: 'completed' | 'cancelled';
  archivedAt: string;
}

export interface ArchivedDetail {
  task: TaskDetail;
  events: Array<{ at: string; kind: string; detail: string }>;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };
