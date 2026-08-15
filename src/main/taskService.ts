import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { validateTaskInput } from '../shared/validation';
import { compareTasks, computeProgress, isOverdue } from '../shared/sorting';
import type { Task, TaskCard, TaskInput } from '../shared/taskContracts';

function toTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    kind: String(row.kind) as Task['kind'],
    urgency: String(row.urgency) as Task['urgency'],
    deadlineUtc: row.deadline_utc === null ? null : String(row.deadline_utc),
    tzId: String(row.tz_id),
    status: String(row.status) as Task['status'],
    createdAtUtc: String(row.created_at),
    updatedAtUtc: String(row.updated_at)
  };
}

export class TaskError extends Error {}

export class TaskService {
  constructor(private readonly db: DatabaseSync) {}

  listActive(nowMs = Date.now()): TaskCard[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks WHERE status = 'active' ORDER BY created_at")
      .all() as unknown as Record<string, unknown>[];
    const tasks = rows.map(toTask).sort(compareTasks);
    const nodeRows = this.db
      .prepare('SELECT id, task_id, title, status, position FROM nodes ORDER BY position')
      .all() as unknown as Record<string, unknown>[];
    const byTask = new Map<string, Array<{ status: string; title: string; position: number }>>();
    for (const n of nodeRows) {
      const key = String(n.task_id);
      const list = byTask.get(key) ?? [];
      list.push({ status: String(n.status), title: String(n.title), position: Number(n.position) });
      byTask.set(key, list);
    }
    return tasks.map((task) => ({
      task,
      progress: computeProgress(byTask.get(task.id) ?? []),
      overdue: isOverdue(task, nowMs)
    }));
  }

  getTask(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? toTask(row) : null;
  }

  createTask(input: TaskInput): Task {
    const v = validateTaskInput(input);
    if (!v.ok) throw new TaskError(v.errors.join('；'));
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      name: input.name.trim(),
      description: input.description.trim(),
      kind: input.kind,
      urgency: input.urgency,
      deadlineUtc: input.deadlineUtc,
      tzId: input.tzId,
      status: 'active',
      createdAtUtc: now,
      updatedAtUtc: now
    };
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          'INSERT INTO tasks(id, name, description, kind, urgency, deadline_utc, tz_id, status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
        )
        .run(task.id, task.name, task.description, task.kind, task.urgency, task.deadlineUtc, task.tzId, task.status, task.createdAtUtc, task.updatedAtUtc);
      this.logEvent(task.id, 'task_created', JSON.stringify({ name: task.name }));
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return task;
  }

  updateTask(id: string, input: TaskInput): Task {
    const existing = this.getTask(id);
    if (!existing) throw new TaskError('任务不存在');
    const v = validateTaskInput(input);
    if (!v.ok) throw new TaskError(v.errors.join('；'));
    const name = input.name.trim();
    const description = input.description.trim();
    const updated = new Date().toISOString();
    this.db
      .prepare('UPDATE tasks SET name=?, description=?, kind=?, urgency=?, deadline_utc=?, tz_id=?, updated_at=? WHERE id=?')
      .run(name, description, input.kind, input.urgency, input.deadlineUtc, input.tzId, updated, id);
    this.logEvent(id, 'task_updated', JSON.stringify({ name }));
    return this.getTask(id) as Task;
  }

  setArchived(id: string, outcome: 'completed' | 'cancelled'): Task {
    const existing = this.getTask(id);
    if (!existing) throw new TaskError('任务不存在');
    if (existing.status !== 'active') throw new TaskError('任务已归档');
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE tasks SET status=?, archived_at=?, archive_outcome=?, updated_at=? WHERE id=?')
      .run('archived', now, outcome, now, id);
    this.logEvent(id, 'task_archived', JSON.stringify({ outcome }));
    return this.getTask(id) as Task;
  }

  private logEvent(taskId: string, kind: string, detail: string): void {
    this.db
      .prepare('INSERT INTO change_events(task_id, at_utc, kind, detail) VALUES(?,?,?,?)')
      .run(taskId, new Date().toISOString(), kind, detail);
  }
}
