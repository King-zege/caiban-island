import { screen } from 'electron';
import koffi from 'koffi';
import { coversDisplay } from '../shared/fullscreen';
import type { IslandWindowController } from './windowController';

// FR-018：真正全屏前台窗口出现时暂停灵动岛；普通最大化窗口不算全屏
// 通过 Win32 轮询前台窗口矩形与主显示器边界对比
// 注意：GetWindowRect 返回物理像素，display.bounds 是逻辑像素，必须按 scaleFactor 换算
export class FullscreenDetector {
  private timer: NodeJS.Timeout | null = null;
  private autoHidden = false;

  constructor(private readonly controller: IslandWindowController) {}

  start(): void {
    this.timer = setInterval(() => this.check(), 1500);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.restore();
  }

  private isOwnWindow(hwnd: bigint): boolean {
    try {
      const win = this.controller.win.getNativeWindowHandle();
      return hwnd === win.readBigUInt64LE(0);
    } catch {
      return false;
    }
  }

  private check(): void {
    try {
      const user32 = koffi.load('user32.dll');
      const getFg = user32.func('int64 GetForegroundWindow()');
      const getRect = user32.func('int GetWindowRect(int64 hwnd, void* rect)');
      const hwnd = getFg();
      if (!hwnd || this.isOwnWindow(hwnd)) {
        this.restore();
        return;
      }
      const rect = Buffer.alloc(16);
      getRect(hwnd, rect);
      const left = rect.readInt32LE(0);
      const top = rect.readInt32LE(4);
      const right = rect.readInt32LE(8);
      const bottom = rect.readInt32LE(12);
      const d = screen.getPrimaryDisplay();
      // GetWindowRect 是物理像素，display.bounds 是逻辑像素：统一到物理像素再比较
      const scale = d.scaleFactor || 1;
      const px = d.bounds;
      const boundsLeft = Math.round(px.x * scale);
      const boundsTop = Math.round(px.y * scale);
      const boundsRight = Math.round((px.x + px.width) * scale);
      const boundsBottom = Math.round((px.y + px.height) * scale);
      const covers = coversDisplay(
        { left, top, right, bottom },
        { left: boundsLeft, top: boundsTop, right: boundsRight, bottom: boundsBottom }
      );
      if (covers) this.hide();
      else this.restore();
    } catch {
      this.restore();
    }
  }

  private hide(): void {
    if (this.autoHidden) return;
    this.autoHidden = true;
    this.controller.win.hide();
  }

  // 离开全屏后 500ms 恢复 L1
  private restore(): void {
    if (!this.autoHidden) return;
    this.autoHidden = false;
    setTimeout(() => {
      if (this.autoHidden) return;
      const win = this.controller.win;
      if (!win.isVisible()) {
        win.showInactive();
        this.controller.setLevel('l1');
      }
    }, 500);
  }
}
