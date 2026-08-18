export interface VisibleListRange {
  start: number;
  end: number;
}

export function visibleListRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  itemCount: number,
  overscan = 2
): VisibleListRange {
  if (itemCount <= 0) return { start: 0, end: -1 };
  const safeRowHeight = Math.max(1, rowHeight);
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const firstVisible = Math.max(0, Math.min(itemCount - 1, Math.floor(Math.max(0, scrollTop) / safeRowHeight)));
  const visibleRows = Math.max(1, Math.ceil(Math.max(1, viewportHeight) / safeRowHeight));
  return {
    start: Math.max(0, firstVisible - safeOverscan),
    end: Math.min(itemCount - 1, firstVisible + visibleRows - 1 + safeOverscan)
  };
}
