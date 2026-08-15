import { useEffect, useState } from 'react';
import type { ArchivedDetail, ArchivedItem } from '../../../shared/types';
import { useTaskStore } from '../state/useStore';
import { formatDeadline } from './TaskCard';

const URGENCY_LABEL: Record<string, string> = { critical: '紧急', high: '高', normal: '普通', low: '低' };

export default function ArchiveView(): React.JSX.Element {
  const loadTasks = useTaskStore((s) => s.load);
  const [items, setItems] = useState<ArchivedItem[]>([]);
  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<ArchivedDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const refresh = async (q: string, oc?: string) => {
    const r = q.trim().length === 0 ? await window.api.listArchive() : await window.api.searchArchive(q, oc);
    if (r.ok) setItems(r.data);
  };

  useEffect(() => {
    void refresh('', outcome);
  }, [outcome]);

  const onQuery = (v: string) => {
    setQuery(v);
    if (searchTimer) clearTimeout(searchTimer);
    setSearchTimer(setTimeout(() => void refresh(v, outcome), 300));
  };

  const open = async (id: string) => {
    setError(null);
    const r = await window.api.getArchived(id);
    if (r.ok) setSelected(r.data);
    else setError(r.error);
  };

  const restore = async (id: string) => {
    const r = await window.api.restoreTask(id);
    if (r.ok) {
      setSelected(null);
      await refresh(query, outcome);
      await loadTasks();
    } else {
      setError(r.error);
    }
  };

  if (selected) {
    const { task, events } = selected;
    return (
      <div className="archive-detail">
        <button className="btn small" onClick={() => setSelected(null)}>
          ← 返回列表
        </button>
        <h3 className="archive-name">{task.task.name}</h3>
        <div className="detail-meta">
          <span className={'chip urgency-' + task.task.urgency}>{URGENCY_LABEL[task.task.urgency] ?? task.task.urgency}</span>
          <span className="chip deadline">{task.task.deadlineUtc ? formatDeadline(task.task.deadlineUtc, task.task.tzId) : '未设置'}</span>
          <span className="chip kind-misc">{task.task.archiveOutcome === 'completed' ? '已完成' : '已取消'}</span>
          <span className="chip deadline">{task.task.archivedAt ? task.task.archivedAt.slice(0, 16).replace('T', ' ') : ''}</span>
        </div>
        {task.nodes.length > 0 && (
          <ul className="archive-nodes">
            {[...task.nodes]
              .sort((a, b) => a.position - b.position)
              .map((n) => (
                <li key={n.id} className={'node-line status-' + n.status}>
                  {n.title}
                </li>
              ))}
          </ul>
        )}
        {task.links.length > 0 && (
          <ul className="link-list">
            {task.links.map((l) => (
              <li key={l.id} className="link-row">
                <span className="link-kind">{l.kind === 'url' ? '🔗' : '📄'}</span>
                <span className="link-title">{l.title}</span>
              </li>
            ))}
          </ul>
        )}
        {task.note.trim() && <p className="note-preview">{task.note}</p>}
        {events.length > 0 && (
          <details className="archive-events">
            <summary>变更记录（{events.length}）</summary>
            <ul>
              {events.map((e, i) => (
                <li key={i} className="event-line">
                  {e.at.slice(0, 16).replace('T', ' ')} — {e.kind}
                </li>
              ))}
            </ul>
          </details>
        )}
        <button className="btn primary" onClick={() => void restore(task.task.id)}>
          恢复为活跃任务
        </button>
        {error && <p className="form-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="archive-view">
      <div className="archive-toolbar">
        <input
          className="text-input grow"
          placeholder="搜索归档任务…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
        <div className="chip-group">
          <button className={'chip-btn' + (!outcome ? ' active' : '')} onClick={() => setOutcome(undefined)}>
            全部
          </button>
          <button className={'chip-btn' + (outcome === 'completed' ? ' active' : '')} onClick={() => setOutcome('completed')}>
            已完成
          </button>
          <button className={'chip-btn' + (outcome === 'cancelled' ? ' active' : '')} onClick={() => setOutcome('cancelled')}>
            已取消
          </button>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="detail-empty">暂无归档记录</p>
      ) : (
        <ul className="archive-list">
          {items.map((it) => (
            <li key={it.id}>
              <button className="archive-item" onClick={() => void open(it.id)}>
                <span className="archive-item-name">{it.name}</span>
                <span className="chip kind-misc">{it.outcome === 'completed' ? '已完成' : '已取消'}</span>
                <span className="archive-item-date">{it.archivedAt.slice(0, 10)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
