import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { TaskCard } from '../../../shared/types';
import type { ContractCard } from '../../../shared/contractContracts';
import { CONTRACT_ACTION_LABELS } from '../../../shared/contractContracts';
import { DESIGN_TOKENS } from '../../../shared/designTokens';
import { visibleListRange } from '../../../shared/virtualization';
import { formatUtcInTimeZone } from '../../../shared/time';

const ROW_HEIGHT = Number.parseFloat(DESIGN_TOKENS.dark.taskSwitcherRow);

interface VirtualTaskSwitcherProps {
  tasks: TaskCard[];
  contracts?: ContractCard[];
  selectedTaskId: string | null;
  selectedContractId?: string | null;
  active: boolean;
  contractsActive?: boolean;
  onSelect: (taskId: string) => void;
  onSelectContract?: (contractId: string) => void;
}

export default function VirtualTaskSwitcher({ tasks, contracts = [], selectedTaskId, selectedContractId = null, active, contractsActive = false, onSelect, onSelectContract }: VirtualTaskSwitcherProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const groupedRows = useMemo(() => {
    const projects = tasks.filter((card) => card.task.kind !== 'misc');
    const misc = tasks.filter((card) => card.task.kind === 'misc');
    const rows: Array<
      { type: 'header'; key: string; label: string; count: number }
      | { type: 'task'; key: string; card: TaskCard }
      | { type: 'contract'; key: string; card: ContractCard }
    > = [];
    if (projects.length > 0) {
      rows.push({ type: 'header', key: 'project-header', label: '采购项目', count: projects.length });
      rows.push(...projects.map((card) => ({ type: 'task' as const, key: card.task.id, card })));
    }
    if (contracts.length > 0) {
      rows.push({ type: 'header', key: 'contract-header', label: '合同', count: contracts.length });
      rows.push(...contracts.map((card) => ({ type: 'contract' as const, key: card.contract.id, card })));
    }
    if (misc.length > 0) {
      rows.push({ type: 'header', key: 'misc-header', label: '杂事', count: misc.length });
      rows.push(...misc.map((card) => ({ type: 'task' as const, key: card.task.id, card })));
    }
    return rows;
  }, [contracts, tasks]);
  const range = useMemo(
    () => visibleListRange(scrollTop, viewportHeight, ROW_HEIGHT, groupedRows.length),
    [groupedRows.length, scrollTop, viewportHeight]
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
    const selectedIndex = groupedRows.findIndex((row) => (row.type === 'task' && active && row.card.task.id === selectedTaskId)
      || (row.type === 'contract' && contractsActive && row.card.contract.id === selectedContractId));
    if (!viewport || selectedIndex < 0) return;
    const top = selectedIndex * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < viewport.scrollTop || bottom > viewport.scrollTop + viewport.clientHeight) {
      let groupHeaderIndex = selectedIndex - 1;
      while (groupHeaderIndex >= 0 && groupedRows[groupHeaderIndex].type !== 'header') groupHeaderIndex -= 1;
      const groupSelectionHeight = (selectedIndex - groupHeaderIndex + 1) * ROW_HEIGHT;
      viewport.scrollTop = groupHeaderIndex >= 0 && groupSelectionHeight <= viewport.clientHeight
        ? groupHeaderIndex * ROW_HEIGHT
        : top;
    }
  }, [active, contractsActive, groupedRows, selectedContractId, selectedTaskId]);

  if (tasks.length === 0 && contracts.length === 0) return <p className="task-switcher-empty">没有匹配的工作项</p>;

  const rows: React.JSX.Element[] = [];
  for (let index = range.start; index <= range.end; index += 1) {
    const row = groupedRows[index];
    if (row.type === 'header') {
      rows.push(<div key={row.key} className="task-switcher-group" style={{ top: index * ROW_HEIGHT + 'px' }}><strong>{row.label}</strong><span>{row.count}</span></div>);
      continue;
    }
    if (row.type === 'contract') {
      const card = row.card;
      rows.push(
        <button
          key={card.contract.id}
          type="button"
          className={contractsActive && selectedContractId === card.contract.id ? 'active contract-switcher-row' : 'contract-switcher-row'}
          aria-current={contractsActive && selectedContractId === card.contract.id ? 'page' : undefined}
          style={{ top: index * ROW_HEIGHT + 'px' }}
          onClick={() => onSelectContract?.(card.contract.id)}
        >
          <span className={'task-indicator contract risk-' + card.risk} aria-hidden="true" />
          <span><strong>{card.contract.shortName}</strong><small>{card.nextAction
            ? `${CONTRACT_ACTION_LABELS[card.nextAction.type]} · ${card.nextAction.title}`
            : `${card.contract.supplierName} · 暂无待办`}</small></span>
        </button>
      );
      continue;
    }
    const card = row.card;
    rows.push(
      <button
        key={card.task.id}
        type="button"
        className={active && selectedTaskId === card.task.id ? 'active' : ''}
        aria-current={active && selectedTaskId === card.task.id ? 'page' : undefined}
        style={{ top: index * ROW_HEIGHT + 'px' }}
        onClick={() => onSelect(card.task.id)}
      >
        <span className={card.task.kind === 'misc' ? 'task-indicator misc' : 'task-indicator urgency-' + card.task.urgency} aria-hidden="true" />
        <span><strong>{card.task.name}</strong><small>{card.task.kind === 'misc'
          ? formatUtcInTimeZone(card.task.remindAtUtc, card.task.tzId) ?? '无提醒'
          : card.progress.nextTitle ?? (card.progress.total === 0 ? '待拆分采购节点' : '采购链路已完成')}</small></span>
      </button>
    );
  }

  return (
    <div
      ref={viewportRef}
      className="task-switcher"
      role="navigation"
      aria-label="活跃任务"
      style={{ '--task-switcher-clip': viewportHeight % ROW_HEIGHT + 'px' } as CSSProperties}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="task-switcher-track" style={{ height: groupedRows.length * ROW_HEIGHT + 'px' }}>
        {rows}
      </div>
    </div>
  );
}
