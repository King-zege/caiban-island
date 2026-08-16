import { describe, expect, it } from 'vitest';
import { DESIGN_TOKENS, designTokenCssVariables } from '../src/shared/designTokens';

describe('design tokens', () => {
  it('深浅主题具有同一组语义键', () => {
    expect(Object.keys(DESIGN_TOKENS.dark).sort()).toEqual(Object.keys(DESIGN_TOKENS.light).sort());
  });

  it('普通紧急度使用中性灰且根变量来自 shared', () => {
    expect(DESIGN_TOKENS.dark.normal).toBe('#8E8E93');
    expect(designTokenCssVariables('dark')['--radius-l3']).toBe('24px');
    expect(designTokenCssVariables('light')['--accent']).toBe('#0078D4');
  });
});
