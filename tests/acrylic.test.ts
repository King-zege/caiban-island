import { describe, expect, it } from 'vitest';
import { buildGradientColor, decideBackdrop } from '../src/shared/acrylic';

describe('buildGradientColor', () => {
  it('生成 AABBGGRR 格式的磨砂偏色', () => {
    expect(buildGradientColor(0x76, 0x0b, 0x09, 0x08)).toBe(0x760b0908);
  });
});

describe('decideBackdrop', () => {
  it('磨砂可用且非高对比度 → acrylic', () => {
    expect(decideBackdrop(true, false)).toBe('acrylic');
  });
  it('磨砂失败或高对比度 → fallback', () => {
    expect(decideBackdrop(false, false)).toBe('fallback');
    expect(decideBackdrop(true, true)).toBe('fallback');
  });
});
