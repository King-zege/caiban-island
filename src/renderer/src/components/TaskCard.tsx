import type { TaskCard as TaskCardData } from '../../../shared/types';

const URGENCY_LABEL: Record<string, string> = { critical: '紧急', high: '高', normal: '普通', low: '低' };

export function formatDeadline(deadlineUtc: string | null, tzId: string): string {
  if (!deadlineUtc) return '未设置';
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

export default function TaskCard({ card }: { card: TaskCardData }): React.JSX.Element {
  const { task, progress, overdue } = card;
  const misc = task.kind === 'misc';
  const progressText = progress.total === 0 ? '尚未拆分' : progress.done + '/' + progress.total;
  const nextTitle = progress.nextTitle ?? '';

  const a11y = [
    task.name,
    '紧急程度：' + (URGENCY_LABEL[task.urgency] ?? task.urgency),
    task.deadlineUtc ? '截止：' + formatDeadline(task.deadlineUtc, task.tzId) : '未设置截止时间',
    overdue ? '已逾期' : '',
    misc ? '杂事' : progressText + (nextTitle ? '，下一节点：' + nextTitle : '')
  ]
    .filter(Boolean)
    .join('，');

  return (
    <article className={'task-card' + (overdue ? ' overdue' : '')} aria-label={a11y}>
      <div className="card-top">
        <span className={'chip urgency-' + task.urgency}>
          {URGENCY_LABEL[task.urgency] ?? task.urgency}
        </span>
        <span className={'chip ' + (overdue ? 'deadline-overdue' : 'deadline')}>
          {overdue ? '已逾期 · ' : ''}
          {formatDeadline(task.deadlineUtc, task.tzId)}
        </span>
      </div>
      <h3 className="card-title" title={task.name}>
        {task.name}
      </h3>
      {misc ? (
        <div className="card-misc">
          <span className="chip kind-misc">杂事</span>
        </div>
      ) : (
        <>
          <p className="card-next" title={nextTitle}>
            {nextTitle ? '下一步：' + nextTitle : '下一步：—'}
          </p>
          <div className="card-progress">
            <span className="progress-text">{progressText}</span>
            {progress.total > 0 && (
              <div className="progress-bar" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
                <div className="progress-fill" style={{ width: Math.round((progress.done / progress.total) * 100) + '%' }} />
              </div>
            )}
          </div>
        </>
      )}
    </article>
  );
}
