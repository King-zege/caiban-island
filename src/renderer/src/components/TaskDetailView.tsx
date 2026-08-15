import { useState } from 'react';
import type { TaskDetail } from '../../../shared/types';
import { useTaskStore } from '../state/useStore';
import Timeline from './Timeline';
import { formatDeadline } from './TaskCard';

const URGENCY_LABEL: Record<string, string> = { critical: '紧急', high: '高', normal: '普通', low: '低' };

export default function TaskDetailView({ detail, onBack }: { detail: TaskDetail; onBack: () => void }): React.JSX.Element {
  const setNodeStatus = useTaskStore((s) => s.setNodeStatus);
  const complete = useTaskStore((s) => s.complete);
  const cancel = useTaskStore((s) => s.cancel);
  const removeLink = useTaskStore((s) => s.removeLink);
  const openDetail = useTaskStore((s) => s.openDetail);
  const [confirm, setConfirm] = useState<'none' | 'complete' | 'cancel'>('none');
  const { task, nodes, links, note } = detail;

  const deadline = formatDeadline(task.deadlineUtc, task.tzId);
  const a11yDeadline = task.deadlineUtc ? deadline : '未设置';

  const doComplete = async () => {
    const err = await complete(task.id);
    if (!err) onBack();
    else setConfirm('none');
  };
  const doCancel = async () => {
    const err = await cancel(task.id);
    if (!err) onBack();
    else setConfirm('none');
  };

  return (
    <div className="detail-view">
      <header className="detail-header">
        <button className="btn icon-btn" aria-label="返回卡片列表" onClick={onBack}>
          ←
        </button>
        <div className="detail-title-wrap">
          <h2 className="detail-title">{task.name}</h2>
          <div className="detail-meta">
            <span className={'chip urgency-' + task.urgency}>{URGENCY_LABEL[task.urgency]}</span>
            <span className="chip deadline">{a11yDeadline}</span>
            {task.kind === 'misc' && <span className="chip kind-misc">杂事</span>}
          </div>
        </div>
        <button className="btn" onClick={() => void openDetail(task.id).then(() => void window.api.setLevel('l3'))}>
          详细编辑
        </button>
      </header>

      <div className="detail-section">
        <h3 className="section-title">时间轴</h3>
        <Timeline nodes={nodes} onStatus={(id, s) => void setNodeStatus(id, s)} />
      </div>

      <div className="detail-section">
        <h3 className="section-title">链接（{links.length}）</h3>
        {links.length === 0 ? (
          <p className="detail-empty">暂无链接</p>
        ) : (
          <ul className="link-list">
            {links.map((l) => (
              <li key={l.id} className="link-row">
                <span className={'link-kind ' + l.kind}>{l.kind === 'url' ? '🔗' : '📄'}</span>
                <button
                  className="link-title"
                  title={l.target}
                  onClick={() => (l.kind === 'url' ? void window.api.openUrl(l.target) : void window.api.openPath(l.target))}
                >
                  {l.title}
                </button>
                <button className="link-action" onClick={() => (l.kind === 'file' ? void window.api.showInFolder(l.target) : undefined)}>
                  {l.kind === 'file' ? '定位' : ''}
                </button>
                <button className="link-action danger" onClick={() => void removeLink(l.id)}>
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {note.trim().length > 0 && (
        <div className="detail-section">
          <h3 className="section-title">备注</h3>
          <p className="note-preview">{note.length > 120 ? note.slice(0, 120) + '…' : note}</p>
        </div>
      )}

      <div className="detail-actions">
        {confirm === 'none' ? (
          <>
            <button className="btn primary" onClick={() => setConfirm('complete')}>
              完成任务
            </button>
            <button className="btn danger-outline" onClick={() => setConfirm('cancel')}>
              取消任务
            </button>
          </>
        ) : (
          <span className="confirm-row">
            <span className="confirm-text">{confirm === 'complete' ? '确认完成？' : '确认取消？'}（完成/取消将归档并保留全部记录）</span>
            <button className="btn primary" onClick={() => void (confirm === 'complete' ? doComplete() : doCancel())}>
              确认
            </button>
            <button className="btn" onClick={() => setConfirm('none')}>
              返回
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
