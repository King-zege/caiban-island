export interface CarouselPhysics {
  viewport: number;
  item: number;
  gap: number;
  count: number;
}

export interface CarouselVisibleRange {
  start: number;
  end: number;
}

export function computeMaxOffset(p: CarouselPhysics): number {
  if (p.count <= 0) return 0;
  const content = p.item * p.count + p.gap * (p.count - 1);
  return Math.max(0, content - p.viewport);
}

export function clampOffset(offset: number, p: CarouselPhysics): number {
  const max = computeMaxOffset(p);
  const r = Math.max(-max, Math.min(0, offset));
  return r + 0; // +0 消除 -0
}

export function cardIndexAt(offset: number, p: CarouselPhysics): number {
  const step = p.item + p.gap;
  if (step <= 0) return 0;
  return Math.round(-offset / step) + 0; // +0 消除 -0
}

export function snapOffset(offset: number, p: CarouselPhysics): number {
  const step = p.item + p.gap;
  const idx = cardIndexAt(offset, p);
  return clampOffset(-idx * step, p);
}

// 速度阈值（px/s）之上翻一页；松手后的惯性目标
export function snapOffsetWithVelocity(offset: number, velocity: number, p: CarouselPhysics): number {
  const step = p.item + p.gap;
  const v = velocity || 0;
  if (Math.abs(v) > 600) {
    const dir = v > 0 ? 1 : -1; // 往右滑（v>0）→ 前一张
    const idx = Math.max(0, Math.min(p.count - 1, cardIndexAt(offset, p) + dir));
    return clampOffset(-idx * step, p);
  }
  return snapOffset(offset, p);
}

export function decayVelocity(v: number, dtMs: number, friction = 0.0018): number {
  return v * Math.max(0, 1 - friction * dtMs);
}

export function visibleCarouselRange(offset: number, p: CarouselPhysics, overscan = 2): CarouselVisibleRange {
  if (p.count <= 0) return { start: 0, end: -1 };
  const step = p.item + p.gap;
  if (step <= 0) return { start: 0, end: Math.min(p.count - 1, overscan) };
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const scrollLeft = Math.max(0, -offset);
  const firstVisible = Math.max(0, Math.min(p.count - 1, Math.floor(scrollLeft / step)));
  const visibleWidth = Math.max(1, p.viewport);
  const lastVisible = Math.max(firstVisible, Math.min(p.count - 1, Math.floor((scrollLeft + visibleWidth - 1) / step)));
  return {
    start: Math.max(0, firstVisible - safeOverscan),
    end: Math.min(p.count - 1, lastVisible + safeOverscan)
  };
}
