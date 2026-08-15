export interface PixelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// 前台窗口是否覆盖整个显示器（物理像素，8px 容差）
export function coversDisplay(win: PixelRect, display: PixelRect): boolean {
  return (
    win.left <= display.left + 8 &&
    win.top <= display.top + 8 &&
    win.right >= display.right - 8 &&
    win.bottom >= display.bottom - 8
  );
}
