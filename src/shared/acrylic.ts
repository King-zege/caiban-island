import type { BackdropMode } from './types';

// 外岛磨砂偏色 #08090B，76% tint（AABBGGRR）
export const ACRYLIC_TINT = { a: 0x76, b: 0x0b, g: 0x09, r: 0x08 } as const;
export const FALLBACK_SURFACE = '#111216';

export function buildGradientColor(a: number, b: number, g: number, r: number): number {
  return ((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff);
}

export function decideBackdrop(acrylicOk: boolean, highContrast: boolean): BackdropMode {
  if (!acrylicOk || highContrast) return 'fallback';
  return 'acrylic';
}
