import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppService } from '../src/main/appService';
import { migrate, openDatabase } from '../src/main/db';

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function fresh(): { app: AppService; db: DatabaseSync } {
  const dir = tempDir('caiban-p19-');
  const db = openDatabase(path.join(dir, 'island.db'));
  return { app: new AppService(db, dir), db };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe('P19 数据迁移与任务分层', () => {
  it('v4→v5 保全杂事说明与原备注，保留旧 deadline 但移除旧提前量提醒', () => {
    const dir = tempDir('caiban-p19-migrate-');
    const db = new DatabaseSync(path.join(dir, 'island.db'));
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES(1,'x'),(2,'x'),(3,'x'),(4,'x');
      CREATE TABLE tasks(
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'task',
        urgency TEXT NOT NULL DEFAULT 'normal', deadline_utc TEXT, tz_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
        archived_at TEXT, archive_outcome TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE notes(id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, body TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
      CREATE TABLE reminders(id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, offset_minutes INTEGER NOT NULL, fire_at_utc TEXT NOT NULL, fired INTEGER NOT NULL DEFAULT 0);
      INSERT INTO tasks VALUES('m1','旧杂事一','旧说明一','misc','high','2099-09-01T00:00:00.000Z','Asia/Shanghai','active',NULL,NULL,'x','x');
      INSERT INTO tasks VALUES('m2','旧杂事二','旧说明二','misc','normal','2020-09-01T00:00:00.000Z','Asia/Shanghai','active',NULL,NULL,'x','x');
      INSERT INTO notes VALUES('note-1','m1','原备注','x');
      INSERT INTO reminders VALUES('r1','m1',60,'2099-08-31T23:00:00.000Z',0);
    `);

    migrate(db);

    const tasks = db.prepare("SELECT id, description, deadline_utc, remind_at_utc FROM tasks WHERE kind='misc' ORDER BY id").all() as unknown as Array<Record<string, unknown>>;
    expect(tasks).toEqual([
      { id: 'm1', description: '', deadline_utc: '2099-09-01T00:00:00.000Z', remind_at_utc: null },
      { id: 'm2', description: '', deadline_utc: '2020-09-01T00:00:00.000Z', remind_at_utc: null }
    ]);
    expect(db.prepare("SELECT body FROM notes WHERE task_id='m1'").get()).toEqual({ body: '原备注\n\n原任务说明\n旧说明一' });
    expect(db.prepare("SELECT body FROM notes WHERE task_id='m2'").get()).toEqual({ body: '旧说明二' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM reminders').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({ version: 12 });
    db.close();
  });

  it('杂事只保留名称、备注和精确提醒，并拒绝节点、紧急度和类型修改', () => {
    const { app } = fresh();
    const reminder = '2099-09-01T08:30:00.000Z';
    const misc = app.createTask({ kind: 'misc', name: '续门禁卡', note: '联系物业', remindAtUtc: reminder, tzId: 'Asia/Shanghai' });
    const detail = app.tasks.getTaskDetail(misc.id);

    expect(detail.task).toMatchObject({ kind: 'misc', description: '', urgency: 'normal', deadlineUtc: null, remindAtUtc: reminder });
    expect(detail.note).toBe('联系物业');
    expect(detail.nodes).toEqual([]);
    expect(detail.miscReminder).toMatchObject({ state: 'scheduled', fireAtUtc: reminder });
    expect(() => app.addNode(misc.id, { title: '不允许', description: '', startUtc: null, endUtc: null })).toThrow('杂事不支持节点');
    expect(() => app.setTaskUrgency({ taskId: misc.id, urgency: 'critical', expectedUrgency: 'normal' })).toThrow('杂事不设置紧急程度');
    expect(() => app.updateTask(misc.id, { name: misc.name, description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: misc.tzId })).toThrow('任务类型创建后不可修改');
  });
});

describe('P19 杂事精确提醒', () => {
  it('到时仅领取一次；相同时间不重置，修改时间才重置，并执行乐观并发检查', () => {
    const { app } = fresh();
    const first = '2099-09-01T08:30:00.000Z';
    const second = '2099-09-01T09:30:00.000Z';
    const misc = app.createTask({ kind: 'misc', name: '打电话', note: '', remindAtUtc: first, tzId: 'Asia/Shanghai' });

    expect(app.reminders.dueNow(new Date(first))).toEqual([expect.objectContaining({ kind: 'misc', taskId: misc.id, taskName: '打电话' })]);
    expect(app.reminders.dueNow(new Date(first))).toEqual([]);
    app.setMiscReminder({ taskId: misc.id, remindAtUtc: first, expectedRemindAtUtc: first });
    expect(app.reminders.listMiscReminder(misc.id)?.fired).toBe(1);

    app.setMiscReminder({ taskId: misc.id, remindAtUtc: second, expectedRemindAtUtc: first });
    expect(app.reminders.listMiscReminder(misc.id)).toMatchObject({ fire_at_utc: second, fired: 0 });
    expect(() => app.setMiscReminder({ taskId: misc.id, remindAtUtc: null, expectedRemindAtUtc: first })).toThrow('提醒时间已变化');
  });

  it('清除、完成会取消调度，恢复仅重建未来提醒，漏发摘要领取后不重复触发', () => {
    const { app } = fresh();
    const fireAt = '2099-09-01T08:30:00.000Z';
    const misc = app.createTask({ kind: 'misc', name: '取快递', note: '', remindAtUtc: fireAt, tzId: 'Asia/Shanghai' });
    app.completeTask(misc.id);
    expect(app.reminders.listMiscReminder(misc.id)).toBeNull();
    app.restoreTask(misc.id);
    expect(app.reminders.listMiscReminder(misc.id)).toMatchObject({ fire_at_utc: fireAt, fired: 0 });

    expect(app.reminders.claimMissed(new Date('2099-09-01T08:35:00.000Z'))).toEqual([
      expect.objectContaining({ kind: 'misc', taskId: misc.id })
    ]);
    expect(app.reminders.dueNow(new Date('2099-09-01T08:35:00.000Z'))).toEqual([]);
    app.setMiscReminder({ taskId: misc.id, remindAtUtc: null, expectedRemindAtUtc: fireAt });
    expect(app.reminders.listMiscReminder(misc.id)).toBeNull();
  });

  it('旧 deadline 可显式转换或清除，拒绝并发冲突与过去时间转换', () => {
    const { app, db } = fresh();
    const future = '2099-09-01T08:30:00.000Z';
    const first = app.createTask({ kind: 'misc', name: '旧杂事', note: '', remindAtUtc: null, tzId: 'Asia/Shanghai' });
    db.prepare('UPDATE tasks SET deadline_utc = ? WHERE id = ?').run(future, first.id);
    const converted = app.resolveLegacyMiscDeadline({ taskId: first.id, action: 'convert', expectedDeadlineUtc: future });
    expect(converted).toMatchObject({ deadlineUtc: null, remindAtUtc: future });
    expect(app.reminders.listMiscReminder(first.id)?.fire_at_utc).toBe(future);
    expect(() => app.resolveLegacyMiscDeadline({ taskId: first.id, action: 'clear', expectedDeadlineUtc: future })).toThrow('旧截止时间已变化');

    const past = '2020-09-01T08:30:00.000Z';
    const second = app.createTask({ kind: 'misc', name: '过期旧杂事', note: '', remindAtUtc: null, tzId: 'Asia/Shanghai' });
    db.prepare('UPDATE tasks SET deadline_utc = ? WHERE id = ?').run(past, second.id);
    expect(() => app.resolveLegacyMiscDeadline({ taskId: second.id, action: 'convert', expectedDeadlineUtc: past })).toThrow('过去的截止时间不能转换');
    expect(app.resolveLegacyMiscDeadline({ taskId: second.id, action: 'clear', expectedDeadlineUtc: past }).deadlineUtc).toBeNull();
  });

});
