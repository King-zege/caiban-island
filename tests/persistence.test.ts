import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/main/db';
import { TaskError, TaskService } from '../src/main/taskService';
import type { TaskInput } from '../src/shared/taskContracts';

const dirs: string[] = [];
function freshService(): { service: TaskService; dbPath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'caiban-test-'));
  dirs.push(dir);
  const dbPath = path.join(dir, 'island.db');
  const db = openDatabase(dbPath);
  return { service: new TaskService(db), dbPath };
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
});

const input = (partial: Partial<TaskInput> = {}): TaskInput => ({
  name: '测试任务',
  description: '',
  kind: 'task',
  urgency: 'normal',
  deadlineUtc: null,
  tzId: 'Asia/Shanghai',
  ...partial
});

describe('TaskService 持久化', () => {
  it('创建 → 列表按紧急度排序（critical 在前）', () => {
    const { service } = freshService();
    service.createTask(input({ name: '普通任务' }));
    service.createTask(input({ name: '紧急任务', urgency: 'critical' }));
    const cards = service.listActive();
    expect(cards.map((c) => c.task.name)).toEqual(['紧急任务', '普通任务']);
    expect(cards[0].progress).toEqual({ done: 0, total: 0, nextTitle: null });
    expect(cards[0].overdue).toBe(false);
  });

  it('杂事无节点进度；deadline 过期标记', () => {
    const { service } = freshService();
    service.createTask(input({ name: '杂事', kind: 'misc' }));
    const past = new Date(Date.now() - 86400000).toISOString();
    service.createTask(input({ name: '已过期', deadlineUtc: past }));
    const cards = service.listActive();
    const misc = cards.find((c) => c.task.name === '杂事');
    expect(misc?.progress).toEqual({ done: 0, total: 0, nextTitle: null });
    const overdue = cards.find((c) => c.task.name === '已过期');
    expect(overdue?.overdue).toBe(true);
  });

  it('校验失败抛 TaskError 且不落库', () => {
    const { service } = freshService();
    expect(() => service.createTask(input({ name: '  ' }))).toThrow(TaskError);
    expect(service.listActive()).toHaveLength(0);
  });

  it('更新任务字段', () => {
    const { service } = freshService();
    const t = service.createTask(input({ name: '旧名' }));
    const updated = service.updateTask(t.id, input({ name: '新名', urgency: 'high' }));
    expect(updated.name).toBe('新名');
    expect(updated.urgency).toBe('high');
  });

  it('紧急程度快捷写入只更新目标字段，并拒绝旧值冲突', () => {
    const { service, dbPath } = freshService();
    const task = service.createTask(input({
      name: '保持名称',
      description: '保持说明',
      deadlineUtc: '2026-09-01T00:00:00.000Z'
    }));
    const updated = service.setUrgency({ taskId: task.id, urgency: 'critical', expectedUrgency: 'normal' });
    expect(updated).toMatchObject({
      name: '保持名称',
      description: '保持说明',
      deadlineUtc: '2026-09-01T00:00:00.000Z',
      urgency: 'critical'
    });
    expect(() => service.setUrgency({ taskId: task.id, urgency: 'low', expectedUrgency: 'normal' }))
      .toThrow('任务紧急程度已变化，请刷新后重试');
    expect(service.getTask(task.id)?.urgency).toBe('critical');

    const verify = openDatabase(dbPath);
    const event = verify.prepare("SELECT detail FROM change_events WHERE task_id = ? AND kind = 'task_urgency_updated'").get(task.id) as { detail: string };
    expect(JSON.parse(event.detail)).toEqual({ from: 'normal', to: 'critical' });
    verify.close();
  });

  it('任务与节点重命名只更新名称字段，并拒绝旧值冲突', () => {
    const { service, dbPath } = freshService();
    const task = service.createTask(input({ name: '旧任务名', description: '保留说明', urgency: 'high' }));
    const node = service.addNode(task.id, {
      title: '旧节点名', description: '保留节点说明', startUtc: null, endUtc: null
    });

    const renamedTask = service.setName({ taskId: task.id, name: '  新任务名  ', expectedName: '旧任务名' });
    const renamedNode = service.setNodeTitle({ nodeId: node.id, title: '新节点名', expectedTitle: '旧节点名' });
    expect(renamedTask).toMatchObject({ name: '新任务名', description: '保留说明', urgency: 'high' });
    expect(renamedNode).toMatchObject({ title: '新节点名', description: '保留节点说明', startUtc: null, status: 'pending' });
    expect(() => service.setName({ taskId: task.id, name: '冲突任务名', expectedName: '旧任务名' }))
      .toThrow('任务名称已变化，请刷新后重试');
    expect(() => service.setNodeTitle({ nodeId: node.id, title: '冲突节点名', expectedTitle: '旧节点名' }))
      .toThrow('节点名称已变化，请刷新后重试');

    const verify = openDatabase(dbPath);
    const events = verify.prepare("SELECT kind FROM change_events WHERE task_id = ? AND kind IN ('task_name_updated', 'node_title_updated') ORDER BY id").all(task.id) as unknown as Array<{ kind: string }>;
    expect(events.map((event) => event.kind)).toEqual(['task_name_updated', 'node_title_updated']);
    verify.close();
  });

  it('重命名复用名称校验且原值无操作不写审计', () => {
    const { service, dbPath } = freshService();
    const task = service.createTask(input({ name: '原任务名' }));
    const node = service.addNode(task.id, { title: '原节点名', description: '', startUtc: null, endUtc: null });
    expect(service.setName({ taskId: task.id, name: ' 原任务名 ', expectedName: '原任务名' }).name).toBe('原任务名');
    expect(service.setNodeTitle({ nodeId: node.id, title: ' 原节点名 ', expectedTitle: '原节点名' }).title).toBe('原节点名');
    expect(() => service.setName({ taskId: task.id, name: ' ', expectedName: '原任务名' })).toThrow('任务名称不能为空');
    expect(() => service.setNodeTitle({ nodeId: node.id, title: ' ', expectedTitle: '原节点名' })).toThrow('节点标题不能为空');
    const verify = openDatabase(dbPath);
    const row = verify.prepare("SELECT COUNT(*) AS count FROM change_events WHERE task_id = ? AND kind IN ('task_name_updated', 'node_title_updated')").get(task.id) as { count: number };
    expect(row.count).toBe(0);
    verify.close();
  });

  it('完成/取消 → 归档并从活跃列表移除', () => {
    const { service } = freshService();
    const t = service.createTask(input());
    service.setArchived(t.id, 'completed');
    expect(service.listActive()).toHaveLength(0);
    expect(service.getTask(t.id)?.status).toBe('archived');
    expect(() => service.setArchived(t.id, 'cancelled')).toThrow(TaskError);
  });

  it('永久删除活跃任务并级联清理正式数据与事件', () => {
    const { service, dbPath } = freshService();
    const task = service.createTask(input({ name: '待删除任务' }));
    service.addNode(task.id, { title: '询价', description: '', startUtc: null, endUtc: null });
    service.addLink(task.id, { kind: 'url', title: '报价', target: 'https://example.com' });
    service.saveNote(task.id, '删除测试');
    service.deleteTask(task.id);

    expect(service.getTask(task.id)).toBeNull();
    const verify = openDatabase(dbPath);
    for (const table of ['nodes', 'links', 'notes', 'reminders', 'change_events']) {
      const row = verify.prepare('SELECT COUNT(*) AS count FROM ' + table + ' WHERE task_id = ?').get(task.id) as { count: number };
      expect(row.count).toBe(0);
    }
    verify.close();
  });

  it('重新打开数据库数据仍在（持久化往返）', () => {
    const { service, dbPath } = freshService();
    service.createTask(input({ name: '持久化任务' }));
    const db2 = openDatabase(dbPath);
    const service2 = new TaskService(db2);
    const cards = service2.listActive();
    expect(cards.map((c) => c.task.name)).toEqual(['持久化任务']);
    const v = db2.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number };
    expect(v.v).toBe(5);
    const nodeReminderTable = db2.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'node_reminders'").get();
    expect(nodeReminderTable).toBeTruthy();
    const miscReminderTable = db2.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'misc_reminders'").get();
    expect(miscReminderTable).toBeTruthy();
    db2.close();
  });
});
