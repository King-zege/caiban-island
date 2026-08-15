import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/main/db';
import { AppService } from '../src/main/appService';
import type { DraftPayload, TaskDraftPayload } from '../src/shared/draftContracts';

const dirs: string[] = [];
function fresh(): AppService {
  const dir = mkdtempSync(path.join(tmpdir(), 'caiban-draft-'));
  dirs.push(dir);
  const db = openDatabase(path.join(dir, 'island.db'));
  return new AppService(db, dir);
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
});

const taskDraft = (name = '草稿任务'): TaskDraftPayload => ({
  type: 'task',
  taskInput: { name, description: '说明', kind: 'task', urgency: 'high', deadlineUtc: null, tzId: 'Asia/Shanghai' },
  nodes: [
    { title: '询价', description: '', startUtc: null, endUtc: null },
    { title: '比价', description: '', startUtc: null, endUtc: null }
  ],
  warnings: []
});

describe('草稿审核（FR-043~048）', () => {
  it('创建任务草稿 → 列表 → 确认后单事务创建任务与节点', () => {
    const app = fresh();
    const d = app.drafts.create('mcp', taskDraft());
    expect(app.drafts.listPending()).toHaveLength(1);
    const r = app.drafts.confirm(d.id);
    expect(r.type).toBe('task');
    const detail = app.tasks.getTaskDetail(r.taskId);
    expect(detail.task.name).toBe('草稿任务');
    expect(detail.task.urgency).toBe('high');
    expect(detail.nodes.map((n) => n.title)).toEqual(['询价', '比价']);
    expect(app.drafts.listPending()).toHaveLength(0);
    expect(app.drafts.get(d.id).state).toBe('confirmed');
  });

  it('用户编辑草稿后确认（修改节点标题、删除节点）', () => {
    const app = fresh();
    const d = app.drafts.create('mcp', taskDraft());
    const edited: DraftPayload = {
      ...taskDraft(),
      nodes: [{ title: '询价', description: '', startUtc: null, endUtc: null }]
    };
    app.drafts.updatePayload(d.id, edited);
    const r = app.drafts.confirm(d.id);
    const detail = app.tasks.getTaskDetail(r.taskId);
    expect(detail.nodes).toHaveLength(1);
  });

  it('丢弃草稿', () => {
    const app = fresh();
    const d = app.drafts.create('mcp', taskDraft());
    app.drafts.discard(d.id);
    expect(app.drafts.listPending()).toHaveLength(0);
    expect(() => app.drafts.confirm(d.id)).toThrow();
  });

  it('节点草稿：追加到已有任务', () => {
    const app = fresh();
    const t = app.createTask({ name: '已有任务', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    app.tasks.addNode(t.id, { title: '已有节点', description: '', startUtc: null, endUtc: null });
    const d = app.drafts.create('api', {
      type: 'nodes',
      taskId: t.id,
      nodes: [{ title: '新节点A', description: '', startUtc: null, endUtc: null }],
      warnings: []
    });
    const r = app.drafts.confirm(d.id);
    expect(r.type).toBe('nodes');
    const detail = app.tasks.getTaskDetail(t.id);
    expect(detail.nodes.map((n) => n.title)).toEqual(['已有节点', '新节点A']);
  });

  it('非法草稿被拒绝（任务名校验、节点校验）', () => {
    const app = fresh();
    const badName: TaskDraftPayload = { ...taskDraft(), taskInput: { ...taskDraft().taskInput, name: '  ' } };
    expect(() => app.drafts.create('mcp', badName)).toThrow();
    expect(() =>
      app.drafts.create('mcp', {
        ...taskDraft(),
        nodes: [{ title: '', description: '', startUtc: null, endUtc: null }]
      })
    ).toThrow();
  });

  it('杂事任务不接受节点草稿', () => {
    const app = fresh();
    const m = app.createTask({ name: '杂事', description: '', kind: 'misc', urgency: 'low', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    expect(() =>
      app.drafts.create('api', { type: 'nodes', taskId: m.id, nodes: [{ title: 'x', description: '', startUtc: null, endUtc: null }], warnings: [] })
    ).toThrow();
  });
});
