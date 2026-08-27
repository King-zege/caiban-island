import { Bell, BellOff, Check, Clock3 } from 'lucide-react';
import type { TaskCard } from '../../../shared/types';
import { formatUtcInTimeZone } from '../../../shared/time';

function reminderLabel(value: string | null, timeZone: string): string | null {
  if (!value) return null;
  try {
    const target = new Date(value);
    const date = new Intl.DateTimeFormat('zh-CN', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const time = new Intl.DateTimeFormat('zh-CN', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
    if (date.format(target) === date.format(new Date())) return '今天 ' + time.format(target);
  } catch {
    // 交给通用格式化函数处理无效时区与旧数据。
  }
  return formatUtcInTimeZone(value, timeZone);
}

interface MiscStickerProps {
  card: TaskCard;
  tabIndex: number;
  completing: boolean;
  onFocus: () => void;
  onOpen: () => void;
  onComplete: () => void;
}

export default function MiscSticker({ card, tabIndex, completing, onFocus, onOpen, onComplete }: MiscStickerProps): React.JSX.Element {
  const reminder = card.miscReminder;
  const formatted = reminderLabel(reminder?.fireAtUtc ?? null, card.task.tzId);
  const status = reminder?.state === 'fired'
    ? '已提醒'
    : reminder?.state === 'legacy_deadline'
      ? '旧时间待处理'
      : formatted ?? '无提醒';
  const StatusIcon = reminder?.state === 'fired'
    ? Bell
    : reminder?.state === 'legacy_deadline' || reminder?.state === 'none'
      ? BellOff
      : Clock3;

  return (
    <article className={'misc-sticker misc-reminder-' + (reminder?.state ?? 'none')}>
      <button
        type="button"
        className="misc-sticker-open"
        data-carousel-card="true"
        tabIndex={tabIndex}
        aria-label={'打开杂事「' + card.task.name + '」，' + status}
        onFocus={onFocus}
        onClick={onOpen}
      >
        <strong>{card.task.name}</strong>
        <span><StatusIcon aria-hidden="true" size={15} /><time dateTime={reminder?.fireAtUtc ?? undefined}>{status}</time></span>
      </button>
      <button
        type="button"
        className="misc-sticker-complete"
        data-carousel-no-drag="true"
        aria-label={(completing ? '正在完成杂事「' : '完成杂事「') + card.task.name + '」'}
        title={completing ? '正在完成' : '完成杂事'}
        disabled={completing}
        onClick={(event) => { event.stopPropagation(); onComplete(); }}
      >
        <Check aria-hidden="true" size={18} />
      </button>
    </article>
  );
}
