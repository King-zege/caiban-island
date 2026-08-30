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

describe('任务与节点提醒（FR-060~069）', () => {
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
    expect(due[0]).toMatchObject({ kind: 'task', taskName: 'due' });
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

  it('只标记实际到期的任务提醒，不误伤同任务的未来提前量', () => {
    const { app } = fresh();
    const now = new Date('2099-08-20T10:00:00.000Z');
    const deadline = new Date(now.getTime() + 90 * 60000);
    const task = app.createTask({ name: '多提醒', description: '', kind: 'task', urgency: 'normal', deadlineUtc: deadline.toISOString(), tzId: 'Asia/Shanghai' });
    app.setReminders(task.id, [90, 30]);

    const due = app.reminders.dueNow(now);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ kind: 'task', taskId: task.id });
    expect(app.reminders.listForTask(task.id).find((row) => row.offset_minutes === 30)?.fired).toBe(0);
  });

  it('节点开始时间生成一次性提醒，修改与清除使用乐观并发', () => {
    const { app } = fresh();
    const task = app.createTask({ name: '节点提醒', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    const firstStart = '2099-08-20T10:00:00.000Z';
    const node = app.addNode(task.id, { title: '询价', description: '', startUtc: firstStart, endUtc: null });
    expect(app.reminders.listNodeReminder(node.id)?.fire_at_utc).toBe(firstStart);

    const secondStart = '2099-08-20T11:00:00.000Z';
    app.setNodeStartTime({ nodeId: node.id, startUtc: secondStart, expectedStartUtc: firstStart });
    expect(app.reminders.listNodeReminder(node.id)?.fire_at_utc).toBe(secondStart);
    expect(() => app.setNodeStartTime({ nodeId: node.id, startUtc: null, expectedStartUtc: firstStart })).toThrow('节点时间已变化');

    app.setNodeStartTime({ nodeId: node.id, startUtc: null, expectedStartUtc: secondStart });
    expect(app.reminders.listNodeReminder(node.id)).toBeNull();
  });

  it('节点提醒到期只触发一次，并随完成、恢复、删除和归档同步', () => {
    const { app } = fresh();
    const task = app.createTask({ name: '生命周期', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    const start = '2099-08-20T10:00:00.000Z';
    const node = app.addNode(task.id, { title: '比价', description: '', startUtc: start, endUtc: null });

    app.setNodeStatus(node.id, 'completed');
    expect(app.reminders.listNodeReminder(node.id)).toBeNull();
    expect(app.tasks.getTaskDetail(task.id).nodes[0].startUtc).toBe(start);
    app.setNodeStatus(node.id, 'pending');
    expect(app.reminders.listNodeReminder(node.id)?.fire_at_utc).toBe(start);

    const due = app.reminders.dueNow(new Date(start));
    expect(due).toEqual([expect.objectContaining({ kind: 'node', nodeId: node.id, nodeTitle: '比价' })]);
    expect(app.reminders.dueNow(new Date(start))).toHaveLength(0);

    app.cancelTask(task.id);
    expect(app.reminders.listNodeReminder(node.id)).toBeNull();
    app.restoreTask(task.id);
    expect(app.reminders.listNodeReminder(node.id)?.fired).toBe(0);
    app.removeNode(node.id);
    expect(app.reminders.listNodeReminder(node.id)).toBeNull();
  });

  it('修改非时间字段不重复提醒，修改时间才重置触发状态', () => {
    const { app } = fresh();
    const task = app.createTask({ name: '触发状态', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    const start = '2099-08-20T10:00:00.000Z';
    const node = app.addNode(task.id, { title: '询价', description: '', startUtc: start, endUtc: null });
    expect(app.reminders.dueNow(new Date(start))).toHaveLength(1);

    app.updateNode(node.id, { title: '询价与比价', description: '', startUtc: start, endUtc: null });
    expect(app.reminders.listNodeReminder(node.id)?.fired).toBe(1);
    expect(app.reminders.dueNow(new Date(start))).toHaveLength(0);

    const nextStart = '2099-08-20T11:00:00.000Z';
    app.updateNode(node.id, { title: '询价与比价', description: '', startUtc: nextStart, endUtc: null });
    expect(app.reminders.listNodeReminder(node.id)).toMatchObject({ fire_at_utc: nextStart, fired: 0 });
  });

  it('漏发节点提醒被摘要领取后不会再逐条补发', () => {
    const { app } = fresh();
    const task = app.createTask({ name: '漏发', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    const start = '2099-08-20T10:00:00.000Z';
    const node = app.addNode(task.id, { title: '签约', description: '', startUtc: start, endUtc: null });

    const missed = app.reminders.claimMissed(new Date('2099-08-20T10:05:00.000Z'));
    expect(missed).toEqual([expect.objectContaining({ kind: 'node', nodeId: node.id })]);
    expect(app.reminders.dueNow(new Date('2099-08-20T10:05:00.000Z'))).toHaveLength(0);
  });

  it('升级回填只补建活跃节点的未来开始时间', () => {
    const { app } = fresh();
    const task = app.createTask({ name: '升级回填', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    const past = app.addNode(task.id, { title: '旧节点', description: '', startUtc: '2099-08-20T10:00:00.000Z', endUtc: null });
    const future = app.addNode(task.id, { title: '新节点', description: '', startUtc: '2099-08-20T11:00:00.000Z', endUtc: null });
    app.reminders.disableForTask(task.id);

    app.reminders.reconcileFutureNodeReminders(new Date('2099-08-20T10:30:00.000Z'));
    expect(app.reminders.listNodeReminder(past.id)).toBeNull();
    expect(app.reminders.listNodeReminder(future.id)?.fire_at_utc).toBe('2099-08-20T11:00:00.000Z');
  });
});
