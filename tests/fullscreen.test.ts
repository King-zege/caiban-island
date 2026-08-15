import { describe, expect, it } from 'vitest';
import { coversDisplay } from '../src/shared/fullscreen';

const display = { left: 0, top: 0, right: 2560, bottom: 1600 };

describe('coversDisplay（FR-018）', () => {
  it('真正全屏（覆盖整个显示器）→ true', () => {
    expect(coversDisplay({ left: 0, top: 0, right: 2560, bottom: 1600 }, display)).toBe(true);
    expect(coversDisplay({ left: -7, top: -7, right: 2567, bottom: 1607 }, display)).toBe(true);
  });
  it('普通最大化窗口（不覆盖任务栏区域）→ false', () => {
    // 任务栏在底部：最大化窗口 bottom 到工作区底部（物理 1528），距显示器底 72px
    expect(coversDisplay({ left: 0, top: 0, right: 2560, bottom: 1528 }, display)).toBe(false);
  });
  it('小窗口 → false', () => {
    expect(coversDisplay({ left: 100, top: 100, right: 1100, bottom: 900 }, display)).toBe(false);
  });
});
