import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { deriveShortName, procurementNames, validateFormalName, validateMiscReminderUpdate, validateNodeInput, validateNodeStartSchedule, validateNodeTitle, validateShortName, validateTaskCreateRequest, validateTaskInput, validateTaskName } from '../shared/validation';
import { compareTasks, computeProgress, isOverdue } from '../shared/sorting';
import { URGENCIES } from '../shared/taskContracts';
import type {
  LinkInput,
  LinkKind,
  LegacyMiscDeadlineActionRequest,
  MiscReminderSummary,
  MiscReminderUpdateRequest,
  NodeInput,
  NodeStatus,
  NodeTimeUpdateRequest,
  NodeTitleUpdateRequest,
  Task,
  TaskCard,
  TaskCardNode,
  TaskCreateRequest,
  TaskDetail,
  TaskInput,
  TaskNameUpdateRequest,
  TaskNamesUpdateRequest,
  TaskUrgencyUpdateRequest,
  TaskLink,
  TaskNode
} from '../shared/taskContracts';
import type { ProcurementMethod, ProcurementPlanApplyRequest } from '../shared/procurementContracts';

function toTask(row: Record<string, unknown>): Task {
  const kind = String(row.kind) === 'task' ? 'procurement' : String(row.kind) as Task['kind'];
  const fullName = row.full_name === null || row.full_name === undefined ? String(row.name) : String(row.full_name);
  const shortName = row.short_name === null || row.short_name === undefined ? String(row.name) : String(row.short_name);
  return {
    id: String(row.id),
    name: kind === 'procurement' ? shortName : String(row.name),
    fullName,
    shortName,
    shortNameNeedsReview: Number(row.short_name_needs_review ?? 0) === 1,
    description: String(row.description),
    kind,
    urgency: String(row.urgency) as Task['urgency'],
    deadlineUtc: row.deadline_utc === null ? null : String(row.deadline_utc),
    remindAtUtc: row.remind_at_utc === null || row.remind_at_utc === undefined ? null : String(row.remind_at_utc),
    tzId: String(row.tz_id),
    status: String(row.status) as Task['status'],
    createdAtUtc: String(row.created_at),
    updatedAtUtc: String(row.updated_at),
    archivedAt: row.archived_at === null ? null : String(row.archived_at),
    archiveOutcome: row.archive_outcome === null ? null : (String(row.archive_outcome) as Task['archiveOutcome']),
    workflowTemplateId: row.workflow_template_id === null || row.workflow_template_id === undefined ? null : String(row.workflow_template_id),
    workflowTemplateVersion: row.workflow_template_version === null || row.workflow_template_version === undefined ? null : Number(row.workflow_template_version),
    procurementMethod: row.procurement_method === null || row.procurement_method === undefined ? null : String(row.procurement_method) as ProcurementMethod
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
    position: Number(row.position),
    stageKey: row.stage_key === null || row.stage_key === undefined ? null : String(row.stage_key),
    source: row.source === null || row.source === undefined ? 'custom' : String(row.source) as TaskNode['source']
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
    const miscRows = this.db.prepare('SELECT task_id, fire_at_utc, fired FROM misc_reminders').all() as unknown as Array<{
      task_id: string;
      fire_at_utc: string;
      fired: number;
    }>;
    const miscByTask = new Map(miscRows.map((row) => [row.task_id, row]));
    return tasks.map((task) => {
      const nodes = byTask.get(task.id) ?? [];
      return {
        task,
        progress: computeProgress(nodes),
        nodes,
        overdue: task.kind === 'procurement' && isOverdue(task, nowMs),
        miscReminder: this.miscReminderSummary(task, miscByTask.get(task.id))
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
    const miscRow = this.db.prepare('SELECT task_id, fire_at_utc, fired FROM misc_reminders WHERE task_id = ?').get(id) as
      | { task_id: string; fire_at_utc: string; fired: number }
      | undefined;
    return { task, nodes, links, note: noteRow ? noteRow.body : '', miscReminder: this.miscReminderSummary(task, miscRow) };
  }

  createTask(input: TaskCreateRequest | TaskInput): Task {
    const normalized: TaskCreateRequest = input.kind === 'misc'
      ? {
          kind: 'misc',
          name: input.name,
          note: 'note' in input ? input.note : input.description,
          remindAtUtc: 'remindAtUtc' in input ? input.remindAtUtc : null,
          tzId: input.tzId
        }
      : {
          kind: input.kind,
          name: input.name,
          fullName: input.fullName,
          shortName: input.shortName,
          description: input.description,
          urgency: input.urgency,
          deadlineUtc: input.deadlineUtc,
          tzId: input.tzId
        };
    const v = validateTaskCreateRequest(normalized);
    if (!v.ok) throw new TaskError(v.errors.join('；'));
    const now = new Date().toISOString();
    const isMisc = normalized.kind === 'misc';
    const names = isMisc
      ? { fullName: normalized.name.trim(), shortName: normalized.name.trim() }
      : procurementNames(normalized);
    const generatedShortName = !isMisc && normalized.shortName === undefined
      ? deriveShortName(names.fullName)
      : { shortName: names.shortName, needsReview: false };
    const task: Task = {
      id: randomUUID(),
      name: isMisc ? normalized.name.trim() : generatedShortName.shortName,
      fullName: names.fullName,
      shortName: isMisc ? names.shortName : generatedShortName.shortName,
      shortNameNeedsReview: !isMisc && generatedShortName.needsReview,
      description: isMisc ? '' : normalized.description.trim(),
      kind: isMisc ? 'misc' : 'procurement',
      urgency: isMisc ? 'normal' : normalized.urgency,
      deadlineUtc: isMisc ? null : normalized.deadlineUtc,
      remindAtUtc: isMisc ? normalized.remindAtUtc : null,
      tzId: normalized.tzId,
      status: 'active',
      createdAtUtc: now,
      updatedAtUtc: now,
      archivedAt: null,
      archiveOutcome: null,
      workflowTemplateId: null,
      workflowTemplateVersion: null
    };
    const ownsTransaction = !this.db.isTransaction;
    if (ownsTransaction) this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          'INSERT INTO tasks(id, name, full_name, short_name, short_name_needs_review, description, kind, urgency, deadline_utc, remind_at_utc, tz_id, status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        )
        .run(task.id, task.name, task.fullName, task.shortName, task.shortNameNeedsReview ? 1 : 0, task.description, task.kind, task.urgency, task.deadlineUtc, task.remindAtUtc, task.tzId, task.status, task.createdAtUtc, task.updatedAtUtc);
      this.logEvent(task.id, 'task_created', JSON.stringify({ fullName: task.fullName, shortName: task.shortName }));
      if (ownsTransaction) this.db.exec('COMMIT');
    } catch (e) {
      if (ownsTransaction) this.db.exec('ROLLBACK');
      throw e;
    }
    return task;
  }

  updateTask(id: string, input: TaskInput): Task {
    const existing = this.getTask(id);
    if (!existing) throw new TaskError('任务不存在');
    if (existing.kind === 'misc' || input.kind === 'misc') throw new TaskError('任务类型创建后不可修改');
    const v = validateTaskInput(input);
    if (!v.ok) throw new TaskError(v.errors.join('；'));
    const names = procurementNames(input);
    const description = input.description.trim();
    const updated = new Date().toISOString();
    this.db
      .prepare('UPDATE tasks SET name=?, full_name=?, short_name=?, short_name_needs_review=0, description=?, urgency=?, deadline_utc=?, tz_id=?, updated_at=? WHERE id=?')
      .run(names.shortName, names.fullName, names.shortName, description, input.urgency, input.deadlineUtc, input.tzId, updated, id);
    this.logEvent(id, 'task_updated', JSON.stringify(names));
    return this.getTask(id) as Task;
  }

  setName(request: TaskNameUpdateRequest): Task {
    const existing = this.getTask(request.taskId);
    if (!existing) throw new TaskError('任务不存在');
    const validation = existing.kind === 'procurement' ? validateShortName(request.name) : validateTaskName(request.name);
    if (!validation.ok) throw new TaskError(validation.errors.join('；'));
    if (existing.status !== 'active') throw new TaskError('只能编辑活跃任务的名称');
    if (existing.name !== request.expectedName) throw new TaskError('任务名称已变化，请刷新后重试');
    const name = request.name.trim();
    if (existing.name === name) return existing;
    const updatedAt = new Date().toISOString();
    const result = this.db
      .prepare("UPDATE tasks SET name = ?, short_name = CASE WHEN kind = 'procurement' THEN ? ELSE short_name END, short_name_needs_review = CASE WHEN kind = 'procurement' THEN 0 ELSE short_name_needs_review END, updated_at = ? WHERE id = ? AND status = 'active' AND name = ?")
      .run(name, name, updatedAt, request.taskId, request.expectedName);
    if (result.changes !== 1) throw new TaskError('任务名称已变化，请刷新后重试');
    this.logEvent(request.taskId, 'task_name_updated', JSON.stringify({ from: request.expectedName, to: name }));
    return this.getTask(request.taskId) as Task;
  }

  setNames(request: TaskNamesUpdateRequest): Task {
    const full = validateFormalName(request.fullName);
    const short = validateShortName(request.shortName);
    if (!full.ok || !short.ok) throw new TaskError([...(!full.ok ? full.errors : []), ...(!short.ok ? short.errors : [])].join('；'));
    const existing = this.getTask(request.taskId);
    if (!existing || existing.kind !== 'procurement' || existing.status !== 'active') throw new TaskError('采购项目不存在或不可编辑');
    if (existing.fullName !== request.expectedFullName || existing.shortName !== request.expectedShortName) throw new TaskError('项目名称已变化，请刷新后重试');
    const fullName = request.fullName.trim();
    const shortName = request.shortName.trim();
    const updatedAt = new Date().toISOString();
    const result = this.db.prepare(
      "UPDATE tasks SET name=?, full_name=?, short_name=?, short_name_needs_review=0, updated_at=? WHERE id=? AND kind='procurement' AND status='active' AND full_name=? AND short_name=?"
    ).run(shortName, fullName, shortName, updatedAt, request.taskId, request.expectedFullName, request.expectedShortName);
    if (result.changes !== 1) throw new TaskError('项目名称已变化，请刷新后重试');
    this.logEvent(request.taskId, 'task_names_updated', JSON.stringify({ from: { fullName: request.expectedFullName, shortName: request.expectedShortName }, to: { fullName, shortName } }));
    return this.getTask(request.taskId) as Task;
  }

  setProcurementWorkflow(taskId: string, templateId: string | null, templateVersion: number | null, procurementMethod: ProcurementMethod): Task {
    const existing = this.getTask(taskId);
    if (!existing || existing.kind !== 'procurement' || existing.status !== 'active') throw new TaskError('采购项目不存在或不可编辑');
    const updatedAt = new Date().toISOString();
    this.db.prepare(
      "UPDATE tasks SET workflow_template_id=?, workflow_template_version=?, procurement_method=?, updated_at=? WHERE id=? AND kind='procurement' AND status='active'"
    ).run(templateId, templateVersion, procurementMethod, updatedAt, taskId);
    this.logEvent(taskId, 'procurement_workflow_selected', JSON.stringify({ templateId, templateVersion, procurementMethod }));
    return this.getTask(taskId) as Task;
  }

  applyProcurementPlan(request: ProcurementPlanApplyRequest): TaskDetail {
    const existing = this.getTask(request.taskId);
    if (!existing || existing.kind !== 'procurement' || existing.status !== 'active') throw new TaskError('采购项目不存在或不可编辑');
    if (existing.updatedAtUtc !== request.expectedUpdatedAtUtc) throw new TaskError('采购项目已变化，请刷新后重新应用计划');
    for (const node of request.nodes) {
      const validation = validateNodeInput(node);
      if (!validation.ok) throw new TaskError(validation.errors.join('；'));
    }
    this.db.prepare('DELETE FROM nodes WHERE task_id=?').run(request.taskId);
    const insert = this.db.prepare(
      'INSERT INTO nodes(id, task_id, title, description, start_utc, end_utc, status, position, stage_key, source) VALUES(?,?,?,?,?,?,?,?,?,?)'
    );
    request.nodes.forEach((node, position) => insert.run(
      randomUUID(), request.taskId, node.title.trim(), node.description.trim(), node.startUtc, node.endUtc,
      'pending', position, node.stageKey ?? null, node.source ?? 'custom'
    ));
    const updatedAt = new Date().toISOString();
    this.db.prepare(
      "UPDATE tasks SET workflow_template_id=?, workflow_template_version=?, procurement_method=?, updated_at=? WHERE id=? AND kind='procurement' AND status='active' AND updated_at=?"
    ).run(request.templateId, request.templateVersion, request.procurementMethod, updatedAt, request.taskId, request.expectedUpdatedAtUtc);
    this.logEvent(request.taskId, 'procurement_plan_applied', JSON.stringify({ count: request.nodes.length, templateId: request.templateId }));
    return this.getTaskDetail(request.taskId);
  }

  setUrgency(request: TaskUrgencyUpdateRequest): Task {
    if (!URGENCIES.includes(request.urgency)) throw new TaskError('无效的紧急程度');
    if (!URGENCIES.includes(request.expectedUrgency)) throw new TaskError('无效的预期紧急程度');
    const existing = this.getTask(request.taskId);
    if (!existing) throw new TaskError('任务不存在');
    if (existing.status !== 'active') throw new TaskError('只能调整活跃任务的紧急程度');
    if (existing.kind === 'misc') throw new TaskError('杂事不设置紧急程度');
    if (existing.urgency !== request.expectedUrgency) throw new TaskError('任务紧急程度已变化，请刷新后重试');
    if (existing.urgency === request.urgency) return existing;
    const updatedAt = new Date().toISOString();
    const result = this.db
      .prepare("UPDATE tasks SET urgency = ?, updated_at = ? WHERE id = ? AND status = 'active' AND urgency = ?")
      .run(request.urgency, updatedAt, request.taskId, request.expectedUrgency);
    if (result.changes !== 1) throw new TaskError('任务紧急程度已变化，请刷新后重试');
    this.logEvent(request.taskId, 'task_urgency_updated', JSON.stringify({
      from: request.expectedUrgency,
      to: request.urgency
    }));
    return this.getTask(request.taskId) as Task;
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

  setMiscReminder(request: MiscReminderUpdateRequest): Task {
    const validation = validateMiscReminderUpdate(request);
    if (!validation.ok) throw new TaskError(validation.errors.join('；'));
    const existing = this.getTask(request.taskId);
    if (!existing) throw new TaskError('杂事不存在');
    if (existing.kind !== 'misc') throw new TaskError('只有杂事可以设置精确提醒');
    if (existing.status !== 'active') throw new TaskError('只能调整活跃杂事的提醒');
    if (existing.remindAtUtc !== request.expectedRemindAtUtc) throw new TaskError('提醒时间已变化，请刷新后重试');
    if (existing.remindAtUtc === request.remindAtUtc) return existing;
    const updatedAt = new Date().toISOString();
    const result = this.db.prepare(
      "UPDATE tasks SET remind_at_utc = ?, updated_at = ? WHERE id = ? AND kind = 'misc' AND status = 'active' AND remind_at_utc IS ?"
    ).run(request.remindAtUtc, updatedAt, request.taskId, request.expectedRemindAtUtc);
    if (result.changes !== 1) throw new TaskError('提醒时间已变化，请刷新后重试');
    this.logEvent(request.taskId, 'misc_reminder_updated', JSON.stringify({
      from: request.expectedRemindAtUtc,
      to: request.remindAtUtc
    }));
    return this.getTask(request.taskId) as Task;
  }

  resolveLegacyMiscDeadline(request: LegacyMiscDeadlineActionRequest): Task {
    if (request.action !== 'convert' && request.action !== 'clear') throw new TaskError('无效的旧时间处理方式');
    if (!Number.isFinite(Date.parse(request.expectedDeadlineUtc))) throw new TaskError('旧截止时间格式无效');
    const existing = this.getTask(request.taskId);
    if (!existing) throw new TaskError('杂事不存在');
    if (existing.kind !== 'misc' || existing.status !== 'active') throw new TaskError('只能处理活跃杂事的旧截止时间');
    if (existing.deadlineUtc !== request.expectedDeadlineUtc) throw new TaskError('旧截止时间已变化，请刷新后重试');
    if (request.action === 'convert' && Date.parse(request.expectedDeadlineUtc) < Math.floor(Date.now() / 60000) * 60000) {
      throw new TaskError('过去的截止时间不能转换为提醒，请清除旧时间');
    }
    const remindAtUtc = request.action === 'convert' ? request.expectedDeadlineUtc : existing.remindAtUtc;
    const updatedAt = new Date().toISOString();
    const result = this.db.prepare(
      "UPDATE tasks SET deadline_utc = NULL, remind_at_utc = ?, updated_at = ? WHERE id = ? AND kind = 'misc' AND status = 'active' AND deadline_utc = ?"
    ).run(remindAtUtc, updatedAt, request.taskId, request.expectedDeadlineUtc);
    if (result.changes !== 1) throw new TaskError('旧截止时间已变化，请刷新后重试');
    this.db.prepare('DELETE FROM reminders WHERE task_id = ?').run(request.taskId);
    this.logEvent(request.taskId, 'misc_legacy_deadline_resolved', JSON.stringify({ action: request.action }));
    return this.getTask(request.taskId) as Task;
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
      position: (maxRow.m ?? -1) + 1,
      stageKey: input.stageKey ?? null,
      source: input.source ?? 'custom'
    };
    this.db
      .prepare('INSERT INTO nodes(id, task_id, title, description, start_utc, end_utc, status, position, stage_key, source) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(node.id, node.taskId, node.title, node.description, node.startUtc, node.endUtc, node.status, node.position, node.stageKey ?? null, node.source ?? 'custom');
    this.touchTask(taskId);
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
      .prepare('UPDATE nodes SET title=?, description=?, start_utc=?, end_utc=?, stage_key=?, source=? WHERE id=?')
      .run(
        input.title.trim(), input.description.trim(), input.startUtc, input.endUtc,
        input.stageKey ?? (row.stage_key === null || row.stage_key === undefined ? null : String(row.stage_key)),
        input.source ?? (row.source === null || row.source === undefined ? 'custom' : String(row.source)),
        nodeId
      );
    this.touchTask(String(row.task_id));
    this.logEvent(String(row.task_id), 'node_updated', JSON.stringify({ nodeId }));
    return toNode(this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as Record<string, unknown>);
  }

  setNodeTitle(request: NodeTitleUpdateRequest): TaskNode {
    const validation = validateNodeTitle(request.title);
    if (!validation.ok) throw new TaskError(validation.errors.join('；'));
    const row = this.db
      .prepare("SELECT nodes.* FROM nodes JOIN tasks ON tasks.id = nodes.task_id WHERE nodes.id = ? AND tasks.status = 'active'")
      .get(request.nodeId) as Record<string, unknown> | undefined;
    if (!row) throw new TaskError('节点不存在或所属任务已归档');
    const currentTitle = String(row.title);
    if (currentTitle !== request.expectedTitle) throw new TaskError('节点名称已变化，请刷新后重试');
    const title = request.title.trim();
    if (currentTitle === title) return toNode(row);
    const result = this.db.prepare('UPDATE nodes SET title = ? WHERE id = ? AND title = ?').run(title, request.nodeId, request.expectedTitle);
    if (result.changes !== 1) throw new TaskError('节点名称已变化，请刷新后重试');
    this.db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), String(row.task_id));
    this.logEvent(String(row.task_id), 'node_title_updated', JSON.stringify({
      nodeId: request.nodeId,
      from: request.expectedTitle,
      to: title
    }));
    return toNode(this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(request.nodeId) as Record<string, unknown>);
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

  private touchTask(taskId: string): void {
    const row = this.db.prepare('SELECT updated_at FROM tasks WHERE id=?').get(taskId) as { updated_at: string } | undefined;
    const currentMs = row ? Date.parse(row.updated_at) : 0;
    const nextMs = Math.max(Date.now(), Number.isFinite(currentMs) ? currentMs + 1 : 0);
    this.db.prepare('UPDATE tasks SET updated_at=? WHERE id=?').run(new Date(nextMs).toISOString(), taskId);
  }

  private miscReminderSummary(
    task: Task,
    row?: { fire_at_utc: string; fired: number }
  ): MiscReminderSummary | null {
    if (task.kind !== 'misc') return null;
    if (row) {
      return {
        state: row.fired === 1 ? 'fired' : 'scheduled',
        fireAtUtc: row.fire_at_utc,
        legacyDeadlineUtc: task.deadlineUtc
      };
    }
    if (task.remindAtUtc) {
      return {
        state: Date.parse(task.remindAtUtc) <= Date.now() ? 'fired' : 'scheduled',
        fireAtUtc: task.remindAtUtc,
        legacyDeadlineUtc: task.deadlineUtc
      };
    }
    return {
      state: task.deadlineUtc ? 'legacy_deadline' : 'none',
      fireAtUtc: null,
      legacyDeadlineUtc: task.deadlineUtc
    };
  }
}
