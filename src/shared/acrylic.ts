import type { BackdropMode, ColorScheme, IslandLevel } from './types';

// Windows SetWindowCompositionAttribute 使用 AABBGGRR。
export const ACRYLIC_TINT: Record<ColorScheme, { a: number; b: number; g: number; r: number }> = {
  dark: { a: 0x78, b: 0x0f, g: 0x0c, r: 0x0a },
  light: { a: 0x84, b: 0xfa, g: 0xf7, r: 0xf6 }
};
export const FALLBACK_SURFACE = { dark: '#111318', light: '#F2F4F7' } as const;

export function buildGradientColor(a: number, b: number, g: number, r: number): number {
  return ((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff);
}

export function decideBackdrop(
  level: IslandLevel,
  acrylicOk: boolean,
  highContrast: boolean,
  reducedMotion: boolean,
  acrylicDisabled: boolean
): BackdropMode {
  if (level === 'l1') return 'transparent';
  if (!acrylicOk || highContrast || reducedMotion || acrylicDisabled) return 'fallback';
  return 'acrylic';
}
