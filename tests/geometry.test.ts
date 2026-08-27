import { describe, expect, it } from 'vitest';
import { computeL1Bounds, computeL2Bounds, computeL3Bounds, isInHotZone, ISLAND } from '../src/shared/geometry';
import type { DisplayInfo } from '../src/shared/types';

const display: DisplayInfo = {
  x: 0, y: 0, width: 1920, height: 1080,
  workArea: { x: 0, y: 0, width: 1920, height: 1040 }
};

describe('computeL1Bounds', () => {
  it('使用 Windows 安全最小高度，并只让底部 4px 进入工作区', () => {
    const b = computeL1Bounds(display);
    expect(b.width).toBe(ISLAND.L1_WIDTH);
    expect(b.height).toBe(ISLAND.L1_NATIVE_HEIGHT);
    expect(b.x).toBe(912);
    expect(b.y).toBe(-31);
    expect(b.y + b.height - display.y).toBe(ISLAND.L1_VISIBLE_HEIGHT);
  });

  it('接受更高的 DPI/原生最小高度但可见区保持不变', () => {
    const b = computeL1Bounds(display, 53);
    expect(b.height).toBe(53);
    expect(b.y + b.height - display.y).toBe(ISLAND.L1_VISIBLE_HEIGHT);
  });
});

describe('computeL2Bounds', () => {
  it('默认 760×280 水平居中', () => {
    const b = computeL2Bounds(display);
    expect(b).toMatchObject({ width: 760, height: 280, x: 580, y: 0 });
  });
  it('窄屏时收窄且不超屏', () => {
    const small: DisplayInfo = { x: 0, y: 0, width: 800, height: 600, workArea: { x: 0, y: 0, width: 800, height: 560 } };
    const b = computeL2Bounds(small);
    expect(b.width).toBe(640);
    expect(b.width).toBeLessThanOrEqual(800);
  });
  it('detail 模式加高（速览/表单态）', () => {
    const b = computeL2Bounds(display, true);
    expect(b.height).toBe(ISLAND.L2_HEIGHT_DETAIL);
    expect(b.width).toBe(760);
  });
  it('按 L2 内容模式一次计算项目、杂事与混合高度', () => {
    expect(computeL2Bounds(display, false, 'empty').height).toBe(280);
    expect(computeL2Bounds(display, false, 'project').height).toBe(280);
    expect(computeL2Bounds(display, false, 'misc').height).toBe(196);
    expect(computeL2Bounds(display, false, 'mixed').height).toBe(376);
    expect(computeL2Bounds(display, true, 'misc').height).toBe(480);
  });
  it('任务栏在顶部时贴工作区顶边', () => {
    const d: DisplayInfo = { x: 0, y: 0, width: 1920, height: 1080, workArea: { x: 0, y: 32, width: 1920, height: 1048 } };
    const b = computeL2Bounds(d);
    expect(b.y).toBe(32);
  });
});

describe('computeL3Bounds', () => {
  it('最大 85% 工作区且居中', () => {
    const b = computeL3Bounds(display);
    expect(b.width).toBe(Math.floor(1920 * 0.85));
    expect(b.height).toBe(Math.floor(1080 * 0.85));
    expect(b.x).toBe(Math.round((1920 - b.width) / 2));
    expect(b.y).toBeGreaterThanOrEqual(0);
  });
});

describe('isInHotZone', () => {
  it('顶边中央命中，超出宽度或深度不命中', () => {
    expect(isInHotZone(960, 3, display)).toBe(true);
    expect(isInHotZone(960, 15, display)).toBe(false);
    expect(isInHotZone(800, 3, display)).toBe(false);
  });
});
