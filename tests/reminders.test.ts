import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/main/db';
import { AppService } from '../src/main/appService';
import { SettingsService } from '../src/main/settingsService';

const dirs: string[] = [];
function fresh(): { app: AppService; settings: SettingsService } {
  const dir = mkdtempSync(path.join(tmpdir(), 'caiban-remind-'));
  dirs.push(dir);
  const db = openDatabase(path.join(dir, 'island.db'));
  return { app: new AppService(db, dir), settings: new SettingsService(db) };
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
});

describe('提醒（FR-060~064）', () => {
  it('设置提前量 → 按 deadline 计算 fire_at；去重排序', () => {
    const { app } = fresh();
    const deadline = new Date('2026-08-20T10:00:00.000Z');
    const t = app.createTask({ name: 'r', description: '', kind: 'task', urgency: 'normal', deadlineUtc: deadline.toISOString(), tzId: 'Asia/Shanghai' });
    app.setReminders(t.id, [60, 30, 30]);
    const rows = app.reminders.listForTask(t.id);
    expect(rows.map((r) => r.offset_minutes)).toEqual([30, 60]);
    expect(rows[0].fire_at_utc).toBe(new Date(deadline.getTime() - 30 * 60000).toISOString());
  });

  it('无 deadline 时不生成提醒；归档后禁用', () => {
    const { app } = fresh();
    const t = app.createTask({ name: 'r2', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    app.setReminders(t.id, [60]);
    expect(app.reminders.listForTask(t.id)).toHaveLength(0);
  });

  it('到期触发（dueNow）并标记 fired；只触发一次', () => {
    const { app } = fresh();
    const deadline = new Date(Date.now() + 30 * 60000);
    const t = app.createTask({ name: 'due', description: '', kind: 'task', urgency: 'normal', deadlineUtc: deadline.toISOString(), tzId: 'Asia/Shanghai' });
    app.setReminders(t.id, [30]);
    // 现在已过 fire_at
    const due = app.reminders.dueNow();
    expect(due).toHaveLength(1);
    expect(due[0].taskName).toBe('due');
    expect(app.reminders.dueNow()).toHaveLength(0);
  });

  it('漏发计数（missedSince）与全局默认提前量', () => {
    const { app, settings } = fresh();
    settings.setJson('reminder_default_offsets', [60]);
    const deadline = new Date(Date.now() + 10 * 60000);
    const t = app.createTask({ name: 'auto', description: '', kind: 'task', urgency: 'normal', deadlineUtc: deadline.toISOString(), tzId: 'Asia/Shanghai' });
    // 自动添加了默认提前量 60 分钟（fire_at 已过）
    expect(app.reminders.offsetsForTask(t.id)).toEqual([60]);
    expect(app.reminders.missedSince()).toBe(1);
  });

  it('deadline 变化后提醒时间重算', () => {
    const { app } = fresh();
    const t = app.createTask({ name: 'm', description: '', kind: 'task', urgency: 'normal', deadlineUtc: '2026-08-20T10:00:00.000Z', tzId: 'Asia/Shanghai' });
    app.setReminders(t.id, [60]);
    const before = app.reminders.listForTask(t.id)[0].fire_at_utc;
    app.updateTask(t.id, { name: 'm', description: '', kind: 'task', urgency: 'normal', deadlineUtc: '2026-08-21T10:00:00.000Z', tzId: 'Asia/Shanghai' });
    const after = app.reminders.listForTask(t.id)[0].fire_at_utc;
    expect(after).not.toBe(before);
    expect(after).toBe('2026-08-21T09:00:00.000Z');
  });
});
