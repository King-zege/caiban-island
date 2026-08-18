import { useEffect, useMemo, useRef, useState } from 'react';
import type { TaskCard } from '../../../shared/types';
import { DESIGN_TOKENS } from '../../../shared/designTokens';
import { visibleListRange } from '../../../shared/virtualization';

const ROW_HEIGHT = Number.parseFloat(DESIGN_TOKENS.dark.taskSwitcherRow);

interface VirtualTaskSwitcherProps {
  tasks: TaskCard[];
  selectedTaskId: string | null;
  active: boolean;
  onSelect: (taskId: string) => void;
}

export default function VirtualTaskSwitcher({ tasks, selectedTaskId, active, onSelect }: VirtualTaskSwitcherProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const range = useMemo(
    () => visibleListRange(scrollTop, viewportHeight, ROW_HEIGHT, tasks.length),
    [scrollTop, tasks.length, viewportHeight]
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => setViewportHeight(viewport.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    const selectedIndex = tasks.findIndex((card) => card.task.id === selectedTaskId);
    if (!viewport || selectedIndex < 0) return;
    const top = selectedIndex * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (bottom > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = Math.max(0, bottom - viewport.clientHeight);
  }, [selectedTaskId, tasks]);

  if (tasks.length === 0) return <p className="task-switcher-empty">没有匹配的任务</p>;

  const rows: React.JSX.Element[] = [];
  for (let index = range.start; index <= range.end; index += 1) {
    const card = tasks[index];
    rows.push(
      <button
        key={card.task.id}
        type="button"
        className={active && selectedTaskId === card.task.id ? 'active' : ''}
        aria-current={active && selectedTaskId === card.task.id ? 'page' : undefined}
        aria-posinset={index + 1}
        aria-setsize={tasks.length}
        style={{ top: index * ROW_HEIGHT + 'px' }}
        onClick={() => onSelect(card.task.id)}
      >
        <span className={'task-indicator urgency-' + card.task.urgency} aria-hidden="true" />
        <span><strong>{card.task.name}</strong><small>{card.progress.nextTitle ?? (card.progress.total === 0 ? '待拆分采购节点' : '采购链路已完成')}</small></span>
      </button>
    );
  }

  return (
    <div ref={viewportRef} className="task-switcher" role="navigation" aria-label="活跃任务" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <div className="task-switcher-track" style={{ height: tasks.length * ROW_HEIGHT + 'px' }}>
        {rows}
      </div>
    </div>
  );
}
