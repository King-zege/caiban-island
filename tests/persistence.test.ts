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
    expect(v.v).toBe(3);
    db2.close();
  });
});
