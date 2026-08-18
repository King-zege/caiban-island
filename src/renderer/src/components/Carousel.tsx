import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  cardIndexAt,
  clampOffset,
  computeMaxOffset,
  decayVelocity,
  snapOffset,
  snapOffsetWithVelocity,
  visibleCarouselRange
} from '../../../shared/carousel';

interface CarouselProps {
  itemWidth: number;
  gap: number;
  itemCount: number;
  renderItem: (index: number) => ReactNode;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  reducedMotion?: boolean;
  overscan?: number;
  renderLimit?: number;
}

export default function Carousel({
  itemWidth,
  gap,
  itemCount,
  renderItem,
  activeIndex,
  onActiveIndexChange,
  reducedMotion = false,
  overscan = 2,
  renderLimit = Number.POSITIVE_INFINITY
}: CarouselProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0);
  const [viewport, setViewport] = useState(0);
  const drag = useRef<{ startX: number; startOffset: number; lastX: number; lastT: number; v: number; totalMove: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFocus = useRef<number | null>(null);
  const suppressClick = useRef(false);

  const physics = useMemo(() => ({ viewport, item: itemWidth, gap, count: itemCount }), [gap, itemCount, itemWidth, viewport]);
  const range = useMemo(() => visibleCarouselRange(offset, physics, overscan), [offset, overscan, physics]);
  const totalWidth = itemCount <= 0 ? 0 : itemWidth * itemCount + gap * (itemCount - 1);

  const updateOffset = (value: number) => {
    offsetRef.current = value;
    setOffset(value);
  };

  const stopAnim = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  useEffect(() => () => stopAnim(), []);

  useEffect(() => {
    const next = clampOffset(offsetRef.current, physics);
    if (next !== offsetRef.current) updateOffset(next);
  }, [physics]);

  useEffect(() => {
    const index = pendingFocus.current;
    if (index === null || index < range.start || index > range.end) return;
    const card = viewportRef.current?.querySelector<HTMLButtonElement>(`[data-carousel-index="${index}"] [data-carousel-card="true"]`);
    if (!card) return;
    pendingFocus.current = null;
    card.focus();
  }, [activeIndex, range.end, range.start]);

  const animateTo = useCallback((from: number, to: number, duration = 260, onDone?: () => void) => {
    stopAnim();
    if (reducedMotion) {
      updateOffset(to);
      onDone?.();
      return;
    }
    const startedAt = performance.now();
    const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      updateOffset(Math.round(from + (to - from) * easeOutCubic(progress)));
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
      else {
        rafRef.current = null;
        onDone?.();
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }, [reducedMotion]);

  const focusCard = (index: number) => {
    const next = Math.max(0, Math.min(itemCount - 1, index));
    if (itemCount <= 0) return;
    pendingFocus.current = next;
    onActiveIndexChange(next);
    const target = clampOffset(-next * (itemWidth + gap), physics);
    animateTo(offsetRef.current, target, 200, () => updateOffset(target));
  };

  const inertia = useCallback((start: number, velocity: number) => {
    stopAnim();
    if (reducedMotion) {
      const target = snapOffsetWithVelocity(start, velocity, physics);
      updateOffset(target);
      onActiveIndexChange(cardIndexAt(target, physics));
      return;
    }
    let currentOffset = start;
    let currentVelocity = velocity;
    let previous = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(64, now - previous);
      previous = now;
      currentOffset = clampOffset(currentOffset + currentVelocity * (elapsed / 1000), physics);
      currentVelocity = decayVelocity(currentVelocity, elapsed);
      updateOffset(Math.round(currentOffset));
      if (Math.abs(currentVelocity) > 8) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
        const target = snapOffset(currentOffset, physics);
        onActiveIndexChange(cardIndexAt(target, physics));
        animateTo(currentOffset, target, 200);
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }, [animateTo, onActiveIndexChange, physics, reducedMotion]);

  const onPointerDown = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('[data-carousel-no-drag="true"]')) return;
    stopAnim();
    if (wheelTimer.current) clearTimeout(wheelTimer.current);
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startOffset: offsetRef.current, lastX: event.clientX, lastT: performance.now(), v: 0, totalMove: 0 };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const state = drag.current;
    if (!state) return;
    const now = performance.now();
    const dx = event.clientX - state.lastX;
    const elapsed = Math.max(8, now - state.lastT);
    state.v = (dx / elapsed) * 1000 * 0.6 + state.v * 0.4;
    state.lastX = event.clientX;
    state.lastT = now;
    state.totalMove += Math.abs(event.clientX - state.startX);
    updateOffset(clampOffset(state.startOffset + (event.clientX - state.startX), physics));
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const state = drag.current;
    drag.current = null;
    if (!state) return;
    try { (event.target as HTMLElement).releasePointerCapture(event.pointerId); } catch { /* capture may already be released */ }
    suppressClick.current = state.totalMove >= 10;
    if (state.totalMove < 10) return;
    const target = snapOffsetWithVelocity(offsetRef.current, state.v, physics);
    onActiveIndexChange(cardIndexAt(target, physics));
    if (reducedMotion) updateOffset(target);
    else if (Math.abs(state.v) > 900) inertia(offsetRef.current, state.v * 0.5);
    else animateTo(offsetRef.current, target, 240);
  };

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const updateViewport = () => setViewport(element.clientWidth);
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      stopAnim();
      const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY;
      const next = clampOffset(offsetRef.current - delta, physics);
      updateOffset(reducedMotion ? snapOffset(next, physics) : next);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      const settle = () => {
        const target = snapOffset(offsetRef.current, physics);
        onActiveIndexChange(cardIndexAt(target, physics));
        animateTo(offsetRef.current, target, 200);
      };
      if (reducedMotion) settle();
      else wheelTimer.current = setTimeout(settle, 140);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', onWheel);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
    };
  }, [animateTo, onActiveIndexChange, physics, reducedMotion]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement) || event.target.dataset['carouselCard'] !== 'true') return;
    if (event.key === 'ArrowRight') focusCard(activeIndex + 1);
    else if (event.key === 'ArrowLeft') focusCard(activeIndex - 1);
    else if (event.key === 'Home') focusCard(0);
    else if (event.key === 'End') focusCard(itemCount - 1);
    else return;
    event.preventDefault();
  };

  const rendered: ReactNode[] = [];
  const renderedEnd = Math.min(range.end, range.start + Math.max(1, Math.floor(renderLimit)) - 1);
  for (let index = range.start; index <= renderedEnd; index += 1) {
    rendered.push(
      <div
        key={index}
        className="carousel-item"
        data-carousel-index={index}
        role="group"
        aria-posinset={index + 1}
        aria-setsize={itemCount}
        style={{ left: index * (itemWidth + gap) + 'px', width: itemWidth + 'px' }}
      >
        {renderItem(index)}
      </div>
    );
  }

  return (
    <div className={'carousel' + (computeMaxOffset(physics) > 0 ? ' scrollable' : '')} ref={viewportRef} onKeyDown={onKeyDown} aria-label="活跃采购任务">
      <div
        className="carousel-track"
        style={{ transform: 'translate3d(' + offset + 'px, 0, 0)', width: totalWidth + 'px' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(event) => {
          if (!suppressClick.current) return;
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }}
      >
        {rendered}
      </div>
    </div>
  );
}
