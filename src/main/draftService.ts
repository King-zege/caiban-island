import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { validateNodeInput, validateNodeStartSchedule, validateTaskCreateRequest } from '../shared/validation';
import type { DraftPayload, DraftRecord, DraftSource, DraftState, TaskDraftPayload } from '../shared/draftContracts';
import type { AgentActionDraftPayload, AgentTaskAction } from '../shared/agentContracts';
import { NODE_STATUSES } from '../shared/taskContracts';
import type { NodeStatus } from '../shared/taskContracts';
import type { ReminderService } from './reminderService';

export class DraftError extends Error {}

export interface DraftCreateOptions {
  sessionId?: string;
  replacesDraftId?: string;
}

function parsePayload(raw: string): DraftPayload {
  try {
    const value: unknown = JSON.parse(raw);
    normalizeLegacyTaskDraft(value);
    assertPayloadShape(value);
    return value;
  } catch {
    throw new DraftError('草稿数据损坏');
  }
}

function normalizeLegacyTaskDraft(value: unknown): void {
  if (!isRecord(value) || value.type !== 'task' || !isRecord(value.taskInput) || value.taskInput.kind !== 'misc') return;
  if (typeof value.taskInput.note !== 'string') value.taskInput.note = typeof value.taskInput.description === 'string' ? value.taskInput.description : '';
  if (value.taskInput.remindAtUtc === undefined) value.taskInput.remindAtUtc = null;
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
  if (!isRecord(value) || !Array.isArray(value.warnings)) {
    throw new DraftError('草稿数据损坏');
  }
  if (!value.warnings.every((warning) => typeof warning === 'string')) throw new DraftError('草稿数据损坏');
  if (value.type === 'task') {
    if (!Array.isArray(value.nodes)) throw new DraftError('草稿数据损坏');
    value.nodes.forEach(assertNodeShape);
    if (!isRecord(value.taskInput)) throw new DraftError('草稿数据损坏');
    const input = value.taskInput;
    const commonInvalid = typeof input.name !== 'string' || typeof input.kind !== 'string' || typeof input.tzId !== 'string';
    const projectInvalid = (input.kind === 'task' || input.kind === 'procurement') && (
      typeof input.description !== 'string' || typeof input.urgency !== 'string' || !isNullableString(input.deadlineUtc)
    );
    const miscInvalid = input.kind === 'misc' && (typeof input.note !== 'string' || !isNullableString(input.remindAtUtc));
    if (commonInvalid || projectInvalid || miscInvalid || (input.kind !== 'task' && input.kind !== 'procurement' && input.kind !== 'misc')) {
      throw new DraftError('草稿数据损坏');
    }
    return;
  }
  if (value.type === 'nodes' && typeof value.taskId === 'string' && Array.isArray(value.nodes)) {
    value.nodes.forEach(assertNodeShape);
    return;
  }
  if (
    value.type === 'action' &&
    typeof value.taskId === 'string' &&
    typeof value.sessionId === 'string' &&
    typeof value.summary === 'string' &&
    isRecord(value.action) &&
    typeof value.action.kind === 'string'
  ) return;
  throw new DraftError('草稿数据损坏');
}

// FR-043~048：AI 输出永远是草稿；确认走单事务；校验失败可修复一次
export class DraftService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly reminders: ReminderService
  ) {}

  create(source: DraftSource, payload: DraftPayload, options: DraftCreateOptions = {}): DraftRecord {
    if (payload.type === 'action' && source !== 'pi') throw new DraftError('轻量操作提案只能由 Pi Agent 创建');
    this.validatePayload(payload);
    const sessionId = options.sessionId ?? null;
    if (sessionId) {
      const session = this.db.prepare('SELECT id FROM agent_sessions WHERE id = ?').get(sessionId) as { id: string } | undefined;
      if (!session) throw new DraftError('Agent 会话不存在');
    }
    if (options.replacesDraftId) this.assertReplacement(options.replacesDraftId, sessionId, payload);
    const record: DraftRecord = {
      id: randomUUID(),
      source,
      sessionId,
      payload,
      state: 'pending',
      createdAt: new Date().toISOString()
    };
    const ownsTransaction = !this.db.isTransaction;
    if (ownsTransaction) this.db.exec('BEGIN');
    try {
      this.db
        .prepare('INSERT INTO drafts(id, source, session_id, payload, state, created_at) VALUES(?,?,?,?,?,?)')
        .run(record.id, record.source, record.sessionId, JSON.stringify(record.payload), record.state, record.createdAt);
      if (options.replacesDraftId) {
        const changed = this.db.prepare("UPDATE drafts SET state = 'superseded' WHERE id = ? AND state = 'pending'").run(options.replacesDraftId);
        if (changed.changes !== 1) throw new DraftError('原草稿已变化，请重新规划');
      }
      if (ownsTransaction) this.db.exec('COMMIT');
    } catch (error) {
      if (ownsTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
    return record;
  }

  private assertReplacement(replacesDraftId: string, sessionId: string | null, payload: DraftPayload): void {
    if (!sessionId) throw new DraftError('替代草稿必须关联 Agent 会话');
    if (payload.type !== 'task') throw new DraftError('只有任务规划草稿支持替代修订');
    const row = this.db.prepare('SELECT source, session_id AS sessionId, payload, state FROM drafts WHERE id = ?').get(replacesDraftId) as
      | { source: string; sessionId: string | null; payload: string; state: string }
      | undefined;
    if (!row || row.state !== 'pending') throw new DraftError('原草稿不存在或已处理');
    if (row.source !== 'pi' || row.sessionId !== sessionId) throw new DraftError('不能替代其他会话的草稿');
    if (parsePayload(row.payload).type !== 'task') throw new DraftError('只能替代任务规划草稿');
  }

  private validatePayload(payload: unknown): asserts payload is DraftPayload {
    assertPayloadShape(payload);
    if (payload.type === 'task') {
      const v = validateTaskCreateRequest(payload.taskInput);
      if (!v.ok) throw new DraftError('任务字段校验失败：' + v.errors.join('；'));
      if (payload.taskInput.kind === 'misc' && payload.nodes.length > 0) throw new DraftError('杂事草稿不能包含节点');
    } else if (payload.type === 'nodes') {
      const task = this.db.prepare("SELECT kind, status FROM tasks WHERE id = ?").get(payload.taskId) as
        | { kind: string; status: string }
        | undefined;
      if (!task) throw new DraftError('任务不存在');
      if (task.status !== 'active') throw new DraftError('任务已归档');
      if (task.kind === 'misc') throw new DraftError('杂事不支持节点');
    } else {
      this.validateActionPayload(payload);
      return;
    }
    for (const n of payload.nodes) {
      const v = validateNodeInput(n);
      if (!v.ok) throw new DraftError('节点校验失败：' + v.errors.join('；'));
      const schedule = validateNodeStartSchedule(n.startUtc, 'pending', null);
      if (!schedule.ok) throw new DraftError('节点校验失败：' + schedule.errors.join('；'));
    }
  }

  listPending(sessionId?: string): DraftRecord[] {
    const rows = (sessionId
      ? this.db.prepare("SELECT id, source, session_id AS sessionId, payload, state, created_at AS createdAt FROM drafts WHERE state = 'pending' AND session_id = ? ORDER BY created_at DESC, id DESC").all(sessionId)
      : this.db.prepare("SELECT id, source, session_id AS sessionId, payload, state, created_at AS createdAt FROM drafts WHERE state = 'pending' ORDER BY created_at DESC, id DESC").all()) as unknown as Array<{ id: string; source: string; sessionId: string | null; payload: string; state: string; createdAt: string }>;
    return rows.map((r) => ({
      id: r.id,
      source: r.source as DraftSource,
      sessionId: r.sessionId,
      payload: parsePayload(r.payload),
      state: r.state as DraftState,
      createdAt: r.createdAt
    }));
  }

  get(id: string): DraftRecord {
    const row = this.db.prepare('SELECT id, source, session_id AS sessionId, payload, state, created_at AS createdAt FROM drafts WHERE id = ?').get(id) as
      | { id: string; source: string; sessionId: string | null; payload: string; state: string; createdAt: string }
      | undefined;
    if (!row) throw new DraftError('草稿不存在');
    return {
      id: row.id,
      source: row.source as DraftSource,
      sessionId: row.sessionId,
      payload: parsePayload(row.payload),
      state: row.state as DraftState,
      createdAt: row.createdAt
    };
  }

  updatePayload(id: string, payload: DraftPayload): DraftRecord {
    const row = this.db.prepare("SELECT id FROM drafts WHERE id = ? AND state = 'pending'").get(id) as { id: string } | undefined;
    if (!row) throw new DraftError('草稿不存在或已处理');
    if (this.get(id).payload.type === 'action' || payload.type === 'action') throw new DraftError('轻量操作提案不可编辑，请丢弃后重新规划');
    this.validatePayload(payload);
    this.db.prepare('UPDATE drafts SET payload = ? WHERE id = ?').run(JSON.stringify(payload), id);
    return this.get(id);
  }

  discard(id: string): void {
    const r = this.db.prepare("UPDATE drafts SET state = 'discarded' WHERE id = ? AND state = 'pending'").run(id);
    if (r.changes === 0) throw new DraftError('草稿不存在或已处理');
  }

  // FR-045：确认通过单事务写入正式数据
  confirm(id: string): { type: 'task' | 'nodes' | 'action'; taskId: string } {
    const draft = this.get(id);
    if (draft.state !== 'pending') throw new DraftError('草稿已处理');
    this.validatePayload(draft.payload);
    this.db.exec('BEGIN');
    try {
      let taskId: string;
      if (draft.payload.type === 'task') {
        taskId = this.applyTaskPayload(draft.payload);
      } else if (draft.payload.type === 'nodes') {
        this.applyNodesPayload(draft.payload);
        taskId = draft.payload.taskId;
      } else {
        this.applyActionPayload(draft.payload);
        taskId = draft.payload.taskId;
      }
      this.reminders.syncTaskNodeReminders(taskId);
      this.reminders.syncMiscReminder(taskId);
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
    const isProcurement = input.kind === 'task' || input.kind === 'procurement';
    const fullName = isProcurement ? (input.fullName ?? input.name).trim() : input.name.trim();
    const shortName = isProcurement ? (input.shortName ?? input.name).trim() : input.name.trim();
    this.db
      .prepare(
        'INSERT INTO tasks(id, name, full_name, short_name, short_name_needs_review, description, kind, urgency, deadline_utc, remind_at_utc, tz_id, status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
      )
      .run(
        taskId,
        shortName,
        fullName,
        shortName,
        0,
        isProcurement ? input.description.trim() : '',
        isProcurement ? 'procurement' : 'misc',
        isProcurement ? input.urgency : 'normal',
        isProcurement ? input.deadlineUtc : null,
        input.kind === 'misc' ? input.remindAtUtc : null,
        input.tzId,
        'active',
        now,
        now
      );
    if (input.kind === 'misc' && input.note.trim()) {
      this.db.prepare('INSERT INTO notes(id, task_id, body, updated_at) VALUES(?,?,?,?)').run(taskId, taskId, input.note.trim(), now);
    }
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

  private validateActionPayload(payload: AgentActionDraftPayload): void {
    const task = this.db.prepare('SELECT kind, status FROM tasks WHERE id = ?').get(payload.taskId) as
      | { kind: string; status: string }
      | undefined;
    if (!task) throw new DraftError('任务不存在');
    if (task.status !== 'active') throw new DraftError('任务已归档');
    const action = payload.action;
    if (action.kind === 'set_node_status') {
      if (!action.nodeId || !NODE_STATUSES.includes(action.before) || !NODE_STATUSES.includes(action.after)) throw new DraftError('节点状态提案无效');
      return;
    }
    if (action.kind === 'set_reminders') {
      if (!this.validOffsets(action.before) || !this.validOffsets(action.after)) throw new DraftError('提醒提案无效');
      return;
    }
    if (task.kind === 'misc') throw new DraftError('杂事不支持节点操作');
    if (action.kind === 'add_node') {
      if (!Array.isArray(action.beforeNodeIds) || !action.beforeNodeIds.every((id) => typeof id === 'string')) throw new DraftError('节点新增提案无效');
      const result = validateNodeInput(action.input);
      if (!result.ok) throw new DraftError('节点校验失败：' + result.errors.join('；'));
      const schedule = validateNodeStartSchedule(action.input.startUtc, 'pending', null);
      if (!schedule.ok) throw new DraftError('节点校验失败：' + schedule.errors.join('；'));
      return;
    }
    if (action.kind === 'update_node') {
      if (!action.nodeId) throw new DraftError('节点修改提案无效');
      const before = validateNodeInput(action.before);
      const after = validateNodeInput(action.after);
      if (!before.ok || !after.ok) throw new DraftError('节点修改提案无效');
      const node = this.db.prepare('SELECT status FROM nodes WHERE id = ?').get(action.nodeId) as { status: NodeStatus } | undefined;
      if (!node) throw new DraftError('节点不存在');
      const schedule = validateNodeStartSchedule(action.after.startUtc, node.status, action.before.startUtc);
      if (!schedule.ok) throw new DraftError('节点校验失败：' + schedule.errors.join('；'));
      return;
    }
    if (action.kind === 'delete_node') {
      if (!action.before?.id || action.before.taskId !== payload.taskId) throw new DraftError('节点删除提案无效');
      return;
    }
    if (action.kind === 'reorder_nodes') {
      if (!this.validIdList(action.before) || !this.validIdList(action.after)) throw new DraftError('节点排序提案无效');
      return;
    }
    const exhaustive: never = action;
    throw new DraftError('不支持的轻量操作：' + String(exhaustive));
  }

  private applyActionPayload(payload: AgentActionDraftPayload): void {
    const action = payload.action;
    if (action.kind === 'set_node_status') {
      const row = this.db.prepare('SELECT task_id, status FROM nodes WHERE id = ?').get(action.nodeId) as { task_id: string; status: string } | undefined;
      if (!row || row.task_id !== payload.taskId || row.status !== action.before) this.stale();
      this.db.prepare('UPDATE nodes SET status = ? WHERE id = ?').run(action.after, action.nodeId);
      this.logAction(payload.taskId, action, { nodeId: action.nodeId });
      return;
    }
    if (action.kind === 'set_reminders') {
      const before = this.currentReminderOffsets(payload.taskId);
      if (!this.sameArray(before, action.before)) this.stale();
      const task = this.db.prepare('SELECT deadline_utc FROM tasks WHERE id = ? AND status = ?').get(payload.taskId, 'active') as { deadline_utc: string | null } | undefined;
      if (!task || (action.after.length > 0 && !task.deadline_utc)) throw new DraftError('任务没有截止时间，不能添加提醒');
      this.db.prepare('DELETE FROM reminders WHERE task_id = ?').run(payload.taskId);
      if (task.deadline_utc) {
        const deadline = Date.parse(task.deadline_utc);
        const insert = this.db.prepare('INSERT INTO reminders(id, task_id, offset_minutes, fire_at_utc, fired) VALUES(?,?,?,?,0)');
        for (const offset of action.after) insert.run(randomUUID(), payload.taskId, offset, new Date(deadline - offset * 60000).toISOString());
      }
      this.logAction(payload.taskId, action, { count: action.after.length });
      return;
    }
    if (action.kind === 'add_node') {
      const before = this.currentNodeIds(payload.taskId);
      if (!this.sameArray(before, action.beforeNodeIds)) this.stale();
      const input = action.input;
      this.db.prepare('INSERT INTO nodes(id, task_id, title, description, start_utc, end_utc, status, position) VALUES(?,?,?,?,?,?,?,?)')
        .run(randomUUID(), payload.taskId, input.title.trim(), input.description.trim(), input.startUtc, input.endUtc, 'pending', before.length);
      this.logAction(payload.taskId, action, { title: input.title.trim() });
      return;
    }
    if (action.kind === 'update_node') {
      const row = this.db.prepare('SELECT task_id, title, description, start_utc, end_utc FROM nodes WHERE id = ?').get(action.nodeId) as
        | { task_id: string; title: string; description: string; start_utc: string | null; end_utc: string | null }
        | undefined;
      const current = row ? { title: row.title, description: row.description, startUtc: row.start_utc, endUtc: row.end_utc } : null;
      if (!row || row.task_id !== payload.taskId || JSON.stringify(current) !== JSON.stringify(action.before)) this.stale();
      this.db.prepare('UPDATE nodes SET title=?, description=?, start_utc=?, end_utc=? WHERE id=?')
        .run(action.after.title.trim(), action.after.description.trim(), action.after.startUtc, action.after.endUtc, action.nodeId);
      this.logAction(payload.taskId, action, { nodeId: action.nodeId });
      return;
    }
    if (action.kind === 'delete_node') {
      const row = this.readNode(action.before.id);
      if (!row || JSON.stringify(row) !== JSON.stringify(action.before)) this.stale();
      this.db.prepare('DELETE FROM nodes WHERE id = ?').run(action.before.id);
      this.db.prepare('UPDATE nodes SET position = position - 1 WHERE task_id = ? AND position > ?').run(payload.taskId, action.before.position);
      this.logAction(payload.taskId, action, { nodeId: action.before.id });
      return;
    }
    if (action.kind === 'reorder_nodes') {
      const before = this.currentNodeIds(payload.taskId);
      if (!this.sameArray(before, action.before) || action.after.length !== before.length || new Set(action.after).size !== before.length || action.after.some((id) => !before.includes(id))) this.stale();
      action.after.forEach((id, position) => this.db.prepare('UPDATE nodes SET position = ? WHERE id = ?').run(position, id));
      this.logAction(payload.taskId, action, { count: action.after.length });
    }
  }

  private readNode(nodeId: string): Extract<AgentTaskAction, { kind: 'delete_node' }>['before'] | null {
    const row = this.db.prepare('SELECT id, task_id, title, description, start_utc, end_utc, status, position FROM nodes WHERE id = ?').get(nodeId) as
      | { id: string; task_id: string; title: string; description: string; start_utc: string | null; end_utc: string | null; status: string; position: number }
      | undefined;
    if (!row) return null;
    return { id: row.id, taskId: row.task_id, title: row.title, description: row.description, startUtc: row.start_utc, endUtc: row.end_utc, status: row.status as Extract<AgentTaskAction, { kind: 'delete_node' }>['before']['status'], position: row.position };
  }

  private currentNodeIds(taskId: string): string[] {
    const rows = this.db.prepare('SELECT id FROM nodes WHERE task_id = ? ORDER BY position, id').all(taskId) as unknown as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  private currentReminderOffsets(taskId: string): number[] {
    const rows = this.db.prepare('SELECT offset_minutes AS offset FROM reminders WHERE task_id = ? ORDER BY offset_minutes').all(taskId) as unknown as Array<{ offset: number }>;
    return rows.map((row) => row.offset);
  }

  private validOffsets(value: unknown): value is number[] {
    return Array.isArray(value) && value.every((offset) => Number.isInteger(offset) && offset > 0) && new Set(value).size === value.length;
  }

  private validIdList(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((id) => typeof id === 'string') && new Set(value).size === value.length;
  }

  private sameArray(left: readonly unknown[], right: readonly unknown[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  private stale(): never {
    throw new DraftError('任务数据已变化，请让 Agent 重新规划');
  }

  private logAction(taskId: string, action: AgentTaskAction, detail: Record<string, unknown>): void {
    this.db.prepare('INSERT INTO change_events(task_id, at_utc, kind, detail) VALUES(?,?,?,?)')
      .run(taskId, new Date().toISOString(), 'agent_action_' + action.kind, JSON.stringify(detail));
  }
}
