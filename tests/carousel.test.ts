import { describe, expect, it } from 'vitest';
import {
  cardIndexAt,
  clampOffset,
  computeMaxOffset,
  decayVelocity,
  snapOffset,
  snapOffsetWithVelocity
} from '../src/shared/carousel';

// 卡片 224 + 间距 12 = 步长 236
const p = { viewport: 472, item: 224, gap: 12, count: 6 };

describe('carousel 物理', () => {
  it('最大偏移 = 内容宽 - 视口宽', () => {
    expect(computeMaxOffset(p)).toBe(224 * 6 + 12 * 5 - 472);
  });
  it('偏移始终钳制在 [-max, 0]', () => {
    expect(clampOffset(100, p)).toBe(0);
    expect(clampOffset(-9999, p)).toBe(-computeMaxOffset(p));
  });
  it('吸附到最近卡片（步长 236）', () => {
    expect(snapOffset(-236, p)).toBe(-236);
    expect(snapOffset(-210, p)).toBe(-236);
    expect(snapOffset(-100, p)).toBe(0);
  });
  it('高速滑动翻页', () => {
    expect(snapOffsetWithVelocity(-100, 1200, p)).toBe(-236);
    expect(snapOffsetWithVelocity(-100, -1200, p)).toBe(0);
    expect(snapOffsetWithVelocity(-100, 100, p)).toBe(0);
  });
  it('速度衰减不反向', () => {
    expect(decayVelocity(1000, 100)).toBeGreaterThan(0);
    expect(decayVelocity(1000, 10000)).toBe(0);
  });
  it('cardIndexAt 无 -0', () => {
    expect(cardIndexAt(-224, p)).toBe(1);
    expect(cardIndexAt(0, p)).toBe(0);
    expect(Object.is(cardIndexAt(0, p), -0)).toBe(false);
  });
});
