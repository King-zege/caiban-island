import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface ReminderRow {
  id: string;
  task_id: string;
  offset_minutes: number;
  fire_at_utc: string;
  fired: number;
}

// FR-060~064：提前量提醒；启动/任务变更时重算；漏发合并摘要；Toast 不可用时由上层做岛内轻弹
export class ReminderService {
  constructor(private readonly db: DatabaseSync) {}

  listForTask(taskId: string): ReminderRow[] {
    return this.db
      .prepare('SELECT * FROM reminders WHERE task_id = ? ORDER BY offset_minutes')
      .all(taskId) as unknown as ReminderRow[];
  }

  offsetsForTask(taskId: string): number[] {
    return this.listForTask(taskId).map((r) => r.offset_minutes);
  }

  // 以 deadline 与提前量集合重建提醒（删除旧的全部重建，保证幂等）
  setOffsets(taskId: string, offsets: number[]): void {
    const task = this.db.prepare('SELECT deadline_utc, status FROM tasks WHERE id = ?').get(taskId) as
      | { deadline_utc: string | null; status: string }
      | undefined;
    if (!task) throw new Error('任务不存在');
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM reminders WHERE task_id = ?').run(taskId);
      if (task.status === 'active' && task.deadline_utc && offsets.length > 0) {
        const deadline = Date.parse(task.deadline_utc);
        const unique = [...new Set(offsets)].sort((a, b) => a - b);
        const ins = this.db.prepare(
          'INSERT INTO reminders(id, task_id, offset_minutes, fire_at_utc, fired) VALUES(?,?,?,?,0)'
        );
        for (const off of unique) {
          if (off <= 0) continue;
          ins.run(randomUUID(), taskId, off, new Date(deadline - off * 60000).toISOString());
        }
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // deadline 变化后按现有提前量重算 fire_at
  recomputeForTask(taskId: string): void {
    const offsets = this.offsetsForTask(taskId);
    if (offsets.length > 0) this.setOffsets(taskId, offsets);
  }

  disableForTask(taskId: string): void {
    this.db.prepare('DELETE FROM reminders WHERE task_id = ?').run(taskId);
  }

  // 到期且未触发的提醒；返回（含任务名），并标记 fired
  dueNow(now = new Date()): Array<{ taskId: string; taskName: string; fireAt: string }> {
    const rows = this.db
      .prepare(
        `SELECT r.task_id, r.fire_at_utc, t.name AS task_name
         FROM reminders r JOIN tasks t ON t.id = r.task_id
         WHERE r.fired = 0 AND r.fire_at_utc <= ?`
      )
      .all(now.toISOString()) as unknown as Array<{ task_id: string; fire_at_utc: string; task_name: string }>;
    const ids = rows.map((r) => r.task_id);
    if (ids.length > 0) {
      const marks = this.db.prepare('UPDATE reminders SET fired = 1 WHERE task_id = ? AND fired = 0');
      for (const id of ids) marks.run(id);
    }
    return rows.map((r) => ({ taskId: r.task_id, taskName: r.task_name, fireAt: r.fire_at_utc }));
  }

  // FR-064：启动时把错过的提醒合并为一条摘要（仍保留明细计数）
  missedSince(now = new Date(), graceMinutes = 2): number {
    const since = new Date(now.getTime() - graceMinutes * 60000).toISOString();
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM reminders WHERE fired = 0 AND fire_at_utc < ?')
      .get(since) as { c: number };
    return row.c;
  }
}
