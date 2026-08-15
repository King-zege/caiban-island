import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/main/db';
import { TaskError, TaskService } from '../src/main/taskService';

const dirs: string[] = [];
function fresh(): TaskService {
  const dir = mkdtempSync(path.join(tmpdir(), 'caiban-links-'));
  dirs.push(dir);
  const db = openDatabase(path.join(dir, 'island.db'));
  return new TaskService(db);
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
});

describe('链接与备注（FR-050~054）', () => {
  it('URL 链接仅允许 http/https', () => {
    const svc = fresh();
    const t = svc.createTask({ name: 't', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    const l = svc.addLink(t.id, { kind: 'url', title: '供应商官网', target: 'https://example.com' });
    expect(l.kind).toBe('url');
    expect(() => svc.addLink(t.id, { kind: 'url', title: 'x', target: 'javascript:alert(1)' })).toThrow(TaskError);
    expect(() => svc.addLink(t.id, { kind: 'url', title: 'x', target: 'file:///c:/x' })).toThrow(TaskError);
    const detail = svc.getTaskDetail(t.id);
    expect(detail.links).toHaveLength(1);
  });

  it('文件链接保存路径与元数据；删除链接', () => {
    const svc = fresh();
    const t = svc.createTask({ name: 't', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    const l = svc.addLink(t.id, { kind: 'file', title: '报价单', target: 'C:\\tmp\\quote.xlsx' });
    expect(l.kind).toBe('file');
    svc.removeLink(l.id);
    expect(svc.getTaskDetail(t.id).links).toHaveLength(0);
    expect(() => svc.removeLink(l.id)).toThrow(TaskError);
  });

  it('备注保存与读取往返（幂等）', () => {
    const svc = fresh();
    const t = svc.createTask({ name: 't', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    svc.saveNote(t.id, '第一版备注');
    svc.saveNote(t.id, '第二版备注');
    expect(svc.getTaskDetail(t.id).note).toBe('第二版备注');
  });
});
