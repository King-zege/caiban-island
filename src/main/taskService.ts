import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { validateNodeInput, validateNodeStartSchedule, validateTaskInput } from '../shared/validation';
import { compareTasks, computeProgress, isOverdue } from '../shared/sorting';
import type {
  LinkInput,
  LinkKind,
  NodeInput,
  NodeStatus,
  NodeTimeUpdateRequest,
  Task,
  TaskCard,
  TaskCardNode,
  TaskDetail,
  TaskInput,
  TaskLink,
  TaskNode
} from '../shared/taskContracts';

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
    updatedAtUtc: String(row.updated_at),
    archivedAt: row.archived_at === null ? null : String(row.archived_at),
    archiveOutcome: row.archive_outcome === null ? null : (String(row.archive_outcome) as Task['archiveOutcome'])
  };
}

function toNode(row: Record<string, unknown>): TaskNode {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    title: String(row.title),
    description: String(row.description),
    startUtc: row.start_utc === null ? null : String(row.start_utc),
    endUtc: row.end_utc === null ? null : String(row.end_utc),
    status: String(row.status) as NodeStatus,
    position: Number(row.position)
  };
}

function toLink(row: Record<string, unknown>): TaskLink {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    kind: String(row.kind) as LinkKind,
    title: String(row.title),
    target: String(row.target),
    meta: String(row.meta)
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
      .prepare('SELECT id, task_id, title, start_utc, status, position FROM nodes ORDER BY position')
      .all() as unknown as Record<string, unknown>[];
    const byTask = new Map<string, TaskCardNode[]>();
    for (const n of nodeRows) {
      const key = String(n.task_id);
      const list = byTask.get(key) ?? [];
      list.push({
        id: String(n.id),
        status: String(n.status) as NodeStatus,
        title: String(n.title),
        startUtc: n.start_utc === null ? null : String(n.start_utc),
        position: Number(n.position)
      });
      byTask.set(key, list);
    }
    return tasks.map((task) => {
      const nodes = byTask.get(task.id) ?? [];
      return {
        task,
        progress: computeProgress(nodes),
        nodes,
        overdue: isOverdue(task, nowMs)
      };
    });
  }

  getTask(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? toTask(row) : null;
  }

  getTaskDetail(id: string): TaskDetail {
    const task = this.getTask(id);
    if (!task) throw new TaskError('任务不存在');
    const nodes = (
      this.db.prepare('SELECT * FROM nodes WHERE task_id = ? ORDER BY position').all(id) as unknown as Record<string, unknown>[]
    ).map(toNode);
    const links = (
      this.db.prepare('SELECT * FROM links WHERE task_id = ? ORDER BY rowid').all(id) as unknown as Record<string, unknown>[]
    ).map(toLink);
    const noteRow = this.db.prepare('SELECT body FROM notes WHERE task_id = ?').get(id) as { body: string } | undefined;
    return { task, nodes, links, note: noteRow ? noteRow.body : '' };
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
      updatedAtUtc: now,
      archivedAt: null,
      archiveOutcome: null
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

  listArchived(): Array<{ id: string; name: string; kind: string; urgency: string; deadlineUtc: string | null; outcome: string; archivedAt: string }> {
    return this.db
      .prepare("SELECT id, name, kind, urgency, deadline_utc AS deadlineUtc, archive_outcome AS outcome, archived_at AS archivedAt FROM tasks WHERE status = 'archived' ORDER BY archived_at DESC")
      .all() as unknown as Array<{ id: string; name: string; kind: string; urgency: string; deadlineUtc: string | null; outcome: string; archivedAt: string }>;
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

  deleteTask(id: string): void {
    const existing = this.getTask(id);
    if (!existing) throw new TaskError('任务不存在');
    if (existing.status !== 'active') throw new TaskError('只能永久删除活跃任务');
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM change_events WHERE task_id = ?').run(id);
      this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // —— 节点 ——
  addNode(taskId: string, input: NodeInput): TaskNode {
    const task = this.getTask(taskId);
    if (!task) throw new TaskError('任务不存在');
    if (task.kind === 'misc') throw new TaskError('杂事不支持节点时间轴');
    const v = validateNodeInput(input);
    if (!v.ok) throw new TaskError(v.errors.join('；'));
    const schedule = validateNodeStartSchedule(input.startUtc, 'pending', null);
    if (!schedule.ok) throw new TaskError(schedule.errors.join('；'));
    const maxRow = this.db.prepare('SELECT MAX(position) AS m FROM nodes WHERE task_id = ?').get(taskId) as { m: number | null };
    const node: TaskNode = {
      id: randomUUID(),
      taskId,
      title: input.title.trim(),
      description: input.description.trim(),
      startUtc: input.startUtc,
      endUtc: input.endUtc,
      status: 'pending',
      position: (maxRow.m ?? -1) + 1
    };
    this.db
      .prepare('INSERT INTO nodes(id, task_id, title, description, start_utc, end_utc, status, position) VALUES(?,?,?,?,?,?,?,?)')
      .run(node.id, node.taskId, node.title, node.description, node.startUtc, node.endUtc, node.status, node.position);
    this.logEvent(taskId, 'node_added', JSON.stringify({ nodeId: node.id, title: node.title }));
    return node;
  }

  updateNode(nodeId: string, input: NodeInput): TaskNode {
    const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as Record<string, unknown> | undefined;
    if (!row) throw new TaskError('节点不存在');
    const v = validateNodeInput(input);
    if (!v.ok) throw new TaskError(v.errors.join('；'));
    const schedule = validateNodeStartSchedule(
      input.startUtc,
      String(row.status) as NodeStatus,
      row.start_utc === null ? null : String(row.start_utc)
    );
    if (!schedule.ok) throw new TaskError(schedule.errors.join('；'));
    this.db
      .prepare('UPDATE nodes SET title=?, description=?, start_utc=?, end_utc=? WHERE id=?')
      .run(input.title.trim(), input.description.trim(), input.startUtc, input.endUtc, nodeId);
    this.logEvent(String(row.task_id), 'node_updated', JSON.stringify({ nodeId }));
    return toNode(this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as Record<string, unknown>);
  }

  setNodeStartTime(request: NodeTimeUpdateRequest): TaskNode {
    const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(request.nodeId) as Record<string, unknown> | undefined;
    if (!row) throw new TaskError('节点不存在');
    const current = row.start_utc === null ? null : String(row.start_utc);
    if (current !== request.expectedStartUtc) throw new TaskError('节点时间已变化，请刷新后重试');
    const input: NodeInput = {
      title: String(row.title),
      description: String(row.description),
      startUtc: request.startUtc,
      endUtc: row.end_utc === null ? null : String(row.end_utc)
    };
    const validation = validateNodeInput(input);
    if (!validation.ok) throw new TaskError(validation.errors.join('；'));
    const schedule = validateNodeStartSchedule(request.startUtc, String(row.status) as NodeStatus, current);
    if (!schedule.ok) throw new TaskError(schedule.errors.join('；'));
    this.db.prepare('UPDATE nodes SET start_utc = ? WHERE id = ?').run(request.startUtc, request.nodeId);
    this.logEvent(String(row.task_id), 'node_time_updated', JSON.stringify({ nodeId: request.nodeId, hasStart: request.startUtc !== null }));
    return toNode(this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(request.nodeId) as Record<string, unknown>);
  }

  removeNode(nodeId: string): void {
    const row = this.db.prepare('SELECT task_id, position FROM nodes WHERE id = ?').get(nodeId) as
      | { task_id: string; position: number }
      | undefined;
    if (!row) throw new TaskError('节点不存在');
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM nodes WHERE id = ?').run(nodeId);
      this.db.prepare('UPDATE nodes SET position = position - 1 WHERE task_id = ? AND position > ?').run(row.task_id, row.position);
      this.logEvent(row.task_id, 'node_removed', JSON.stringify({ nodeId }));
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  setNodeStatus(nodeId: string, status: NodeStatus): TaskNode {
    const valid: NodeStatus[] = ['pending', 'in_progress', 'completed', 'cancelled'];
    if (!valid.includes(status)) throw new TaskError('无效的节点状态');
    const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as Record<string, unknown> | undefined;
    if (!row) throw new TaskError('节点不存在');
    this.db.prepare('UPDATE nodes SET status = ? WHERE id = ?').run(status, nodeId);
    this.logEvent(String(row.task_id), 'node_status', JSON.stringify({ nodeId, status }));
    return toNode(this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as Record<string, unknown>);
  }

  reorderNodes(taskId: string, orderedIds: string[]): void {
    const task = this.getTask(taskId);
    if (!task) throw new TaskError('任务不存在');
    const rows = this.db.prepare('SELECT id FROM nodes WHERE task_id = ?').all(taskId) as unknown as { id: string }[];
    const ids = new Set(rows.map((r) => r.id));
    if (orderedIds.length !== rows.length || orderedIds.some((id) => !ids.has(id))) {
      throw new TaskError('节点列表与任务不匹配');
    }
    this.db.exec('BEGIN');
    try {
      orderedIds.forEach((id, idx) => this.db.prepare('UPDATE nodes SET position = ? WHERE id = ?').run(idx, id));
      this.logEvent(taskId, 'nodes_reordered', JSON.stringify({ count: orderedIds.length }));
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // —— 链接 ——
  addLink(taskId: string, input: LinkInput): TaskLink {
    const task = this.getTask(taskId);
    if (!task) throw new TaskError('任务不存在');
    const target = input.target.trim();
    if (input.kind === 'url') {
      if (!/^https?:\/\/\S+$/i.test(target)) throw new TaskError('网址仅支持 http/https');
    } else {
      if (target.length === 0) throw new TaskError('文件路径不能为空');
    }
    const link: TaskLink = {
      id: randomUUID(),
      taskId,
      kind: input.kind,
      title: input.title.trim() || target,
      target,
      meta: JSON.stringify({ addedAt: new Date().toISOString() })
    };
    this.db.prepare('INSERT INTO links(id, task_id, kind, title, target, meta) VALUES(?,?,?,?,?,?)').run(
      link.id,
      link.taskId,
      link.kind,
      link.title,
      link.target,
      link.meta
    );
    this.logEvent(taskId, 'link_added', JSON.stringify({ linkId: link.id, kind: link.kind }));
    return link;
  }

  removeLink(linkId: string): void {
    const row = this.db.prepare('SELECT task_id FROM links WHERE id = ?').get(linkId) as { task_id: string } | undefined;
    if (!row) throw new TaskError('链接不存在');
    this.db.prepare('DELETE FROM links WHERE id = ?').run(linkId);
    this.logEvent(row.task_id, 'link_removed', JSON.stringify({ linkId }));
  }

  // —— 备注 ——
  saveNote(taskId: string, body: string): void {
    const task = this.getTask(taskId);
    if (!task) throw new TaskError('任务不存在');
    const now = new Date().toISOString();
    // 每任务一条备注：以 taskId 为主键，幂等更新
    this.db
      .prepare('INSERT INTO notes(id, task_id, body, updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at')
      .run(taskId, taskId, body, now);
    this.logEvent(taskId, 'note_saved', JSON.stringify({ chars: body.length }));
  }

  private logEvent(taskId: string, kind: string, detail: string): void {
    this.db
      .prepare('INSERT INTO change_events(task_id, at_utc, kind, detail) VALUES(?,?,?,?)')
      .run(taskId, new Date().toISOString(), kind, detail);
  }
}
