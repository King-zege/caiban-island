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

export interface ProgressInfo {
  done: number;
  total: number;
  nextTitle: string | null; // total=0 → 尚未拆分
}

export interface TaskCardNode {
  id: string;
  title: string;
  status: NodeStatus;
  position: number;
}

export interface TaskCard {
  task: Task;
  progress: ProgressInfo;
  nodes: TaskCardNode[];
  overdue: boolean;
}

export interface TaskDetail {
  task: Task;
  nodes: TaskNode[];
  links: TaskLink[];
  note: string;
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
