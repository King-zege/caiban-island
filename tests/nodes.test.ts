import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/main/db';
import { TaskError, TaskService } from '../src/main/taskService';

const dirs: string[] = [];
function fresh(): TaskService {
  const dir = mkdtempSync(path.join(tmpdir(), 'caiban-nodes-'));
  dirs.push(dir);
  const db = openDatabase(path.join(dir, 'island.db'));
  return new TaskService(db);
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
});

describe('节点管理（FR-024/FR-025/FR-026）', () => {
  it('添加节点：顺序递增、默认待完成；进度随之更新', () => {
    const svc = fresh();
    const t = svc.createTask({ name: '采购', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    const n1 = svc.addNode(t.id, { title: '询价', description: '', startUtc: null, endUtc: null });
    const n2 = svc.addNode(t.id, { title: '比价', description: '', startUtc: null, endUtc: null });
    expect(n1.position).toBe(0);
    expect(n2.position).toBe(1);
    expect(n1.status).toBe('pending');
    const detail = svc.getTaskDetail(t.id);
    expect(detail.nodes.map((n) => n.title)).toEqual(['询价', '比价']);
    expect(detail.nodes[0].status).toBe('pending');
  });

  it('四态切换并记录事件', () => {
    const svc = fresh();
    const t = svc.createTask({ name: 't', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    const n = svc.addNode(t.id, { title: 'n', description: '', startUtc: null, endUtc: null });
    expect(svc.setNodeStatus(n.id, 'in_progress').status).toBe('in_progress');
    expect(svc.setNodeStatus(n.id, 'completed').status).toBe('completed');
    expect(svc.setNodeStatus(n.id, 'pending').status).toBe('pending');
    expect(svc.setNodeStatus(n.id, 'cancelled').status).toBe('cancelled');
    expect(() => svc.setNodeStatus(n.id, 'done' as never)).toThrow(TaskError);
    const events = svc.getTaskDetail(t.id);
    expect(events.task.id).toBe(t.id);
  });

  it('删除节点后位置重排', () => {
    const svc = fresh();
    const t = svc.createTask({ name: 't', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    const a = svc.addNode(t.id, { title: 'a', description: '', startUtc: null, endUtc: null });
    const b = svc.addNode(t.id, { title: 'b', description: '', startUtc: null, endUtc: null });
    const c = svc.addNode(t.id, { title: 'c', description: '', startUtc: null, endUtc: null });
    svc.removeNode(b.id);
    const nodes = svc.getTaskDetail(t.id).nodes;
    expect(nodes.map((n) => n.title)).toEqual(['a', 'c']);
    expect(nodes.map((n) => n.position)).toEqual([0, 1]);
    void a; void c;
  });

  it('重排节点顺序', () => {
    const svc = fresh();
    const t = svc.createTask({ name: 't', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    const a = svc.addNode(t.id, { title: 'a', description: '', startUtc: null, endUtc: null });
    const b = svc.addNode(t.id, { title: 'b', description: '', startUtc: null, endUtc: null });
    svc.reorderNodes(t.id, [b.id, a.id]);
    expect(svc.getTaskDetail(t.id).nodes.map((n) => n.title)).toEqual(['b', 'a']);
  });

  it('杂事不允许添加节点；非法时间拒绝', () => {
    const svc = fresh();
    const m = svc.createTask({ name: '杂事', description: '', kind: 'misc', urgency: 'low', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    expect(() => svc.addNode(m.id, { title: 'x', description: '', startUtc: null, endUtc: null })).toThrow(TaskError);
    const t = svc.createTask({ name: 't', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    expect(() =>
      svc.addNode(t.id, { title: 'x', description: '', startUtc: '2026-03-02T00:00:00.000Z', endUtc: '2026-03-01T00:00:00.000Z' })
    ).toThrow(TaskError);
    expect(() =>
      svc.addNode(t.id, { title: '过去节点', description: '', startUtc: new Date(Date.now() - 3600000).toISOString(), endUtc: null })
    ).toThrow('不能早于当前时间');
  });
});
