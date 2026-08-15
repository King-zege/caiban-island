import { describe, expect, it } from 'vitest';
import { compareTasks, computeProgress, isOverdue } from '../src/shared/sorting';
import type { Task } from '../src/shared/taskContracts';

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    name: '任务',
    description: '',
    kind: 'task',
    urgency: 'normal',
    deadlineUtc: null,
    tzId: 'Asia/Shanghai',
    status: 'active',
    createdAtUtc: '2026-01-01T00:00:00.000Z',
    updatedAtUtc: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    archiveOutcome: null,
    ...partial
  };
}

describe('compareTasks（FR-030）', () => {
  it('紧急度优先：紧急 → 高 → 普通 → 低', () => {
    const list = [
      task({ id: 'a', urgency: 'low' }),
      task({ id: 'b', urgency: 'critical' }),
      task({ id: 'c', urgency: 'normal' }),
      task({ id: 'd', urgency: 'high' })
    ];
    expect([...list].sort(compareTasks).map((t) => t.id)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('同紧急度：有 deadline 优先', () => {
    const list = [
      task({ id: 'a', urgency: 'high', deadlineUtc: null }),
      task({ id: 'b', urgency: 'high', deadlineUtc: '2026-03-01T00:00:00.000Z' })
    ];
    expect([...list].sort(compareTasks).map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('同紧急度且有 deadline：deadline 升序', () => {
    const list = [
      task({ id: 'a', urgency: 'critical', deadlineUtc: '2026-05-01T00:00:00.000Z' }),
      task({ id: 'b', urgency: 'critical', deadlineUtc: '2026-02-01T00:00:00.000Z' })
    ];
    expect([...list].sort(compareTasks).map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('再按创建时间升序，最后按 ID 稳定排序', () => {
    const list = [
      task({ id: 'z', createdAtUtc: '2026-01-02T00:00:00.000Z' }),
      task({ id: 'a', createdAtUtc: '2026-01-01T00:00:00.000Z' })
    ];
    expect([...list].sort(compareTasks).map((t) => t.id)).toEqual(['a', 'z']);
    const same = [task({ id: 'b' }), task({ id: 'a' })];
    expect([...same].sort(compareTasks).map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('computeProgress', () => {
  it('无节点 → 尚未拆分', () => {
    expect(computeProgress([])).toEqual({ done: 0, total: 0, nextTitle: null });
  });
  it('统计完成数与下一个未完成节点', () => {
    const nodes: Array<{ title: string; status: string; position: number }> = [
      { title: '询价', status: 'completed', position: 1 },
      { title: '比价', status: 'in_progress', position: 2 },
      { title: '下单', status: 'pending', position: 3 }
    ];
    expect(computeProgress(nodes)).toEqual({ done: 1, total: 3, nextTitle: '比价' });
  });
  it('全部完成 → 无下一节点', () => {
    const nodes = [
      { title: 'a', status: 'completed', position: 2 },
      { title: 'b', status: 'completed', position: 1 }
    ];
    expect(computeProgress(nodes)).toEqual({ done: 2, total: 2, nextTitle: null });
  });
});

describe('isOverdue', () => {
  it('过期判断（现在 > deadline）', () => {
    const now = Date.parse('2026-06-01T00:00:00.000Z');
    expect(isOverdue(task({ id: 'a', deadlineUtc: '2026-05-01T00:00:00.000Z' }), now)).toBe(true);
    expect(isOverdue(task({ id: 'b', deadlineUtc: '2026-07-01T00:00:00.000Z' }), now)).toBe(false);
    expect(isOverdue(task({ id: 'c', deadlineUtc: null }), now)).toBe(false);
  });
});
