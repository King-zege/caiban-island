import { describe, expect, it } from 'vitest';
import { DESIGN_TOKENS, designTokenCssVariables } from '../src/shared/designTokens';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground: string, background: string): number {
  const left = luminance(foreground);
  const right = luminance(background);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

describe('design tokens', () => {
  it('深浅主题具有同一组语义键', () => {
    expect(Object.keys(DESIGN_TOKENS.dark).sort()).toEqual(Object.keys(DESIGN_TOKENS.light).sort());
  });

  it('普通紧急度使用中性灰且根变量来自 shared', () => {
    expect(DESIGN_TOKENS.dark.normal).toBe('#8E8E93');
    expect(designTokenCssVariables('dark')['--radius-l3']).toBe('24px');
    expect(designTokenCssVariables('light')['--accent']).toBe('#0078D4');
  });

  it('小字号弱文本在深浅确定性背景上满足 WCAG AA', () => {
    const cases = [
      [DESIGN_TOKENS.dark.textTertiary, '#1F2126'],
      [DESIGN_TOKENS.dark.low, '#1F2126'],
      [DESIGN_TOKENS.light.textTertiary, '#F2F4F7'],
      [DESIGN_TOKENS.light.low, '#F2F4F7'],
      [DESIGN_TOKENS.light.textTertiary, '#FBFBFC'],
      [DESIGN_TOKENS.light.low, '#FBFBFC']
    ] as const;
    for (const [foreground, background] of cases) expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});
