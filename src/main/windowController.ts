import { randomUUID } from 'node:crypto';
import { BrowserWindow, screen, nativeTheme, systemPreferences } from 'electron';
import { applyAcrylic, disableAcrylic } from './acrylicNative';
import { dbg } from './debugLog';
import { computeL1Bounds, computeL2Bounds, computeL3Bounds, isInHotZone } from '../shared/geometry';
import { TIMING } from '../shared/stateMachine';
import { decideBackdrop } from '../shared/acrylic';
import { isExpanding, transitionDuration } from '../shared/transition';
import type {
  BackdropMode,
  DisplayInfo,
  IslandLevel,
  L2TrackDescriptor,
  IslandState,
  IslandTransitionState,
  Rect,
  RenderMode,
  TransitionReason,
  TransitionRequestResult,
  UiPreferences
} from '../shared/types';

function sameBounds(left: Rect, right: Rect): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

export class IslandWindowController {
  readonly win: BrowserWindow;
  level: IslandLevel = 'l1';
  backdrop: BackdropMode = 'fallback';
  paused = false;
  private l2Detail = false;
  private l2Tracks: L2TrackDescriptor = { agent: false, procurement: false, contracts: false, misc: false };
  private baseRenderMode: RenderMode = 'software';
  private transitionState: IslandTransitionState | null = null;
  private pendingLevel: IslandLevel | null = null;
  private dwellTimer: NodeJS.Timeout | null = null;
  private leaveTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private prepareTimer: NodeJS.Timeout | null = null;
  private finishTimer: NodeJS.Timeout | null = null;
  private resizeCommittedId: string | null = null;
  private interacting = false;
  private readonly handleThemeUpdated = (): void => this.applyBackdrop();
  private readonly handleDisplayChanged = (): void => this.reconcileDisplayBounds();

  constructor(win: BrowserWindow, private readonly isAcrylicDisabled: () => boolean = () => false) {
    this.win = win;
  }

  async init(): Promise<void> {
    const d = this.primaryDisplay();
    const l1 = computeL1Bounds(d);
    this.win.setBounds(l1);
    dbg('init display=' + JSON.stringify(d) + ' l1=' + JSON.stringify(l1) + ' content=' + JSON.stringify(this.win.getContentBounds()) + ' scale=' + screen.getPrimaryDisplay().scaleFactor);
    this.win.setIgnoreMouseEvents(true, { forward: true });
    nativeTheme.on('updated', this.handleThemeUpdated);
    screen.on('display-metrics-changed', this.handleDisplayChanged);
    screen.on('display-added', this.handleDisplayChanged);
    screen.on('display-removed', this.handleDisplayChanged);
    this.applyBackdrop();
    this.win.showInactive();
    this.startPolling();
    this.broadcastState();
  }

  primaryDisplay(): DisplayInfo {
    const d = screen.getPrimaryDisplay();
    return { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, workArea: { ...d.workArea } };
  }

  private effectiveRenderMode(): RenderMode {
    if (nativeTheme.shouldUseHighContrastColors || systemPreferences.getAnimationSettings().prefersReducedMotion) return 'direct';
    return this.baseRenderMode;
  }

  setRenderMode(mode: RenderMode): void {
    if (this.baseRenderMode === mode) return;
    this.baseRenderMode = mode;
    if (mode === 'direct' && this.transitionState) this.commitTransition(this.transitionState.id);
    this.broadcastPreferences();
  }

  currentOrTargetLevel(): IslandLevel {
    return this.pendingLevel ?? this.transitionState?.to ?? this.level;
  }

  applyBackdrop(broadcast = true): void {
    const scheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    const highContrast = nativeTheme.shouldUseHighContrastColors;
    const reducedMotion = systemPreferences.getAnimationSettings().prefersReducedMotion;
    const disabled = this.isAcrylicDisabled();
    if (this.transitionState) {
      disableAcrylic(this.win.getNativeWindowHandle());
      this.backdrop = 'fallback';
    } else {
      const shouldAttempt = this.level !== 'l1' && !highContrast && !reducedMotion && !disabled;
      const ok = shouldAttempt
        ? applyAcrylic(this.win.getNativeWindowHandle(), scheme)
        : (disableAcrylic(this.win.getNativeWindowHandle()), false);
      this.backdrop = decideBackdrop(this.level, ok, highContrast, reducedMotion, disabled);
      dbg('backdrop=' + this.backdrop + ' acrylicOk=' + ok + ' highContrast=' + highContrast + ' reducedMotion=' + reducedMotion);
    }
    if (broadcast) {
      this.broadcastState();
      this.broadcastPreferences();
    }
  }

  setLevel(next: IslandLevel): TransitionRequestResult {
    if (this.paused) return { accepted: false };
    const active = this.transitionState;
    if (active) {
      if (active.phase === 'preparing' && next === active.from) {
        this.cancelPreparing(active.id);
        return { accepted: true, transitionId: active.id };
      }
      if (next === active.to) return { accepted: false, transitionId: active.id };
      this.pendingLevel = next;
      return { accepted: true, transitionId: active.id };
    }
    if (next === this.level) return { accepted: false };
    return this.beginTransition(next, 'level', this.boundsFor(next));
  }

  private beginTransition(next: IslandLevel, reason: TransitionReason, target: Rect): TransitionRequestResult {
    if (this.leaveTimer) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
    const id = randomUUID();
    const renderMode = this.effectiveRenderMode();
    const transition: IslandTransitionState = {
      id,
      from: this.level,
      to: next,
      phase: 'preparing',
      fromBounds: this.win.getBounds(),
      toBounds: target,
      durationMs: transitionDuration(renderMode),
      renderMode,
      reason
    };
    this.transitionState = transition;
    dbg('transition preparing ' + transition.from + ' -> ' + transition.to + ' mode=' + renderMode);
    disableAcrylic(this.win.getNativeWindowHandle());
    this.backdrop = 'fallback';
    this.win.setIgnoreMouseEvents(true, { forward: true });
    if (!this.win.isVisible()) this.win.showInactive();
    this.broadcastTransition();
    this.broadcastState();
    this.broadcastPreferences();

    if (renderMode === 'direct' || sameBounds(transition.fromBounds, transition.toBounds)) {
      this.commitTransition(id);
    } else {
      this.prepareTimer = setTimeout(() => this.transitionReady(id), TIMING.PREPARE_TIMEOUT_MS);
    }
    return { accepted: true, transitionId: id };
  }

  transitionReady(id: string): boolean {
    const transition = this.transitionState;
    if (!transition || transition.id !== id || transition.phase !== 'preparing') return false;
    if (this.resizeCommittedId === id) return false;
    if (this.prepareTimer) clearTimeout(this.prepareTimer);
    this.prepareTimer = null;
    if (isExpanding(transition.fromBounds, transition.toBounds)) {
      this.resizeCommittedId = id;
      this.win.setBounds(transition.toBounds);
      this.prepareTimer = setTimeout(() => this.startAnimating(id), TIMING.RESIZE_SETTLE_MS);
      return true;
    }
    this.startAnimating(id);
    return true;
  }

  private startAnimating(id: string): void {
    const transition = this.transitionState;
    if (!transition || transition.id !== id || transition.phase !== 'preparing') return;
    if (this.prepareTimer) clearTimeout(this.prepareTimer);
    this.prepareTimer = null;
    this.transitionState = { ...transition, phase: 'animating' };
    this.broadcastTransition();
    this.broadcastState();
    this.finishTimer = setTimeout(() => this.commitTransition(id), TIMING.FINISH_TIMEOUT_MS);
  }

  transitionFinished(id: string): boolean {
    const transition = this.transitionState;
    if (!transition || transition.id !== id || transition.phase !== 'animating') return false;
    if (this.finishTimer) clearTimeout(this.finishTimer);
    this.transitionState = { ...transition, phase: 'settling' };
    this.broadcastTransition();
    this.broadcastState();
    const resizeBeforeFinalize = (): void => {
      const active = this.transitionState;
      if (!active || active.id !== id || active.phase !== 'settling') return;
      if (!sameBounds(this.win.getBounds(), transition.toBounds)) this.win.setBounds(transition.toBounds);
      this.finishTimer = setTimeout(() => this.commitTransition(id), TIMING.FINALIZE_SETTLE_MS);
    };
    if (sameBounds(this.win.getBounds(), transition.toBounds)) {
      this.finishTimer = setTimeout(() => this.commitTransition(id), TIMING.FINALIZE_SETTLE_MS);
    } else {
      this.finishTimer = setTimeout(resizeBeforeFinalize, TIMING.RESIZE_SETTLE_MS);
    }
    return true;
  }

  private commitTransition(id: string): void {
    const transition = this.transitionState;
    if (!transition || transition.id !== id) return;
    this.clearTransitionTimers();
    if (!sameBounds(this.win.getBounds(), transition.toBounds)) this.win.setBounds(transition.toBounds);
    this.level = transition.to;
    this.transitionState = null;
    this.win.setIgnoreMouseEvents(this.level === 'l1', { forward: true });
    this.applyBackdrop(false);
    this.broadcastTransition();
    this.broadcastState();
    this.broadcastPreferences();
    const queued = this.pendingLevel;
    this.pendingLevel = null;
    if (queued && queued !== this.level && !this.paused) queueMicrotask(() => this.setLevel(queued));
  }

  private cancelPreparing(id: string): void {
    const transition = this.transitionState;
    if (!transition || transition.id !== id || transition.phase !== 'preparing') return;
    this.clearTransitionTimers();
    this.transitionState = null;
    this.pendingLevel = null;
    this.win.setIgnoreMouseEvents(this.level === 'l1', { forward: true });
    this.applyBackdrop(false);
    this.broadcastTransition();
    this.broadcastState();
    this.broadcastPreferences();
  }

  private clearTransitionTimers(): void {
    if (this.prepareTimer) clearTimeout(this.prepareTimer);
    if (this.finishTimer) clearTimeout(this.finishTimer);
    this.prepareTimer = null;
    this.finishTimer = null;
    this.resizeCommittedId = null;
  }

  state(): IslandState {
    return { level: this.level, backdrop: this.backdrop, paused: this.paused, transition: this.transitionState };
  }

  uiPreferences(): UiPreferences {
    return {
      colorScheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      highContrast: nativeTheme.shouldUseHighContrastColors,
      reducedMotion: systemPreferences.getAnimationSettings().prefersReducedMotion,
      backdropMode: this.backdrop,
      renderMode: this.effectiveRenderMode()
    };
  }

  broadcastState(): void {
    if (!this.win.isDestroyed()) this.win.webContents.send('window:state', this.state());
  }

  broadcastTransition(): void {
    if (!this.win.isDestroyed()) this.win.webContents.send('window:transition', this.transitionState);
  }

  broadcastPreferences(): void {
    if (!this.win.isDestroyed()) this.win.webContents.send('ui:preferences', this.uiPreferences());
  }

  boundsFor(level: IslandLevel): Rect {
    const d = this.primaryDisplay();
    if (level === 'l1') return computeL1Bounds(d);
    if (level === 'l2') return computeL2Bounds(d, this.l2Detail, this.l2Tracks);
    return computeL3Bounds(d);
  }

  setL2Detail(value: boolean): TransitionRequestResult {
    if (this.l2Detail === value) return { accepted: false };
    this.l2Detail = value;
    if (this.currentOrTargetLevel() !== 'l2') return { accepted: true };
    if (this.transitionState) {
      if (this.transitionState.to === 'l2') {
        this.transitionState = { ...this.transitionState, toBounds: this.boundsFor('l2') };
        this.broadcastTransition();
        this.broadcastState();
      }
      return { accepted: true };
    }
    return this.beginTransition('l2', 'l2-detail', this.boundsFor('l2'));
  }

  setL2ContentMode(value: L2TrackDescriptor): TransitionRequestResult {
    if (this.l2Tracks.agent === value.agent && this.l2Tracks.procurement === value.procurement && this.l2Tracks.contracts === value.contracts && this.l2Tracks.misc === value.misc) return { accepted: false };
    this.l2Tracks = { ...value };
    if (this.currentOrTargetLevel() !== 'l2') return { accepted: true };
    if (this.transitionState) {
      if (this.transitionState.to === 'l2') {
        this.transitionState = { ...this.transitionState, toBounds: this.boundsFor('l2') };
        this.broadcastTransition();
        this.broadcastState();
      }
      return { accepted: true };
    }
    return this.beginTransition('l2', 'l2-content', this.boundsFor('l2'));
  }

  private reconcileDisplayBounds(): void {
    const targetLevel = this.currentOrTargetLevel();
    if (this.transitionState) this.commitTransition(this.transitionState.id);
    const target = this.boundsFor(targetLevel);
    if (!sameBounds(this.win.getBounds(), target)) this.beginTransition(targetLevel, 'display-change', target);
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      if (this.win.isDestroyed()) {
        this.dispose();
        return;
      }
      if (this.paused) return;
      const cursor = screen.getCursorScreenPoint();
      const display = this.primaryDisplay();
      if (this.level === 'l1') {
        if (isInHotZone(cursor.x, cursor.y, display)) {
          if (!this.dwellTimer) {
            this.dwellTimer = setTimeout(() => {
              this.dwellTimer = null;
              if (this.level === 'l1' && !this.paused) this.setLevel('l2');
            }, TIMING.HOVER_DWELL_MS);
          }
        } else if (this.dwellTimer) {
          clearTimeout(this.dwellTimer);
          this.dwellTimer = null;
        }
      } else if (this.level === 'l2') {
        const b = this.win.getBounds();
        const inside = cursor.x >= b.x && cursor.x <= b.x + b.width && cursor.y >= b.y && cursor.y <= b.y + b.height;
        if (!inside && !this.interacting) {
          if (!this.leaveTimer) {
            this.leaveTimer = setTimeout(() => {
              this.leaveTimer = null;
              if (!this.interacting && !this.paused && this.level === 'l2') this.setLevel('l1');
            }, TIMING.LEAVE_GRACE_MS);
          }
        } else if (this.leaveTimer) {
          clearTimeout(this.leaveTimer);
          this.leaveTimer = null;
        }
      } else if (this.leaveTimer) {
        clearTimeout(this.leaveTimer);
        this.leaveTimer = null;
      }
    }, TIMING.POLL_INTERVAL_MS);
  }

  setInteracting(value: boolean): void {
    this.interacting = value;
    if (value && this.leaveTimer) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
  }

  togglePause(): boolean {
    this.paused = !this.paused;
    if (this.paused) this.win.hide();
    else {
      this.win.showInactive();
      if (this.currentOrTargetLevel() === 'l1') this.setLevel('l2');
    }
    this.broadcastState();
    return this.paused;
  }

  handleClose(event: { preventDefault(): void }, quitting: boolean): void {
    if (quitting) return;
    event.preventDefault();
    if (!this.win.isDestroyed()) this.setLevel('l1');
  }

  dispose(): void {
    this.clearTransitionTimers();
    for (const timer of [this.dwellTimer, this.leaveTimer, this.pollTimer]) {
      if (timer) clearTimeout(timer);
    }
    nativeTheme.off('updated', this.handleThemeUpdated);
    screen.off('display-metrics-changed', this.handleDisplayChanged);
    screen.off('display-added', this.handleDisplayChanged);
    screen.off('display-removed', this.handleDisplayChanged);
  }
}
