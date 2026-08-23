import { describe, expect, it } from 'vitest';
import { dateTimeLocalToUtc, formatUtcInTimeZone, utcToDateTimeLocal } from '../src/shared/time';

describe('节点时间时区换算', () => {
  it('按任务时区把本地输入转换为 UTC 并可往返', () => {
    const utc = dateTimeLocalToUtc('2026-08-23T14:30', 'Asia/Shanghai');
    expect(utc).toBe('2026-08-23T06:30:00.000Z');
    expect(utcToDateTimeLocal(utc, 'Asia/Shanghai')).toBe('2026-08-23T14:30');
    expect(formatUtcInTimeZone(utc, 'Asia/Shanghai')).toContain('14:30');
  });

  it('拒绝无效时区和夏令时跳过的墙上时间', () => {
    expect(dateTimeLocalToUtc('2026-08-23T14:30', 'Invalid/Zone')).toBeNull();
    expect(dateTimeLocalToUtc('2026-03-08T02:30', 'America/New_York')).toBeNull();
  });
});
