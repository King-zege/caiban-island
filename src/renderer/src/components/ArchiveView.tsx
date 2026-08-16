import { Archive, ArrowLeft, Download, File, Link2, RotateCcw, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ArchivedDetail, ArchivedItem } from '../../../shared/types';
import { useTaskStore } from '../state/useStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import { formatDeadline } from './TaskCard';
import Timeline from './Timeline';
import { AsyncFeedback } from './ui/AsyncFeedback';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { EmptyState } from './ui/EmptyState';
import { ExternalTargetDialog } from './ui/ExternalTargetDialog';
import type { ExternalTarget } from './ui/ExternalTargetDialog';

type OutcomeFilter = 'completed' | 'cancelled' | undefined;
const URGENCY_LABEL = { critical: '紧急', high: '高', normal: '普通', low: '低' } as const;

export default function ArchiveView(): React.JSX.Element {
  const loadTasks = useTaskStore((state) => state.load);
  const notify = useWorkspaceStore((state) => state.notify);
  const [items, setItems] = useState<ArchivedItem[]>([]);
  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState<OutcomeFilter>(undefined);
  const [selected, setSelected] = useState<ArchivedDetail | null>(null);
  const [externalTarget, setExternalTarget] = useState<ExternalTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = async (search: string, filter?: OutcomeFilter) => {
    setLoading(true);
    setError(null);
    const result = search.trim().length === 0 && !filter ? await window.api.listArchive() : await window.api.searchArchive(search, filter);
    setLoading(false);
    if (result.ok) setItems(result.data);
    else setError(result.error);
  };

  useEffect(() => {
    void refresh(query, outcome);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [outcome]);

  const onQuery = (value: string) => {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void refresh(value, outcome), 300);
  };

  const open = async (id: string) => {
    setLoading(true);
    setError(null);
    const result = await window.api.getArchived(id);
    setLoading(false);
    if (result.ok) setSelected(result.data);
    else setError(result.error);
  };

  const restore = async () => {
    if (!selected) return;
    setBusy(true);
    const result = await window.api.restoreTask(selected.task.task.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRestoreOpen(false);
    setSelected(null);
    await refresh(query, outcome);
    await loadTasks();
    notify('任务已恢复到活跃列表', 'success');
  };

  const exportArchive = async () => {
    setBusy(true);
    setError(null);
    const result = await window.api.exportArchivedCsv();
    setBusy(false);
    if (result.ok) notify('归档 CSV 已导出', 'success');
    else setError(result.error);
  };

  if (selected) {
    const { task, events } = selected;
    return (
      <div className="archive-detail">
        <div className="detail-back-row"><Button icon={ArrowLeft} variant="ghost" onClick={() => setSelected(null)}>返回归档</Button></div>
        <div className="standalone-heading">
          <div><span className="eyebrow">归档任务</span><h1>{task.task.name}</h1><p>{task.task.archiveOutcome === 'completed' ? '已完成' : '已取消'}于 {task.task.archivedAt ? task.task.archivedAt.slice(0, 16).replace('T', ' ') : '未知时间'}</p></div>
          <Button icon={RotateCcw} variant="primary" onClick={() => setRestoreOpen(true)}>恢复任务</Button>
        </div>
        <div className="archive-facts">
          <div><span>紧急程度</span><strong>{URGENCY_LABEL[task.task.urgency]}</strong></div>
          <div><span>截止时间</span><strong>{task.task.deadlineUtc ? formatDeadline(task.task.deadlineUtc, task.task.tzId) : '未设置'}</strong></div>
          <div><span>资料</span><strong>{task.links.length} 项</strong></div>
        </div>
        <section className="archive-section"><div className="section-heading"><div><span className="eyebrow">采购链路</span><h2>归档时的节点状态</h2></div></div><Timeline nodes={task.nodes} /></section>
        {task.links.length > 0 && (
          <section className="archive-section">
            <div className="section-heading"><div><span className="eyebrow">资料</span><h2>归档时的关联目标</h2></div></div>
            <ul className="material-list">
              {task.links.map((link) => {
                const Icon = link.kind === 'url' ? Link2 : File;
                return <li key={link.id}><Icon aria-hidden="true" size={18} /><button className="material-link" onClick={() => setExternalTarget({ kind: link.kind, target: link.target, title: link.title })}><strong>{link.title}</strong><span>{link.target}</span></button></li>;
              })}
            </ul>
          </section>
        )}
        {task.note.trim() && <section className="archive-section"><div className="section-heading"><div><span className="eyebrow">备注</span><h2>归档时的记录</h2></div></div><pre className="archive-note">{task.note}</pre></section>}
        {events.length > 0 && (
          <details className="archive-events"><summary>查看 {events.length} 条变更记录</summary><ol>{events.map((event, index) => <li key={index}><time>{event.at.slice(0, 16).replace('T', ' ')}</time><span>{event.kind}</span></li>)}</ol></details>
        )}
        {error && <AsyncFeedback tone="error" message={error} onRetry={() => void open(task.task.id)} />}
        <Dialog open={restoreOpen} title="恢复这项任务？" description="它会重新出现在活跃任务列表中。" onClose={() => setRestoreOpen(false)} actions={<><Button variant="ghost" onClick={() => setRestoreOpen(false)}>取消</Button><Button icon={RotateCcw} variant="primary" disabled={busy} onClick={() => void restore()}>{busy ? '正在恢复' : '确认恢复'}</Button></>}><p>归档中的节点、资料与备注会一并恢复。</p></Dialog>
        <ExternalTargetDialog target={externalTarget} onClose={() => setExternalTarget(null)} />
      </div>
    );
  }

  return (
    <div className="archive-view">
      <div className="standalone-heading">
        <div><span className="eyebrow">归档</span><h1>已结束的采购任务</h1><p>查找历史结果，需要时恢复到活跃列表。</p></div>
        <Button icon={Download} disabled={busy} onClick={() => void exportArchive()}>{busy ? '正在导出' : '导出 CSV'}</Button>
      </div>
      <div className="archive-toolbar">
        <label className="archive-search"><Search aria-hidden="true" size={18} /><input placeholder="搜索归档任务" value={query} onChange={(event) => onQuery(event.target.value)} /></label>
        <div className="segmented-control" role="group" aria-label="归档结果筛选">
          <button type="button" className={!outcome ? 'active' : ''} aria-pressed={!outcome} onClick={() => setOutcome(undefined)}>全部</button>
          <button type="button" className={outcome === 'completed' ? 'active' : ''} aria-pressed={outcome === 'completed'} onClick={() => setOutcome('completed')}>已完成</button>
          <button type="button" className={outcome === 'cancelled' ? 'active' : ''} aria-pressed={outcome === 'cancelled'} onClick={() => setOutcome('cancelled')}>已取消</button>
        </div>
      </div>
      {error && <AsyncFeedback tone="error" message={error} onRetry={() => void refresh(query, outcome)} />}
      {loading ? <p className="loading-state section-loading">正在读取归档</p> : items.length === 0 ? (
        <EmptyState icon={Archive} title={query || outcome ? '没有匹配的归档' : '还没有归档任务'} description={query || outcome ? '调整关键词或筛选条件后重试。' : '完成或取消的任务会保存在这里。'} />
      ) : (
        <ul className="archive-list">
          {items.map((item) => (
            <li key={item.id}><button className="archive-item" onClick={() => void open(item.id)}><span className={'archive-outcome ' + item.outcome}>{item.outcome === 'completed' ? '已完成' : '已取消'}</span><strong>{item.name}</strong><time>{item.archivedAt.slice(0, 10)}</time></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
