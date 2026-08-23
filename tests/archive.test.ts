import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/main/db';
import { AppService } from '../src/main/appService';
import { APP_VERSION } from '../src/shared/appVersion';

const dirs: string[] = [];
function fresh(): AppService {
  const dir = mkdtempSync(path.join(tmpdir(), 'caiban-archive-'));
  dirs.push(dir);
  const db = openDatabase(path.join(dir, 'island.db'));
  return new AppService(db, dir);
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
});

describe('归档与快照（FR-070~075）', () => {
  it('完成任务 → 归档 + 导出 task.json/task.md 快照', () => {
    const app = fresh();
    const t = app.createTask({ name: '采购任务', description: '说明', kind: 'task', urgency: 'high', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    app.tasks.addNode(t.id, { title: '询价', description: '', startUtc: null, endUtc: null });
    app.tasks.saveNote(t.id, '备注内容');
    app.tasks.addLink(t.id, { kind: 'url', title: '官网', target: 'https://example.com' });
    app.completeTask(t.id);

    const items = app.archive.listArchived();
    expect(items).toHaveLength(1);
    expect(items[0].outcome).toBe('completed');
    expect(items[0].name).toBe('采购任务');

    const dir = path.join(app.archive.archiveRoot(), items[0].archivedAt.slice(0, 7), '采购任务');
    expect(existsSync(path.join(dir, 'task.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'task.md'))).toBe(true);
    const json = JSON.parse(readFileSync(path.join(dir, 'task.json'), 'utf8'));
    expect(json.format_version).toBe(1);
    expect(json.app_version).toBe(APP_VERSION);
    expect(json.task.name).toBe('采购任务');
    expect(json.nodes).toHaveLength(1);
    expect(json.links).toHaveLength(1);
    expect(json.note).toBe('备注内容');
    const md = readFileSync(path.join(dir, 'task.md'), 'utf8');
    expect(md).toContain('# 采购任务');
    expect(md).toContain('[待完成] 询价');
    expect(md).toContain('https://example.com');
  });

  it('同名快照自动加序号，不静默覆盖', () => {
    const app = fresh();
    const t1 = app.createTask({ name: '同名任务', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    app.cancelTask(t1.id);
    const t2 = app.createTask({ name: '同名任务', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    app.cancelTask(t2.id);
    const month = t1.updatedAtUtc.slice(0, 7);
    expect(existsSync(path.join(app.archive.archiveRoot(), month, '同名任务'))).toBe(true);
    expect(existsSync(path.join(app.archive.archiveRoot(), month, '同名任务-2'))).toBe(true);
  });

  it('归档搜索与恢复往返', () => {
    const app = fresh();
    const t = app.createTask({ name: '搜索目标任务', description: '', kind: 'task', urgency: 'low', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    app.cancelTask(t.id);
    const found = app.archive.searchArchived('搜索目标');
    expect(found).toHaveLength(1);
    const miss = app.archive.searchArchived('不存在');
    expect(miss).toHaveLength(0);
    app.restoreTask(t.id);
    expect(app.tasks.getTask(t.id)?.status).toBe('active');
    expect(app.archive.listArchived()).toHaveLength(0);
  });

  it('归档详情含变更事件', () => {
    const app = fresh();
    const t = app.createTask({ name: '事件任务', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    app.completeTask(t.id);
    const detail = app.archive.getArchivedDetail(t.id);
    expect(detail.events.some((e) => e.kind === 'task_created')).toBe(true);
    expect(detail.events.some((e) => e.kind === 'task_archived')).toBe(true);
    expect(detail.task.task.name).toBe('事件任务');
  });
});
