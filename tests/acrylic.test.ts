import { describe, expect, it } from 'vitest';
import { buildGradientColor, decideBackdrop } from '../src/shared/acrylic';

describe('buildGradientColor', () => {
  it('生成 AABBGGRR 格式的磨砂偏色', () => {
    expect(buildGradientColor(0x76, 0x0b, 0x09, 0x08)).toBe(0x760b0908);
  });
});

describe('decideBackdrop', () => {
  it('磨砂可用且非高对比度 → acrylic', () => {
    expect(decideBackdrop('l2', true, false, false, false)).toBe('acrylic');
  });
  it('L1 始终透明，不启用整窗磨砂', () => {
    expect(decideBackdrop('l1', true, false, false, false)).toBe('transparent');
  });
  it('磨砂失败、高对比度、减少动画或用户关闭 → fallback', () => {
    expect(decideBackdrop('l2', false, false, false, false)).toBe('fallback');
    expect(decideBackdrop('l2', true, true, false, false)).toBe('fallback');
    expect(decideBackdrop('l3', true, false, true, false)).toBe('fallback');
    expect(decideBackdrop('l3', true, false, false, true)).toBe('fallback');
  });
});
