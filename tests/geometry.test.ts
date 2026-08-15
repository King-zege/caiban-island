import { describe, expect, it } from 'vitest';
import { computeL1Bounds, computeL2Bounds, computeL3Bounds, isInHotZone, ISLAND } from '../src/shared/geometry';
import type { DisplayInfo } from '../src/shared/types';

const display: DisplayInfo = {
  x: 0, y: 0, width: 1920, height: 1080,
  workArea: { x: 0, y: 0, width: 1920, height: 1040 }
};

describe('computeL1Bounds', () => {
  it('居中于主屏顶部中央，向上偏移 2px', () => {
    const b = computeL1Bounds(display);
    expect(b.width).toBe(ISLAND.L1_WIDTH);
    expect(b.height).toBe(ISLAND.L1_HEIGHT);
    expect(b.x).toBe(912);
    expect(b.y).toBe(-2);
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
