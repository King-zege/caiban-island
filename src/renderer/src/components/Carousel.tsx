import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { clampOffset, computeMaxOffset, decayVelocity, snapOffset, snapOffsetWithVelocity } from '../../../shared/carousel';

interface CarouselProps {
  itemWidth: number;
  gap: number;
  children: ReactNode[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  reducedMotion?: boolean;
}

export default function Carousel({ itemWidth, gap, children, activeIndex, onActiveIndexChange, reducedMotion = false }: CarouselProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);
  const [viewport, setViewport] = useState(0);
  const drag = useRef<{
    startX: number;
    startOffset: number;
    lastX: number;
    lastT: number;
    v: number;
    totalMove: number;
  } | null>(null);
  const rafRef = useRef<number | null>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);

  const physics = useMemo(() => ({ viewport, item: itemWidth, gap, count: children.length }), [children.length, gap, itemWidth, viewport]);

  const stopAnim = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  useEffect(() => () => stopAnim(), []);

  const animateTo = useCallback((from: number, to: number, duration = 260) => {
    stopAnim();
    if (reducedMotion) {
      setOffset(to);
      return;
    }
    const t0 = performance.now();
    const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      setOffset(Math.round(from + (to - from) * easeOutCubic(p)));
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(step);
  }, [reducedMotion]);

  const inertia = useCallback(
    (start: number, velocity: number) => {
      stopAnim();
      if (reducedMotion) {
        setOffset(snapOffsetWithVelocity(start, velocity, physics));
        return;
      }
      let off = start;
      let v = velocity;
      let last = performance.now();
      const step = (now: number) => {
        const dt = Math.min(64, now - last);
        last = now;
        off = clampOffset(off + v * (dt / 1000), physics);
        v = decayVelocity(v, dt);
        setOffset(Math.round(off));
        if (Math.abs(v) > 8) {
          rafRef.current = requestAnimationFrame(step);
        } else {
          rafRef.current = null;
          animateTo(off, snapOffset(off, physics), 200);
        }
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [animateTo, physics, reducedMotion]
  );

  const onPointerDown = (e: React.PointerEvent) => {
    stopAnim();
    if (wheelTimer.current) clearTimeout(wheelTimer.current);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startOffset: offset, lastX: e.clientX, lastT: performance.now(), v: 0, totalMove: 0 };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const now = performance.now();
    const dx = e.clientX - d.lastX;
    const dt = Math.max(8, now - d.lastT);
    d.v = (dx / dt) * 1000 * 0.6 + d.v * 0.4;
    d.lastX = e.clientX;
    d.lastT = now;
    d.totalMove += Math.abs(e.clientX - d.startX);
    setOffset(clampOffset(d.startOffset + (e.clientX - d.startX), physics));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // 忽略释放失败
    }
    suppressClick.current = d.totalMove >= 10;
    if (d.totalMove < 10) return;
    const target = snapOffsetWithVelocity(offset, d.v, physics);
    if (reducedMotion) setOffset(target);
    else if (Math.abs(d.v) > 900) inertia(offset, d.v * 0.5);
    else animateTo(offset, target, 240);
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => setViewport(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopAnim();
      const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      const next = clampOffset(offset - delta, physics);
      setOffset(reducedMotion ? snapOffset(next, physics) : next);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      if (!reducedMotion) wheelTimer.current = setTimeout(() => animateTo(next, snapOffset(next, physics), 200), 140);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
    };
  }, [offset, animateTo, physics, reducedMotion]);

  const maxOffset = computeMaxOffset(physics);
  const canScroll = maxOffset > 0;

  const focusCard = (index: number) => {
    const next = Math.max(0, Math.min(children.length - 1, index));
    onActiveIndexChange(next);
    const target = clampOffset(-next * (itemWidth + gap), physics);
    animateTo(offset, target, 200);
    const focus = () => {
      const cards = viewportRef.current?.querySelectorAll<HTMLButtonElement>('[data-carousel-card="true"]');
      cards?.[next]?.focus();
    };
    if (reducedMotion) queueMicrotask(focus);
    else requestAnimationFrame(focus);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement) || event.target.dataset['carouselCard'] !== 'true') return;
    if (event.key === 'ArrowRight') focusCard(activeIndex + 1);
    else if (event.key === 'ArrowLeft') focusCard(activeIndex - 1);
    else if (event.key === 'Home') focusCard(0);
    else if (event.key === 'End') focusCard(children.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <div className={'carousel' + (canScroll ? ' scrollable' : '')} ref={viewportRef} onKeyDown={onKeyDown} aria-label="活跃采购任务">
      <div
        className="carousel-track"
        style={{ transform: 'translateX(' + offset + 'px)', gap: gap + 'px' }}
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
        {children}
      </div>
    </div>
  );
}
