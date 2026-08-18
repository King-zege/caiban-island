import { describe, expect, it } from 'vitest';
import { classifyRenderMode } from '../src/shared/renderMode';
import { computeShellTransform, isExpanding, transitionDuration } from '../src/shared/transition';
import { visibleCarouselRange } from '../src/shared/carousel';
import { visibleListRange } from '../src/shared/virtualization';
import { TIMING } from '../src/shared/stateMachine';

describe('P12 渲染能力降级', () => {
  it('集显和独显都按 Chromium 合成状态启用完整模式', () => {
    expect(classifyRenderMode({ gpuCompositing: 'enabled' })).toBe('composited');
    expect(classifyRenderMode({ gpuCompositing: 'enabled_on' })).toBe('composited');
    expect(classifyRenderMode({ gpuCompositing: 'enabled_readback' })).toBe('composited');
  });

  it('软件渲染可用时简化动画，完全不可用或进程异常时直切', () => {
    expect(classifyRenderMode({ gpuCompositing: 'disabled_software' })).toBe('software');
    expect(classifyRenderMode({ gpuCompositing: 'unavailable_software' })).toBe('software');
    expect(classifyRenderMode({})).toBe('software');
    expect(classifyRenderMode({ gpuCompositing: 'disabled_off' })).toBe('direct');
    expect(classifyRenderMode({ gpuCompositing: 'enabled', gpuCrashed: true })).toBe('direct');
    expect(classifyRenderMode({ gpuCompositing: 'enabled', highContrast: true })).toBe('direct');
    expect(classifyRenderMode({ gpuCompositing: 'enabled', reducedMotion: true })).toBe('direct');
  });

  it('不同模式使用确定性时长', () => {
    expect(transitionDuration('composited')).toBe(200);
    expect(transitionDuration('software')).toBe(120);
    expect(transitionDuration('direct')).toBe(0);
    expect(TIMING.PREPARE_TIMEOUT_MS).toBe(80);
    expect(TIMING.RESIZE_SETTLE_MS).toBe(8);
    expect(TIMING.FINALIZE_SETTLE_MS).toBe(16);
    expect(TIMING.FINISH_TIMEOUT_MS).toBe(280);
  });
});

describe('P12 合成壳几何', () => {
  const l2 = { x: 580, y: 0, width: 760, height: 280 };
  const l3 = { x: 144, y: 70, width: 1632, height: 918 };

  it('展开和收起按面积判断，变换映射到屏幕坐标', () => {
    expect(isExpanding(l2, l3)).toBe(true);
    expect(isExpanding(l3, l2)).toBe(false);
    expect(computeShellTransform(l3, l2)).toEqual({
      translateX: 436,
      translateY: -70,
      scaleX: 760 / 1632,
      scaleY: 280 / 918
    });
  });
});

describe('P12 Carousel 虚拟范围', () => {
  it('100 个任务在 760px 视口最多挂载 7 张卡', () => {
    const physics = { viewport: 760, item: 248, gap: 12, count: 100 };
    const start = visibleCarouselRange(0, physics, 2);
    const middle = visibleCarouselRange(-50 * 260, physics, 2);
    const end = visibleCarouselRange(-99 * 260, physics, 2);
    expect(start.end - start.start + 1).toBeLessThanOrEqual(7);
    expect(middle.end - middle.start + 1).toBeLessThanOrEqual(7);
    expect(end.end - end.start + 1).toBeLessThanOrEqual(7);
    expect(middle).toEqual({ start: 48, end: 54 });
  });

  it('L3 任务切换栏只挂载视口行与两侧缓冲', () => {
    expect(visibleListRange(0, 520, 52, 100, 2)).toEqual({ start: 0, end: 11 });
    expect(visibleListRange(52 * 40, 520, 52, 100, 2)).toEqual({ start: 38, end: 51 });
    expect(visibleListRange(52 * 99, 520, 52, 100, 2)).toEqual({ start: 97, end: 99 });
    expect(visibleListRange(0, 520, 52, 0, 2)).toEqual({ start: 0, end: -1 });
  });
});
