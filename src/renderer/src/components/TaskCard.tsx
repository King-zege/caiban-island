import {
  ArrowDown,
  Ban,
  Check,
  CheckCircle2,
  ChevronsUp,
  Circle,
  CircleDot,
  Clock3,
  ListChecks,
  MoreHorizontal,
  Play,
  Trash2,
  TriangleAlert
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { FocusEventHandler } from 'react';
import type { NodeStatus, TaskCard as TaskCardData, TaskCardNode, Urgency } from '../../../shared/types';

const URGENCY_LABEL: Record<Urgency, string> = { critical: '紧急', high: '高', normal: '普通', low: '低' };
const URGENCY_ICON = {
  critical: TriangleAlert,
  high: ChevronsUp,
  normal: CircleDot,
  low: ArrowDown
} satisfies Record<Urgency, typeof TriangleAlert>;

const NODE_STATUS_META = {
  pending: { label: '待完成', icon: Circle },
  in_progress: { label: '进行中', icon: Play },
  completed: { label: '已完成', icon: Check },
  cancelled: { label: '已取消', icon: Ban }
} satisfies Record<NodeStatus, { label: string; icon: typeof Circle }>;

export type TaskCardAction = 'complete' | 'cancel' | 'delete';

export function formatDeadline(deadlineUtc: string | null, tzId: string): string {
  if (!deadlineUtc) return '未设置截止时间';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tzId
    }).format(new Date(deadlineUtc));
  } catch {
    return deadlineUtc.slice(0, 10);
  }
}

export function formatOverdueDuration(deadlineUtc: string | null, now = Date.now()): string | null {
  if (!deadlineUtc) return null;
  const elapsed = now - Date.parse(deadlineUtc);
  if (!Number.isFinite(elapsed) || elapsed <= 0) return null;
  const hours = Math.max(1, Math.floor(elapsed / 3600000));
  if (hours < 24) return '已逾期 ' + hours + ' 小时';
  return '已逾期 ' + Math.floor(hours / 24) + ' 天';
}

export function visibleNodeWindow(nodes: TaskCardNode[], limit = 3): { nodes: TaskCardNode[]; currentId: string | null; hidden: number } {
  const ordered = [...nodes].sort((left, right) => left.position - right.position);
  if (ordered.length === 0) return { nodes: [], currentId: null, hidden: 0 };
  let currentIndex = ordered.findIndex((node) => node.status === 'in_progress');
  if (currentIndex < 0) currentIndex = ordered.findIndex((node) => node.status === 'pending');
  if (currentIndex < 0) currentIndex = ordered.length - 1;
  const safeLimit = Math.max(1, limit);
  const start = Math.max(0, Math.min(currentIndex - 1, ordered.length - safeLimit));
  return {
    nodes: ordered.slice(start, start + safeLimit),
    currentId: ordered[currentIndex]?.id ?? null,
    hidden: Math.max(0, ordered.length - safeLimit)
  };
}

interface TaskCardProps {
  card: TaskCardData;
  onOpen: () => void;
  onNodeStatus: (taskId: string, nodeId: string, status: NodeStatus) => Promise<void>;
  onTaskAction: (action: TaskCardAction) => void;
  tabIndex?: number;
  onFocus?: FocusEventHandler<HTMLButtonElement>;
}

export default function TaskCard({ card, onOpen, onNodeStatus, onTaskAction, tabIndex = 0, onFocus }: TaskCardProps): React.JSX.Element {
  const { task, progress, nodes, overdue } = card;
  const misc = task.kind === 'misc';
  const [busyNodeId, setBusyNodeId] = useState<string | null>(null);
  const nodeWindow = useMemo(() => visibleNodeWindow(nodes), [nodes]);
  const progressText = progress.total === 0
    ? nodes.length === 0 ? '尚未拆分' : '无有效节点'
    : progress.done + '/' + progress.total + ' 已完成';
  const nextTitle = misc
    ? '处理这项杂事'
    : progress.nextTitle ?? (progress.total === 0 ? '添加新的采购节点' : '采购链路已完成');
  const UrgencyIcon = URGENCY_ICON[task.urgency];
  const deadline = formatDeadline(task.deadlineUtc, task.tzId);
  const overdueDuration = overdue ? formatOverdueDuration(task.deadlineUtc) : null;

  const a11y = [
    task.name,
    '下一步：' + nextTitle,
    '紧急程度：' + URGENCY_LABEL[task.urgency],
    deadline,
    overdueDuration ?? '',
    misc ? '杂事' : progressText
  ].filter(Boolean).join('，');

  const changeNodeStatus = async (nodeId: string, status: NodeStatus) => {
    setBusyNodeId(nodeId);
    try {
      await onNodeStatus(task.id, nodeId, status);
    } finally {
      setBusyNodeId(null);
    }
  };

  const chooseTaskAction = (event: React.MouseEvent<HTMLButtonElement>, action: TaskCardAction) => {
    event.currentTarget.closest('details')?.removeAttribute('open');
    onTaskAction(action);
  };

  return (
    <article className={'task-card urgency-' + task.urgency + (overdue ? ' overdue' : '')}>
      <button
        type="button"
        className="task-card-open"
        aria-label={a11y}
        data-carousel-card="true"
        data-task-id={task.id}
        tabIndex={tabIndex}
        onFocus={onFocus}
        onClick={onOpen}
      >
        <strong className="card-title" title={task.name}>{task.name}</strong>
        <span className="card-next" title={nextTitle}><span>下一步</span>{nextTitle}</span>
        <span className="card-meta">
          <span className={'urgency-label urgency-' + task.urgency}>
            <UrgencyIcon aria-hidden="true" size={14} strokeWidth={1.9} />
            {URGENCY_LABEL[task.urgency]}
          </span>
          <span className={overdue ? 'deadline-overdue' : 'deadline'}>
            <Clock3 aria-hidden="true" size={14} strokeWidth={1.8} />
            {overdueDuration ? overdueDuration + ' · ' : ''}{deadline}
          </span>
        </span>
      </button>

      <details className="card-task-menu" data-carousel-no-drag="true">
        <summary aria-label={'管理任务：' + task.name} role="button" title="任务操作"><MoreHorizontal aria-hidden="true" size={18} /></summary>
        <div className="card-task-menu-popover">
          <button type="button" onClick={(event) => chooseTaskAction(event, 'complete')}><CheckCircle2 aria-hidden="true" size={16} />完成并归档</button>
          <button type="button" onClick={(event) => chooseTaskAction(event, 'cancel')}><Ban aria-hidden="true" size={16} />取消并归档</button>
          <button type="button" className="danger" onClick={(event) => chooseTaskAction(event, 'delete')}><Trash2 aria-hidden="true" size={16} />永久删除</button>
        </div>
      </details>

      {!misc && (
        <div className="card-node-block">
          <div className={'card-node-axis count-' + nodeWindow.nodes.length} aria-label="采购节点速览">
            {nodeWindow.nodes.map((node) => {
              const meta = NODE_STATUS_META[node.status];
              const StatusIcon = meta.icon;
              return (
                <label
                  key={node.id}
                  className={'card-node-control status-' + node.status + (node.id === nodeWindow.currentId ? ' current' : '')}
                  data-carousel-no-drag="true"
                  title={node.title + ' · ' + meta.label}
                >
                  <select
                    value={node.status}
                    aria-label={node.title + '的状态'}
                    disabled={busyNodeId === node.id}
                    onChange={(event) => void changeNodeStatus(node.id, event.target.value as NodeStatus)}
                  >
                    {(Object.keys(NODE_STATUS_META) as NodeStatus[]).map((status) => <option key={status} value={status}>{NODE_STATUS_META[status].label}</option>)}
                  </select>
                  <span className="card-node-marker"><StatusIcon aria-hidden="true" size={12} strokeWidth={2} /></span>
                  <span>{node.title}</span>
                </label>
              );
            })}
          </div>
          <span className="card-progress-text">
            <ListChecks aria-hidden="true" size={13} strokeWidth={1.8} />
            {progressText}{nodeWindow.hidden > 0 ? ' · 另 ' + nodeWindow.hidden + ' 项' : ''}
          </span>
        </div>
      )}
    </article>
  );
}
