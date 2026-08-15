import { BrowserWindow, screen, nativeTheme } from 'electron';
import { applyAcrylic } from './acrylicNative';
import { dbg } from './debugLog';
import { computeL1Bounds, computeL2Bounds, computeL3Bounds, isInHotZone } from '../shared/geometry';
import { TIMING } from '../shared/stateMachine';
import { decideBackdrop } from '../shared/acrylic';
import type { BackdropMode, DisplayInfo, IslandLevel, IslandState, Rect } from '../shared/types';

export class IslandWindowController {
  readonly win: BrowserWindow;
  level: IslandLevel = 'l1';
  backdrop: BackdropMode = 'fallback';
  paused = false;

  private dwellTimer: NodeJS.Timeout | null = null;
  private leaveTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private animTimer: NodeJS.Timeout | null = null;
  private interacting = false;

  constructor(win: BrowserWindow) {
    this.win = win;
  }

  async init(): Promise<void> {
    const d = this.primaryDisplay();
    const l1 = computeL1Bounds(d);
    this.win.setBounds(l1);
    dbg('init display=' + JSON.stringify(d) + ' l1=' + JSON.stringify(l1) + ' content=' + JSON.stringify(this.win.getContentBounds()) + ' scale=' + screen.getPrimaryDisplay().scaleFactor);
    setTimeout(() => {
      dbg('after1.5s bounds=' + JSON.stringify(this.win.getBounds()) + ' content=' + JSON.stringify(this.win.getContentBounds()) + ' visible=' + this.win.isVisible());
    }, 1500);
    this.applyBackdrop();
    this.win.showInactive(); // 展开/显示不抢焦点
    this.startPolling();
    this.broadcastState();
  }

  primaryDisplay(): DisplayInfo {
    const d = screen.getPrimaryDisplay();
    return { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, workArea: { ...d.workArea } };
  }

  applyBackdrop(): void {
    const ok = applyAcrylic(this.win.getNativeWindowHandle());
    this.backdrop = decideBackdrop(ok, nativeTheme.shouldUseHighContrastColors);
    dbg('backdrop=' + this.backdrop + ' acrylicOk=' + ok + ' highContrast=' + nativeTheme.shouldUseHighContrastColors);
    this.win.webContents.send('window:state', this.state());
  }

  setLevel(next: IslandLevel): void {
    if (next === this.level || this.paused) return;
    dbg('setLevel -> ' + next);
    this.level = next;
    this.animateBounds(this.boundsFor(next));
    this.win.setIgnoreMouseEvents(next === 'l1', { forward: true });
    if (next !== 'l1' && !this.win.isVisible()) this.win.showInactive();
    this.broadcastState();
  }

  state(): IslandState {
    return { level: this.level, backdrop: this.backdrop, paused: this.paused };
  }

  broadcastState(): void {
    if (!this.win.isDestroyed()) this.win.webContents.send('window:state', this.state());
  }

  boundsFor(level: IslandLevel): Rect {
    const d = this.primaryDisplay();
    if (level === 'l1') return computeL1Bounds(d);
    if (level === 'l2') return computeL2Bounds(d);
    return computeL3Bounds(d);
  }

  // Windows 无原生窗口动画，用主进程定时器做弹簧式形变
  private animateBounds(target: Rect): void {
    const start = this.win.getBounds();
    const t0 = Date.now();
    const dur = TIMING.ANIMATION_MS;
    const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
    if (this.animTimer) clearInterval(this.animTimer);
    this.animTimer = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / dur);
      const e = easeOutCubic(p);
      this.win.setBounds({
        x: Math.round(start.x + (target.x - start.x) * e),
        y: Math.round(start.y + (target.y - start.y) * e),
        width: Math.round(start.width + (target.width - start.width) * e),
        height: Math.round(start.height + (target.height - start.height) * e)
      });
      if (p >= 1 && this.animTimer) {
        clearInterval(this.animTimer);
        this.animTimer = null;
      }
    }, 16);
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      if (this.paused) return;
      const cursor = screen.getCursorScreenPoint();
      const display = this.primaryDisplay();
      if (this.level === 'l1') {
        if (isInHotZone(cursor.x, cursor.y, display)) {
          if (!this.dwellTimer) {
            this.dwellTimer = setTimeout(() => {
              this.dwellTimer = null;
              dbg('hoverDwell fired');
              if (this.level === 'l1' && !this.paused) this.setLevel('l2');
            }, TIMING.HOVER_DWELL_MS);
          }
        } else if (this.dwellTimer) {
          clearTimeout(this.dwellTimer);
          this.dwellTimer = null;
        }
      } else {
        const b = this.win.getBounds();
        const inside =
          cursor.x >= b.x && cursor.x <= b.x + b.width &&
          cursor.y >= b.y && cursor.y <= b.y + b.height;
        if (!inside && !this.interacting) {
          if (!this.leaveTimer) {
            this.leaveTimer = setTimeout(() => {
              this.leaveTimer = null;
              if (!this.interacting && !this.paused && this.level !== 'l1') this.setLevel('l1');
            }, TIMING.LEAVE_GRACE_MS);
          }
        } else if (this.leaveTimer) {
          clearTimeout(this.leaveTimer);
          this.leaveTimer = null;
        }
      }
    }, TIMING.POLL_INTERVAL_MS);
  }

  setInteracting(v: boolean): void {
    this.interacting = v;
    if (v && this.leaveTimer) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
  }

  togglePause(): boolean {
    this.paused = !this.paused;
    if (this.paused) this.win.hide();
    else {
      this.win.showInactive();
      if (this.level === 'l1') this.setLevel('l2');
    }
    this.broadcastState();
    return this.paused;
  }

  dispose(): void {
    for (const t of [this.dwellTimer, this.leaveTimer, this.pollTimer, this.animTimer]) {
      if (t) clearTimeout(t);
    }
  }
}
