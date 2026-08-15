import type { ProgressInfo, Task } from './taskContracts';

const URGENCY_RANK: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };

// FR-030：紧急度（紧急→低）→ 有 deadline 优先 → deadline 升序 → 创建时间升序 → ID 升序
export function compareTasks(a: Task, b: Task): number {
  const rankA = URGENCY_RANK[a.urgency] ?? 99;
  const rankB = URGENCY_RANK[b.urgency] ?? 99;
  if (rankA !== rankB) return rankA - rankB;
  const hasA = a.deadlineUtc !== null;
  const hasB = b.deadlineUtc !== null;
  if (hasA !== hasB) return hasA ? -1 : 1;
  if (hasA && hasB && a.deadlineUtc !== b.deadlineUtc) {
    const da = Date.parse(a.deadlineUtc as string);
    const db = Date.parse(b.deadlineUtc as string);
    if (da !== db) return da - db;
  }
  if (a.createdAtUtc !== b.createdAtUtc) {
    return Date.parse(a.createdAtUtc) - Date.parse(b.createdAtUtc);
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface ProgressNodeLike {
  status: string;
  title: string;
  position: number;
}

export function computeProgress(nodes: ProgressNodeLike[]): ProgressInfo {
  const ordered = [...nodes].sort((a, b) => a.position - b.position);
  if (ordered.length === 0) return { done: 0, total: 0, nextTitle: null };
  const done = ordered.filter((n) => n.status === 'completed').length;
  const next = ordered.find((n) => n.status !== 'completed');
  return { done, total: ordered.length, nextTitle: next ? next.title : null };
}

export function isOverdue(task: Pick<Task, 'deadlineUtc'>, nowMs: number): boolean {
  return task.deadlineUtc !== null && Date.parse(task.deadlineUtc) < nowMs;
}
