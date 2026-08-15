import type { NodeStatus, TaskNode } from '../../../shared/types';

const STATUS_META: Record<NodeStatus, { label: string; cls: string }> = {
  pending: { label: '待完成', cls: 'status-pending' },
  in_progress: { label: '进行中', cls: 'status-in-progress' },
  completed: { label: '已完成', cls: 'status-completed' }
};

const CYCLE: NodeStatus[] = ['pending', 'in_progress', 'completed'];

interface TimelineProps {
  nodes: TaskNode[];
  onStatus: (nodeId: string, status: NodeStatus) => void;
  editable?: boolean;
}

export default function Timeline({ nodes, onStatus, editable = true }: TimelineProps): React.JSX.Element {
  if (nodes.length === 0) {
    return <p className="timeline-empty">尚未拆分节点 — 在「详细编辑」中用 AI 或手动添加</p>;
  }
  const ordered = [...nodes].sort((a, b) => a.position - b.position);
  return (
    <div className="timeline" aria-label="任务时间轴">
      {ordered.map((n, i) => {
        const meta = STATUS_META[n.status];
        const nextStatus = CYCLE[(CYCLE.indexOf(n.status) + 1) % 3];
        const next = STATUS_META[nextStatus];
        return (
          <div key={n.id} className="timeline-item">
            {i > 0 && <div className="timeline-connector" />}
            <button
              className={'timeline-chip ' + meta.cls}
              title={'当前：' + meta.label + '，点击切换为' + next.label}
              disabled={!editable}
              onClick={() => onStatus(n.id, nextStatus)}
            >
              <span className="chip-dot" />
              <span className="chip-text">
                <span className="chip-title">{n.title}</span>
                {n.startUtc || n.endUtc ? (
                  <span className="chip-dates">
                    {n.startUtc ? n.startUtc.slice(5, 16).replace('T', ' ') : ''}
                    {n.startUtc && n.endUtc ? ' ~ ' : ''}
                    {n.endUtc ? n.endUtc.slice(5, 16).replace('T', ' ') : ''}
                  </span>
                ) : null}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
