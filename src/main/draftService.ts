import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { validateNodeInput, validateTaskInput } from '../shared/validation';
import type { DraftPayload, DraftRecord, DraftSource, DraftState, TaskDraftPayload } from '../shared/draftContracts';

export class DraftError extends Error {}

function parsePayload(raw: string): DraftPayload {
  try {
    const value: unknown = JSON.parse(raw);
    assertPayloadShape(value);
    return value;
  } catch {
    throw new DraftError('草稿数据损坏');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function assertNodeShape(value: unknown): void {
  if (
    !isRecord(value) ||
    typeof value.title !== 'string' ||
    typeof value.description !== 'string' ||
    !isNullableString(value.startUtc) ||
    !isNullableString(value.endUtc)
  ) {
    throw new DraftError('草稿数据损坏');
  }
}

function assertPayloadShape(value: unknown): asserts value is DraftPayload {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.warnings)) {
    throw new DraftError('草稿数据损坏');
  }
  if (!value.warnings.every((warning) => typeof warning === 'string')) throw new DraftError('草稿数据损坏');
  value.nodes.forEach(assertNodeShape);
  if (value.type === 'task') {
    if (!isRecord(value.taskInput)) throw new DraftError('草稿数据损坏');
    const input = value.taskInput;
    if (
      typeof input.name !== 'string' ||
      typeof input.description !== 'string' ||
      typeof input.kind !== 'string' ||
      typeof input.urgency !== 'string' ||
      !isNullableString(input.deadlineUtc) ||
      typeof input.tzId !== 'string'
    ) {
      throw new DraftError('草稿数据损坏');
    }
    return;
  }
  if (value.type === 'nodes' && typeof value.taskId === 'string') return;
  throw new DraftError('草稿数据损坏');
}

// FR-043~048：AI 输出永远是草稿；确认走单事务；校验失败可修复一次
export class DraftService {
  constructor(private readonly db: DatabaseSync) {}

  create(source: DraftSource, payload: DraftPayload): DraftRecord {
    this.validatePayload(payload);
    const record: DraftRecord = {
      id: randomUUID(),
      source,
      payload,
      state: 'pending',
      createdAt: new Date().toISOString()
    };
    this.db
      .prepare('INSERT INTO drafts(id, source, payload, state, created_at) VALUES(?,?,?,?,?)')
      .run(record.id, record.source, JSON.stringify(record.payload), record.state, record.createdAt);
    return record;
  }

  private validatePayload(payload: unknown): asserts payload is DraftPayload {
    assertPayloadShape(payload);
    if (payload.type === 'task') {
      const v = validateTaskInput(payload.taskInput);
      if (!v.ok) throw new DraftError('任务字段校验失败：' + v.errors.join('；'));
    } else if (payload.type === 'nodes') {
      const task = this.db.prepare("SELECT kind, status FROM tasks WHERE id = ?").get(payload.taskId) as
        | { kind: string; status: string }
        | undefined;
      if (!task) throw new DraftError('任务不存在');
      if (task.status !== 'active') throw new DraftError('任务已归档');
      if (task.kind === 'misc') throw new DraftError('杂事不支持节点');
    }
    for (const n of payload.nodes) {
      const v = validateNodeInput(n);
      if (!v.ok) throw new DraftError('节点校验失败：' + v.errors.join('；'));
    }
  }

  listPending(): DraftRecord[] {
    const rows = this.db
      .prepare("SELECT id, source, payload, state, created_at AS createdAt FROM drafts WHERE state = 'pending' ORDER BY created_at DESC")
      .all() as unknown as Array<{ id: string; source: string; payload: string; state: string; createdAt: string }>;
    return rows.map((r) => ({
      id: r.id,
      source: r.source as DraftSource,
      payload: parsePayload(r.payload),
      state: r.state as DraftState,
      createdAt: r.createdAt
    }));
  }

  get(id: string): DraftRecord {
    const row = this.db.prepare('SELECT id, source, payload, state, created_at AS createdAt FROM drafts WHERE id = ?').get(id) as
      | { id: string; source: string; payload: string; state: string; createdAt: string }
      | undefined;
    if (!row) throw new DraftError('草稿不存在');
    return {
      id: row.id,
      source: row.source as DraftSource,
      payload: parsePayload(row.payload),
      state: row.state as DraftState,
      createdAt: row.createdAt
    };
  }

  updatePayload(id: string, payload: DraftPayload): DraftRecord {
    const row = this.db.prepare("SELECT id FROM drafts WHERE id = ? AND state = 'pending'").get(id) as { id: string } | undefined;
    if (!row) throw new DraftError('草稿不存在或已处理');
    this.validatePayload(payload);
    this.db.prepare('UPDATE drafts SET payload = ? WHERE id = ?').run(JSON.stringify(payload), id);
    return this.get(id);
  }

  discard(id: string): void {
    const r = this.db.prepare("UPDATE drafts SET state = 'discarded' WHERE id = ? AND state = 'pending'").run(id);
    if (r.changes === 0) throw new DraftError('草稿不存在或已处理');
  }

  // FR-045：确认通过单事务写入正式数据
  confirm(id: string): { type: 'task' | 'nodes'; taskId: string } {
    const draft = this.get(id);
    if (draft.state !== 'pending') throw new DraftError('草稿已处理');
    this.validatePayload(draft.payload);
    this.db.exec('BEGIN');
    try {
      let taskId: string;
      if (draft.payload.type === 'task') {
        taskId = this.applyTaskPayload(draft.payload);
      } else {
        this.applyNodesPayload(draft.payload);
        taskId = draft.payload.taskId;
      }
      this.db.prepare("UPDATE drafts SET state = 'confirmed' WHERE id = ?").run(id);
      this.db.exec('COMMIT');
      return { type: draft.payload.type, taskId };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  private applyTaskPayload(p: TaskDraftPayload): string {
    const now = new Date().toISOString();
    const taskId = randomUUID();
    const input = p.taskInput;
    this.db
      .prepare(
        'INSERT INTO tasks(id, name, description, kind, urgency, deadline_utc, tz_id, status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
      )
      .run(taskId, input.name.trim(), input.description.trim(), input.kind, input.urgency, input.deadlineUtc, input.tzId, 'active', now, now);
    this.db
      .prepare('INSERT INTO change_events(task_id, at_utc, kind, detail) VALUES(?,?,?,?)')
      .run(taskId, now, 'draft_confirmed', JSON.stringify({ source: 'draft', nodes: p.nodes.length }));
    let pos = 0;
    const ins = this.db.prepare(
      'INSERT INTO nodes(id, task_id, title, description, start_utc, end_utc, status, position) VALUES(?,?,?,?,?,?,?,?)'
    );
    for (const n of p.nodes) {
      ins.run(randomUUID(), taskId, n.title.trim(), n.description.trim(), n.startUtc, n.endUtc, 'pending', pos);
      pos++;
    }
    return taskId;
  }

  private applyNodesPayload(p: Extract<DraftPayload, { type: 'nodes' }>): void {
    const maxRow = this.db.prepare('SELECT MAX(position) AS m FROM nodes WHERE task_id = ?').get(p.taskId) as { m: number | null };
    let pos = (maxRow.m ?? -1) + 1;
    const ins = this.db.prepare(
      'INSERT INTO nodes(id, task_id, title, description, start_utc, end_utc, status, position) VALUES(?,?,?,?,?,?,?,?)'
    );
    for (const n of p.nodes) {
      ins.run(randomUUID(), p.taskId, n.title.trim(), n.description.trim(), n.startUtc, n.endUtc, 'pending', pos);
      pos++;
    }
    this.db
      .prepare('INSERT INTO change_events(task_id, at_utc, kind, detail) VALUES(?,?,?,?)')
      .run(p.taskId, new Date().toISOString(), 'draft_nodes_confirmed', JSON.stringify({ count: p.nodes.length }));
  }
}
