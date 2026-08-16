import { ArrowDown, ChevronsUp, CircleDot, Clock3, ListChecks, TriangleAlert } from 'lucide-react';
import type { FocusEventHandler } from 'react';
import type { TaskCard as TaskCardData, Urgency } from '../../../shared/types';

const URGENCY_LABEL: Record<Urgency, string> = { critical: '紧急', high: '高', normal: '普通', low: '低' };
const URGENCY_ICON = {
  critical: TriangleAlert,
  high: ChevronsUp,
  normal: CircleDot,
  low: ArrowDown
} satisfies Record<Urgency, typeof TriangleAlert>;

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

interface TaskCardProps {
  card: TaskCardData;
  onOpen: () => void;
  tabIndex?: number;
  onFocus?: FocusEventHandler<HTMLButtonElement>;
}

export default function TaskCard({ card, onOpen, tabIndex = 0, onFocus }: TaskCardProps): React.JSX.Element {
  const { task, progress, overdue } = card;
  const misc = task.kind === 'misc';
  const progressText = progress.total === 0 ? '尚未拆分' : progress.done + '/' + progress.total + ' 个节点完成';
  const nextTitle = misc ? '处理这项杂事' : progress.nextTitle ?? (progress.total === 0 ? '拆分采购节点' : '所有节点已完成');
  const UrgencyIcon = URGENCY_ICON[task.urgency];
  const deadline = formatDeadline(task.deadlineUtc, task.tzId);
  const segmentCount = Math.min(Math.max(progress.total, 1), 6);

  const a11y = [
    task.name,
    '下一步：' + nextTitle,
    '紧急程度：' + URGENCY_LABEL[task.urgency],
    deadline,
    overdue ? '已逾期' : '',
    misc ? '杂事' : progressText
  ].filter(Boolean).join('，');

  return (
    <button
      type="button"
      className={'task-card urgency-' + task.urgency + (overdue ? ' overdue' : '')}
      aria-label={a11y}
      data-carousel-card="true"
      tabIndex={tabIndex}
      onFocus={onFocus}
      onClick={onOpen}
    >
      <span className="card-next-label">下一采购动作</span>
      <strong className="card-next" title={nextTitle}>{nextTitle}</strong>
      <span className="card-title" title={task.name}>{task.name}</span>
      <span className="card-meta">
        <span className={'urgency-label urgency-' + task.urgency}>
          <UrgencyIcon aria-hidden="true" size={14} strokeWidth={1.9} />
          {URGENCY_LABEL[task.urgency]}
        </span>
        <span className={overdue ? 'deadline-overdue' : 'deadline'}>
          <Clock3 aria-hidden="true" size={14} strokeWidth={1.8} />
          {overdue ? '已逾期 ' : ''}{deadline}
        </span>
      </span>
      {!misc && (
        <span className="card-trail-wrap">
          <span className="card-trail" aria-hidden="true">
            {Array.from({ length: segmentCount }, (_, index) => {
              const status = index < progress.done ? 'done' : index === progress.done && progress.done < progress.total ? 'current' : 'pending';
              return <span key={index} className={'trail-segment ' + status} />;
            })}
          </span>
          <span className="card-progress-text"><ListChecks aria-hidden="true" size={14} strokeWidth={1.8} />{progressText}</span>
        </span>
      )}
    </button>
  );
}
