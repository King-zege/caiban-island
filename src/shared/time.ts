interface DateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function partsInZone(date: Date, timeZone: string): DateTimeParts | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
    const values = new Map(formatter.formatToParts(date).map((part) => [part.type, part.value]));
    const result = {
      year: Number(values.get('year')),
      month: Number(values.get('month')),
      day: Number(values.get('day')),
      hour: Number(values.get('hour')),
      minute: Number(values.get('minute')),
      second: Number(values.get('second'))
    };
    return Object.values(result).every(Number.isFinite) ? result : null;
  } catch {
    return null;
  }
}

function sameMinute(left: DateTimeParts, right: DateTimeParts): boolean {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute;
}

export function utcToDateTimeLocal(value: string | null, timeZone: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = partsInZone(date, timeZone);
  if (!parts) return '';
  const two = (part: number): string => String(part).padStart(2, '0');
  return parts.year + '-' + two(parts.month) + '-' + two(parts.day) + 'T' + two(parts.hour) + ':' + two(parts.minute);
}

export function dateTimeLocalToUtc(value: string, timeZone: string): string | null {
  const match = LOCAL_INPUT.exec(value);
  if (!match) return null;
  const desired: DateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: 0
  };
  if (
    desired.month < 1 || desired.month > 12 || desired.day < 1 || desired.day > 31
    || desired.hour > 23 || desired.minute > 59
  ) return null;
  const wallTimeAsUtc = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute);
  let candidate = wallTimeAsUtc;
  for (let pass = 0; pass < 3; pass += 1) {
    const shown = partsInZone(new Date(candidate), timeZone);
    if (!shown) return null;
    const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second);
    const next = candidate + (wallTimeAsUtc - shownAsUtc);
    if (next === candidate) break;
    candidate = next;
  }
  const verified = partsInZone(new Date(candidate), timeZone);
  if (!verified || !sameMinute(verified, desired)) return null;
  return new Date(candidate).toISOString();
}

export function formatUtcInTimeZone(value: string | null, timeZone: string): string | null {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone
    }).format(new Date(value));
  } catch {
    return value.slice(0, 16).replace('T', ' ');
  }
}
