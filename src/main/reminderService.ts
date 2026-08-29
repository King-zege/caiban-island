import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface ReminderRow {
  id: string;
  task_id: string;
  offset_minutes: number;
  fire_at_utc: string;
  fired: number;
}

export interface NodeReminderRow {
  node_id: string;
  fire_at_utc: string;
  fired: number;
}

export interface MiscReminderRow {
  task_id: string;
  fire_at_utc: string;
  fired: number;
}

export type DueReminder =
  | {
      id: string;
      kind: 'task';
      taskId: string;
      taskName: string;
      fireAt: string;
      deadlineUtc: string;
    }
  | {
      id: string;
      kind: 'node';
      taskId: string;
      taskName: string;
      nodeId: string;
      nodeTitle: string;
      fireAt: string;
    }
  | {
      id: string;
      kind: 'misc';
      taskId: string;
      taskName: string;
      fireAt: string;
    };

interface TaskDueRow {
  id: string;
  task_id: string;
  task_name: string;
  fire_at_utc: string;
  deadline_utc: string;
}

interface NodeDueRow {
  node_id: string;
  task_id: string;
  task_name: string;
  node_title: string;
  fire_at_utc: string;
}

interface MiscDueRow {
  task_id: string;
  task_name: string;
  fire_at_utc: string;
}

// FR-060~064 / P16：任务提前量与节点准时提醒；到期领取、漏发摘要和状态同步共用一套服务。
export class ReminderService {
  constructor(private readonly db: DatabaseSync) {}

  listForTask(taskId: string): ReminderRow[] {
    return this.db
      .prepare('SELECT * FROM reminders WHERE task_id = ? ORDER BY offset_minutes')
      .all(taskId) as unknown as ReminderRow[];
  }

  listNodeReminder(nodeId: string): NodeReminderRow | null {
    const row = this.db.prepare('SELECT * FROM node_reminders WHERE node_id = ?').get(nodeId) as NodeReminderRow | undefined;
    return row ?? null;
  }

  listMiscReminder(taskId: string): MiscReminderRow | null {
    const row = this.db.prepare('SELECT * FROM misc_reminders WHERE task_id = ?').get(taskId) as MiscReminderRow | undefined;
    return row ?? null;
  }

  offsetsForTask(taskId: string): number[] {
    return this.listForTask(taskId).map((row) => row.offset_minutes);
  }

  setOffsets(taskId: string, offsets: number[]): void {
    const task = this.db.prepare('SELECT kind, deadline_utc, status FROM tasks WHERE id = ?').get(taskId) as
      | { kind: string; deadline_utc: string | null; status: string }
      | undefined;
    if (!task) throw new Error('任务不存在');
    if (task.kind !== 'procurement') throw new Error('杂事不使用截止时间提前提醒');
    this.withTransaction(() => {
      this.db.prepare('DELETE FROM reminders WHERE task_id = ?').run(taskId);
      if (task.status !== 'active' || !task.deadline_utc || offsets.length === 0) return;
      const deadline = Date.parse(task.deadline_utc);
      const unique = [...new Set(offsets)].sort((left, right) => left - right);
      const insert = this.db.prepare(
        'INSERT INTO reminders(id, task_id, offset_minutes, fire_at_utc, fired) VALUES(?,?,?,?,0)'
      );
      for (const offset of unique) {
        if (!Number.isInteger(offset) || offset <= 0) continue;
        insert.run(randomUUID(), taskId, offset, new Date(deadline - offset * 60000).toISOString());
      }
    });
  }

  recomputeForTask(taskId: string): void {
    const offsets = this.offsetsForTask(taskId);
    if (offsets.length > 0) this.setOffsets(taskId, offsets);
  }

  syncNodeReminder(nodeId: string, now = new Date(), backfillOnlyFuture = false): void {
    const node = this.db.prepare(
      `SELECT n.id, n.start_utc, n.status AS node_status, t.status AS task_status
       FROM nodes n JOIN tasks t ON t.id = n.task_id
       WHERE n.id = ?`
    ).get(nodeId) as
      | { id: string; start_utc: string | null; node_status: string; task_status: string }
      | undefined;
    const existing = this.listNodeReminder(nodeId);
    const eligible = node?.task_status === 'active' && (node.node_status === 'pending' || node.node_status === 'in_progress');
    if (!node || !eligible || !node.start_utc) {
      if (existing) this.db.prepare('DELETE FROM node_reminders WHERE node_id = ?').run(nodeId);
      return;
    }
    if (existing?.fire_at_utc === node.start_utc) return;
    const startMs = Date.parse(node.start_utc);
    const currentMinute = Math.floor(now.getTime() / 60000) * 60000;
    const threshold = backfillOnlyFuture ? now.getTime() : currentMinute;
    if (!Number.isFinite(startMs) || startMs < threshold) {
      if (existing) this.db.prepare('DELETE FROM node_reminders WHERE node_id = ?').run(nodeId);
      return;
    }
    this.db.prepare(
      `INSERT INTO node_reminders(node_id, fire_at_utc, fired) VALUES(?,?,0)
       ON CONFLICT(node_id) DO UPDATE SET fire_at_utc=excluded.fire_at_utc, fired=0`
    ).run(nodeId, node.start_utc);
  }

  syncTaskNodeReminders(taskId: string, now = new Date()): void {
    const rows = this.db.prepare('SELECT id FROM nodes WHERE task_id = ?').all(taskId) as unknown as Array<{ id: string }>;
    for (const row of rows) this.syncNodeReminder(row.id, now);
  }

  reconcileFutureNodeReminders(now = new Date()): void {
    this.withTransaction(() => {
      this.db.prepare(
        `DELETE FROM node_reminders
         WHERE NOT EXISTS (
           SELECT 1 FROM nodes n JOIN tasks t ON t.id = n.task_id
           WHERE n.id = node_reminders.node_id
             AND t.status = 'active'
             AND n.status IN ('pending','in_progress')
             AND n.start_utc IS NOT NULL
         )`
      ).run();
      const rows = this.db.prepare(
        `SELECT n.id FROM nodes n JOIN tasks t ON t.id = n.task_id
         WHERE t.status = 'active' AND n.status IN ('pending','in_progress') AND n.start_utc IS NOT NULL`
      ).all() as unknown as Array<{ id: string }>;
      for (const row of rows) this.syncNodeReminder(row.id, now, true);
    });
  }

  syncMiscReminder(taskId: string, now = new Date(), backfillOnlyFuture = false): void {
    const task = this.db.prepare(
      'SELECT id, kind, remind_at_utc, status FROM tasks WHERE id = ?'
    ).get(taskId) as { id: string; kind: string; remind_at_utc: string | null; status: string } | undefined;
    const existing = this.listMiscReminder(taskId);
    if (!task || task.kind !== 'misc' || task.status !== 'active' || !task.remind_at_utc) {
      if (existing) this.db.prepare('DELETE FROM misc_reminders WHERE task_id = ?').run(taskId);
      return;
    }
    if (existing?.fire_at_utc === task.remind_at_utc) return;
    const fireMs = Date.parse(task.remind_at_utc);
    const currentMinute = Math.floor(now.getTime() / 60000) * 60000;
    const threshold = backfillOnlyFuture ? now.getTime() : currentMinute;
    if (!Number.isFinite(fireMs) || fireMs < threshold) {
      if (existing) this.db.prepare('DELETE FROM misc_reminders WHERE task_id = ?').run(taskId);
      return;
    }
    this.db.prepare(
      `INSERT INTO misc_reminders(task_id, fire_at_utc, fired) VALUES(?,?,0)
       ON CONFLICT(task_id) DO UPDATE SET fire_at_utc=excluded.fire_at_utc, fired=0`
    ).run(taskId, task.remind_at_utc);
  }

  reconcileFutureMiscReminders(now = new Date()): void {
    this.withTransaction(() => {
      this.db.prepare(
        `DELETE FROM misc_reminders
         WHERE NOT EXISTS (
           SELECT 1 FROM tasks t WHERE t.id = misc_reminders.task_id
             AND t.kind = 'misc' AND t.status = 'active' AND t.remind_at_utc IS NOT NULL
         )`
      ).run();
      const rows = this.db.prepare(
        "SELECT id FROM tasks WHERE kind = 'misc' AND status = 'active' AND remind_at_utc IS NOT NULL"
      ).all() as unknown as Array<{ id: string }>;
      for (const row of rows) this.syncMiscReminder(row.id, now, true);
    });
  }

  disableForTask(taskId: string): void {
    this.db.prepare('DELETE FROM reminders WHERE task_id = ?').run(taskId);
    this.db.prepare(
      'DELETE FROM node_reminders WHERE node_id IN (SELECT id FROM nodes WHERE task_id = ?)'
    ).run(taskId);
    this.db.prepare('DELETE FROM misc_reminders WHERE task_id = ?').run(taskId);
  }

  dueNow(now = new Date()): DueReminder[] {
    return this.claim(now.toISOString(), false);
  }

  claimMissed(now = new Date(), graceMinutes = 2): DueReminder[] {
    const cutoff = new Date(now.getTime() - graceMinutes * 60000).toISOString();
    return this.claim(cutoff, true);
  }

  missedSince(now = new Date(), graceMinutes = 2): number {
    const cutoff = new Date(now.getTime() - graceMinutes * 60000).toISOString();
    const task = this.db.prepare(
      `SELECT COUNT(*) AS count FROM reminders r JOIN tasks t ON t.id = r.task_id
       WHERE r.fired = 0 AND r.fire_at_utc < ? AND t.kind = 'procurement' AND t.status = 'active'`
    ).get(cutoff) as { count: number };
    const node = this.db.prepare(
      `SELECT COUNT(*) AS count FROM node_reminders nr
       JOIN nodes n ON n.id = nr.node_id JOIN tasks t ON t.id = n.task_id
       WHERE nr.fired = 0 AND nr.fire_at_utc < ? AND t.status = 'active'
         AND n.status IN ('pending','in_progress')`
    ).get(cutoff) as { count: number };
    const misc = this.db.prepare(
      `SELECT COUNT(*) AS count FROM misc_reminders mr JOIN tasks t ON t.id = mr.task_id
       WHERE mr.fired = 0 AND mr.fire_at_utc < ? AND t.kind = 'misc' AND t.status = 'active'`
    ).get(cutoff) as { count: number };
    return task.count + node.count + misc.count;
  }

  nextPendingAt(): string | null {
    const row = this.db.prepare(
      `SELECT MIN(fire_at_utc) AS fire_at FROM (
         SELECT r.fire_at_utc FROM reminders r JOIN tasks t ON t.id = r.task_id
         WHERE r.fired = 0 AND t.kind = 'procurement' AND t.status = 'active'
         UNION ALL
         SELECT nr.fire_at_utc FROM node_reminders nr
         JOIN nodes n ON n.id = nr.node_id JOIN tasks t ON t.id = n.task_id
         WHERE nr.fired = 0 AND t.status = 'active' AND n.status IN ('pending','in_progress')
         UNION ALL
         SELECT mr.fire_at_utc FROM misc_reminders mr JOIN tasks t ON t.id = mr.task_id
         WHERE mr.fired = 0 AND t.kind = 'misc' AND t.status = 'active'
       )`
    ).get() as { fire_at: string | null };
    return row.fire_at;
  }

  private claim(cutoff: string, strictBefore: boolean): DueReminder[] {
    const comparison = strictBefore ? '<' : '<=';
    const taskRows = this.db.prepare(
      `SELECT r.id, r.task_id, r.fire_at_utc, t.name AS task_name, t.deadline_utc
       FROM reminders r JOIN tasks t ON t.id = r.task_id
       WHERE r.fired = 0 AND r.fire_at_utc ${comparison} ? AND t.kind = 'procurement' AND t.status = 'active'`
    ).all(cutoff) as unknown as TaskDueRow[];
    const nodeRows = this.db.prepare(
      `SELECT nr.node_id, nr.fire_at_utc, n.task_id, n.title AS node_title, t.name AS task_name
       FROM node_reminders nr JOIN nodes n ON n.id = nr.node_id JOIN tasks t ON t.id = n.task_id
       WHERE nr.fired = 0 AND nr.fire_at_utc ${comparison} ? AND t.status = 'active'
         AND n.status IN ('pending','in_progress')`
    ).all(cutoff) as unknown as NodeDueRow[];
    const miscRows = this.db.prepare(
      `SELECT mr.task_id, mr.fire_at_utc, t.name AS task_name
       FROM misc_reminders mr JOIN tasks t ON t.id = mr.task_id
       WHERE mr.fired = 0 AND mr.fire_at_utc ${comparison} ? AND t.kind = 'misc' AND t.status = 'active'`
    ).all(cutoff) as unknown as MiscDueRow[];
    const claimed: DueReminder[] = [];
    this.withTransaction(() => {
      const markTask = this.db.prepare('UPDATE reminders SET fired = 1 WHERE id = ? AND fired = 0');
      for (const row of taskRows) {
        if (markTask.run(row.id).changes === 0) continue;
        claimed.push({
          id: row.id,
          kind: 'task',
          taskId: row.task_id,
          taskName: row.task_name,
          fireAt: row.fire_at_utc,
          deadlineUtc: row.deadline_utc
        });
      }
      const markNode = this.db.prepare('UPDATE node_reminders SET fired = 1 WHERE node_id = ? AND fired = 0');
      for (const row of nodeRows) {
        if (markNode.run(row.node_id).changes === 0) continue;
        claimed.push({
          id: row.node_id,
          kind: 'node',
          taskId: row.task_id,
          taskName: row.task_name,
          nodeId: row.node_id,
          nodeTitle: row.node_title,
          fireAt: row.fire_at_utc
        });
      }
      const markMisc = this.db.prepare('UPDATE misc_reminders SET fired = 1 WHERE task_id = ? AND fired = 0');
      for (const row of miscRows) {
        if (markMisc.run(row.task_id).changes === 0) continue;
        claimed.push({
          id: row.task_id,
          kind: 'misc',
          taskId: row.task_id,
          taskName: row.task_name,
          fireAt: row.fire_at_utc
        });
      }
    });
    return claimed.sort((left, right) => left.fireAt.localeCompare(right.fireAt) || left.id.localeCompare(right.id));
  }

  private withTransaction<T>(action: () => T): T {
    const ownsTransaction = !this.db.isTransaction;
    if (ownsTransaction) this.db.exec('BEGIN');
    try {
      const result = action();
      if (ownsTransaction) this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (ownsTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
