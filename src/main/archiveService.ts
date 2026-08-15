import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { TaskDetail } from '../shared/taskContracts';

export interface ArchivedItem {
  id: string;
  name: string;
  kind: string;
  urgency: string;
  outcome: 'completed' | 'cancelled';
  archivedAt: string;
}

function safeName(name: string): string {
  // 去除 Windows 非法字符与控制字符
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  return (cleaned || '未命名任务').slice(0, 60);
}

// FR-070~075：完成/取消 → 归档 + 导出 task.json/task.md 快照；归档查询/恢复
export class ArchiveService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly dataDir: string
  ) {}

  archiveRoot(): string {
    return path.join(this.dataDir, 'archive');
  }

  private snapshotDir(detail: TaskDetail): string {
    const month = (detail.task.archivedAt ?? detail.task.updatedAtUtc).slice(0, 7);
    const base = path.join(this.archiveRoot(), month, safeName(detail.task.name));
    let dir = base;
    let n = 2;
    while (existsSync(dir)) {
      dir = base + '-' + n;
      n++;
    }
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  exportSnapshot(detail: TaskDetail): { dir: string; jsonPath: string; mdPath: string } {
    const dir = this.snapshotDir(detail);
    const task = detail.task;
    const now = new Date().toISOString();
    const jsonPath = path.join(dir, 'task.json');
    const mdPath = path.join(dir, 'task.md');

    const json = {
      format_version: 1,
      exported_at: now,
      app_version: '0.1.0',
      task,
      nodes: detail.nodes,
      links: detail.links,
      note: detail.note
    };
    writeFileSync(jsonPath, JSON.stringify(json, null, 2), 'utf8');

    const statusLabel: Record<string, string> = { pending: '待完成', in_progress: '进行中', completed: '已完成' };
    const urgencyLabel: Record<string, string> = { critical: '紧急', high: '高', normal: '普通', low: '低' };
    const lines: string[] = [
      '# ' + task.name,
      '',
      '- 类型：' + (task.kind === 'misc' ? '杂事' : '任务'),
      '- 紧急程度：' + (urgencyLabel[task.urgency] ?? task.urgency),
      '- 截止时间：' + (task.deadlineUtc ?? '未设置'),
      '- 归档时间：' + (task.archivedAt ?? now),
      task.description ? '- 说明：' + task.description : '',
      '',
      '## 节点',
      ''
    ];
    const ordered = [...detail.nodes].sort((a, b) => a.position - b.position);
    if (ordered.length === 0) lines.push('（无节点）');
    for (const n of ordered) {
      const dates = [n.startUtc, n.endUtc].filter(Boolean).join(' ~ ');
      lines.push('- [' + (statusLabel[n.status] ?? n.status) + '] ' + n.title + (dates ? '（' + dates + '）' : ''));
    }
    lines.push('', '## 链接', '');
    if (detail.links.length === 0) lines.push('（无链接）');
    for (const l of detail.links) {
      lines.push('- ' + (l.kind === 'url' ? '网页' : '文件') + '：' + l.title + ' → ' + l.target);
    }
    lines.push('', '## 备注', '', detail.note.trim() || '（空）');
    writeFileSync(mdPath, lines.join('\n'), 'utf8');

    return { dir, jsonPath, mdPath };
  }

  listArchived(): ArchivedItem[] {
    const rows = this.db
      .prepare("SELECT id, name, kind, urgency, archive_outcome AS outcome, archived_at AS archivedAt FROM tasks WHERE status = 'archived' ORDER BY archived_at DESC")
      .all() as unknown as ArchivedItem[];
    return rows;
  }

  searchArchived(query: string, outcome?: string): ArchivedItem[] {
    const q = '%' + query.trim() + '%';
    const params: string[] = [];
    let sql =
      "SELECT id, name, kind, urgency, archive_outcome AS outcome, archived_at AS archivedAt FROM tasks WHERE status = 'archived' AND (name LIKE ? OR description LIKE ?)";
    params.push(q, q);
    if (outcome) {
      sql += ' AND archive_outcome = ?';
      params.push(outcome);
    }
    sql += ' ORDER BY archived_at DESC';
    return this.db.prepare(sql).all(...params) as unknown as ArchivedItem[];
  }

  restoreTask(id: string): void {
    const row = this.db.prepare("SELECT id FROM tasks WHERE id = ? AND status = 'archived'").get(id) as { id: string } | undefined;
    if (!row) throw new Error('归档任务不存在');
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE tasks SET status = 'active', archived_at = NULL, archive_outcome = NULL, updated_at = ? WHERE id = ?")
      .run(now, id);
  }

  getArchivedDetail(id: string): { task: TaskDetail; events: Array<{ at: string; kind: string; detail: string }> } {
    const events = this.db
      .prepare('SELECT at_utc AS at, kind, detail FROM change_events WHERE task_id = ? ORDER BY id')
      .all(id) as unknown as Array<{ at: string; kind: string; detail: string }>;
    const taskRow = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!taskRow) throw new Error('任务不存在');
    const toTask = (row: Record<string, unknown>): TaskDetail['task'] => ({
      id: String(row.id),
      name: String(row.name),
      description: String(row.description),
      kind: String(row.kind) as TaskDetail['task']['kind'],
      urgency: String(row.urgency) as TaskDetail['task']['urgency'],
      deadlineUtc: row.deadline_utc === null ? null : String(row.deadline_utc),
      tzId: String(row.tz_id),
      status: String(row.status) as TaskDetail['task']['status'],
      createdAtUtc: String(row.created_at),
      updatedAtUtc: String(row.updated_at),
      archivedAt: row.archived_at === null ? null : String(row.archived_at),
      archiveOutcome: row.archive_outcome === null ? null : (String(row.archive_outcome) as TaskDetail['task']['archiveOutcome'])
    });
    const nodes = this.db.prepare('SELECT * FROM nodes WHERE task_id = ? ORDER BY position').all(id) as unknown as Record<string, unknown>[];
    const links = this.db.prepare('SELECT * FROM links WHERE task_id = ? ORDER BY rowid').all(id) as unknown as Record<string, unknown>[];
    const note = this.db.prepare('SELECT body FROM notes WHERE task_id = ?').get(id) as { body: string } | undefined;
    const detail: TaskDetail = {
      task: toTask(taskRow),
      nodes: nodes.map((r) => ({
        id: String(r.id),
        taskId: String(r.task_id),
        title: String(r.title),
        description: String(r.description),
        startUtc: r.start_utc === null ? null : String(r.start_utc),
        endUtc: r.end_utc === null ? null : String(r.end_utc),
        status: String(r.status) as TaskDetail['nodes'][number]['status'],
        position: Number(r.position)
      })),
      links: links.map((r) => ({
        id: String(r.id),
        taskId: String(r.task_id),
        kind: String(r.kind) as TaskDetail['links'][number]['kind'],
        title: String(r.title),
        target: String(r.target),
        meta: String(r.meta)
      })),
      note: note ? note.body : ''
    };
    return { task: detail, events };
  }
}
