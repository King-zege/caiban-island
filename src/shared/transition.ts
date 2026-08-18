import { TIMING } from './stateMachine';
import type { Rect, RenderMode } from './types';

export interface ShellTransform {
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
}

export function transitionDuration(renderMode: RenderMode): number {
  if (renderMode === 'composited') return TIMING.ANIMATION_MS;
  if (renderMode === 'software') return TIMING.SOFTWARE_ANIMATION_MS;
  return 0;
}

export function rectArea(rect: Rect): number {
  return rect.width * rect.height;
}

export function isExpanding(fromBounds: Rect, toBounds: Rect): boolean {
  return rectArea(toBounds) >= rectArea(fromBounds);
}

export function computeShellTransform(container: Rect, visual: Rect): ShellTransform {
  return {
    translateX: visual.x - container.x,
    translateY: visual.y - container.y,
    scaleX: visual.width / container.width,
    scaleY: visual.height / container.height
  };
}
