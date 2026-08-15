import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { clampOffset, computeMaxOffset, decayVelocity, snapOffset, snapOffsetWithVelocity } from '../../../shared/carousel';

interface CarouselProps {
  itemWidth: number;
  gap: number;
  children: ReactNode[];
  onCardClick?: (index: number) => void;
}

export default function Carousel({ itemWidth, gap, children, onCardClick }: CarouselProps): React.JSX.Element {
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

  const physics = { viewport, item: itemWidth, gap, count: children.length };

  const stopAnim = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const animateTo = useCallback((from: number, to: number, duration = 260) => {
    stopAnim();
    const t0 = performance.now();
    const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      setOffset(Math.round(from + (to - from) * easeOutCubic(p)));
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(step);
  }, []);

  const inertia = useCallback(
    (start: number, velocity: number) => {
      stopAnim();
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
    [animateTo, physics]
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
    // 位移极小视为点击（选择卡片）
    if (d.totalMove < 10 && onCardClick) {
      onCardClick(Math.max(0, Math.min(children.length - 1, Math.round(-offset / (itemWidth + gap)))));
      return;
    }
    const target = snapOffsetWithVelocity(offset, d.v, physics);
    if (Math.abs(d.v) > 900) inertia(offset, d.v * 0.5);
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
      setOffset(next);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => animateTo(next, snapOffset(next, physics), 200), 140);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
    };
  }, [offset, animateTo, physics]);

  const maxOffset = computeMaxOffset(physics);
  const canScroll = maxOffset > 0;

  return (
    <div className={'carousel' + (canScroll ? ' scrollable' : '')} ref={viewportRef}>
      <div
        className="carousel-track"
        style={{ transform: 'translateX(' + offset + 'px)', gap: gap + 'px' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {children}
      </div>
    </div>
  );
}
