import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { Rect } from '../src/shared/types';
import { TIMING } from '../src/shared/stateMachine';

const { displayHandlers, nativeThemeMock, screenMock } = vi.hoisted(() => {
  const displayHandlers = new Map<string, () => void>();
  return {
  displayHandlers,
  nativeThemeMock: {
    shouldUseDarkColors: true,
    shouldUseHighContrastColors: false,
    on: vi.fn(),
    off: vi.fn()
  },
  screenMock: {
    getPrimaryDisplay: vi.fn(() => ({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      scaleFactor: 1
    })),
    getCursorScreenPoint: vi.fn(() => ({ x: -100, y: -100 })),
    on: vi.fn((event: string, handler: () => void) => displayHandlers.set(event, handler)),
    off: vi.fn((event: string) => displayHandlers.delete(event))
  }
};
});

vi.mock('electron', () => ({
  BrowserWindow: class {},
  nativeTheme: nativeThemeMock,
  screen: screenMock,
  systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: false }) }
}));
vi.mock('../src/main/acrylicNative', () => ({ applyAcrylic: () => true, disableAcrylic: () => true }));

const { IslandWindowController } = await import('../src/main/windowController');

function createWindow(): { win: BrowserWindow; setBounds: ReturnType<typeof vi.fn> } {
  let bounds: Rect = { x: 0, y: 0, width: 96, height: 35 };
  const setBounds = vi.fn((next: Rect) => { bounds = { ...next }; });
  const fake = {
    setBounds,
    getBounds: () => ({ ...bounds }),
    getContentBounds: () => ({ ...bounds }),
    setIgnoreMouseEvents: vi.fn(),
    getNativeWindowHandle: () => Buffer.alloc(8),
    isVisible: () => true,
    isDestroyed: () => false,
    showInactive: vi.fn(),
    hide: vi.fn(),
    webContents: { send: vi.fn() }
  };
  return { win: fake as unknown as BrowserWindow, setBounds };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  displayHandlers.clear();
  nativeThemeMock.shouldUseHighContrastColors = false;
  screenMock.getPrimaryDisplay.mockReturnValue({
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    scaleFactor: 1
  });
});

afterEach(() => vi.useRealTimers());

describe('P12 单次原生 resize 协调器', () => {
  it('展开在 ready 时 resize 一次，完成时不重复提交', async () => {
    const { win, setBounds } = createWindow();
    const controller = new IslandWindowController(win);
    controller.setRenderMode('composited');
    await controller.init();
    setBounds.mockClear();

    const request = controller.setLevel('l2');
    expect(request.accepted).toBe(true);
    expect(controller.state().level).toBe('l1');
    expect(controller.transitionReady(request.transitionId!)).toBe(true);
    expect(setBounds).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(TIMING.RESIZE_SETTLE_MS);
    expect(controller.transitionFinished(request.transitionId!)).toBe(true);
    expect(setBounds).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(TIMING.FINALIZE_SETTLE_MS);
    expect(controller.state().level).toBe('l2');
    controller.dispose();
  });

  it('收起先完成视觉动画，再 resize 一次', async () => {
    const { win, setBounds } = createWindow();
    const controller = new IslandWindowController(win);
    controller.setRenderMode('composited');
    await controller.init();
    const expand = controller.setLevel('l2');
    controller.transitionReady(expand.transitionId!);
    vi.advanceTimersByTime(TIMING.RESIZE_SETTLE_MS);
    controller.transitionFinished(expand.transitionId!);
    vi.advanceTimersByTime(TIMING.FINALIZE_SETTLE_MS);
    setBounds.mockClear();

    const collapse = controller.setLevel('l1');
    controller.transitionReady(collapse.transitionId!);
    expect(setBounds).not.toHaveBeenCalled();
    controller.transitionFinished(collapse.transitionId!);
    expect(setBounds).not.toHaveBeenCalled();
    vi.advanceTimersByTime(TIMING.RESIZE_SETTLE_MS);
    expect(setBounds).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(TIMING.FINALIZE_SETTLE_MS);
    expect(controller.state().level).toBe('l1');
    controller.dispose();
  });

  it('preparing 阶段反向请求取消且不 resize，direct 模式仍可达', async () => {
    const { win, setBounds } = createWindow();
    const controller = new IslandWindowController(win);
    controller.setRenderMode('composited');
    await controller.init();
    setBounds.mockClear();
    controller.setLevel('l2');
    controller.setLevel('l1');
    expect(controller.state().transition).toBeNull();
    expect(setBounds).not.toHaveBeenCalled();

    controller.setRenderMode('direct');
    controller.setLevel('l2');
    expect(controller.state().level).toBe('l2');
    expect(setBounds).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('renderer 不确认时由 80ms/280ms 超时完成且只 resize 一次', async () => {
    const { win, setBounds } = createWindow();
    const controller = new IslandWindowController(win);
    controller.setRenderMode('composited');
    await controller.init();
    setBounds.mockClear();

    controller.setLevel('l2');
    vi.advanceTimersByTime(TIMING.PREPARE_TIMEOUT_MS + TIMING.RESIZE_SETTLE_MS);
    expect(controller.state().transition?.phase).toBe('animating');
    expect(setBounds).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(TIMING.FINISH_TIMEOUT_MS);
    expect(controller.state().transition).toBeNull();
    expect(controller.state().level).toBe('l2');
    expect(setBounds).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('动画中的快速请求只保留最后层级', async () => {
    const { win } = createWindow();
    const controller = new IslandWindowController(win);
    controller.setRenderMode('composited');
    await controller.init();

    const expand = controller.setLevel('l2');
    controller.transitionReady(expand.transitionId!);
    vi.advanceTimersByTime(TIMING.RESIZE_SETTLE_MS);
    controller.setLevel('l3');
    controller.setLevel('l1');
    controller.transitionFinished(expand.transitionId!);
    vi.advanceTimersByTime(TIMING.FINALIZE_SETTLE_MS);
    await Promise.resolve();
    expect(controller.state().level).toBe('l2');
    expect(controller.state().transition).toMatchObject({ from: 'l2', to: 'l1', phase: 'preparing' });
    controller.dispose();
  });

  it('运行期 GPU 异常降级为 direct，并完成正在进行的切换', async () => {
    const { win, setBounds } = createWindow();
    const controller = new IslandWindowController(win);
    controller.setRenderMode('composited');
    await controller.init();
    setBounds.mockClear();

    controller.setLevel('l2');
    controller.setRenderMode('direct');
    expect(controller.state().transition).toBeNull();
    expect(controller.state().level).toBe('l2');
    expect(setBounds).toHaveBeenCalledTimes(1);
    expect(controller.uiPreferences().renderMode).toBe('direct');
    controller.dispose();
  });

  it('显示器几何变化通过同一协调器落到新位置', async () => {
    const { win, setBounds } = createWindow();
    const controller = new IslandWindowController(win);
    controller.setRenderMode('direct');
    await controller.init();
    setBounds.mockClear();
    screenMock.getPrimaryDisplay.mockReturnValue({
      bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
      workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
      scaleFactor: 1.5
    });

    displayHandlers.get('display-metrics-changed')?.();
    expect(controller.state().transition).toBeNull();
    expect(setBounds).toHaveBeenCalledTimes(1);
    expect(setBounds.mock.calls[0]?.[0]).toMatchObject({ x: 3152, y: -31, width: 96, height: 35 });
    controller.dispose();
  });
});
