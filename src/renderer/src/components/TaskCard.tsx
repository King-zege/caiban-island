import {
  ArrowDown,
  Ban,
  Check,
  CheckCircle2,
  ChevronsUp,
  Circle,
  CircleDot,
  Clock3,
  ListChecks,
  MoreHorizontal,
  Play,
  Trash2,
  TriangleAlert
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FocusEventHandler } from 'react';
import { createPortal } from 'react-dom';
import type { NodeStatus, TaskCard as TaskCardData, TaskCardNode, Urgency } from '../../../shared/types';
import { formatUtcInTimeZone } from '../../../shared/time';
import { DESIGN_TOKENS } from '../../../shared/designTokens';

const URGENCY_LABEL: Record<Urgency, string> = { critical: '紧急', high: '高', normal: '普通', low: '低' };
const URGENCY_ICON = {
  critical: TriangleAlert,
  high: ChevronsUp,
  normal: CircleDot,
  low: ArrowDown
} satisfies Record<Urgency, typeof TriangleAlert>;

const NODE_STATUS_META = {
  pending: { label: '待完成', icon: Circle },
  in_progress: { label: '进行中', icon: Play },
  completed: { label: '已完成', icon: Check },
  cancelled: { label: '已取消', icon: Ban }
} satisfies Record<NodeStatus, { label: string; icon: typeof Circle }>;

const NODE_MENU_WIDTH = Number.parseFloat(DESIGN_TOKENS.dark.nodeMenuWidth);
const CONTROL_MIN = Number.parseFloat(DESIGN_TOKENS.dark.controlMin);
const VIEWPORT_GUTTER = Number.parseFloat(DESIGN_TOKENS.dark.space2);
const NODE_MENU_HEIGHT = CONTROL_MIN * 5 + Number.parseFloat(DESIGN_TOKENS.dark.space4);
const APP_OVERLAY_ROOT_SELECTOR = '[data-app-overlay-root="true"]';

export type TaskCardAction = 'complete' | 'cancel' | 'delete';

export function formatDeadline(deadlineUtc: string | null, tzId: string): string {
  if (!deadlineUtc) return '未设置截止时间';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tzId
    }).format(new Date(deadlineUtc));
  } catch {
    return deadlineUtc.slice(0, 10);
  }
}

export function formatOverdueDuration(deadlineUtc: string | null, now = Date.now()): string | null {
  if (!deadlineUtc) return null;
  const elapsed = now - Date.parse(deadlineUtc);
  if (!Number.isFinite(elapsed) || elapsed <= 0) return null;
  const hours = Math.max(1, Math.floor(elapsed / 3600000));
  if (hours < 24) return '已逾期 ' + hours + ' 小时';
  return '已逾期 ' + Math.floor(hours / 24) + ' 天';
}

export function visibleNodeWindow(nodes: TaskCardNode[], limit = 3): { nodes: TaskCardNode[]; currentId: string | null; hidden: number } {
  const ordered = [...nodes].sort((left, right) => left.position - right.position);
  if (ordered.length === 0) return { nodes: [], currentId: null, hidden: 0 };
  let currentIndex = ordered.findIndex((node) => node.status === 'in_progress');
  if (currentIndex < 0) currentIndex = ordered.findIndex((node) => node.status === 'pending');
  if (currentIndex < 0) currentIndex = ordered.length - 1;
  const safeLimit = Math.max(1, limit);
  const start = Math.max(0, Math.min(currentIndex - 1, ordered.length - safeLimit));
  return {
    nodes: ordered.slice(start, start + safeLimit),
    currentId: ordered[currentIndex]?.id ?? null,
    hidden: Math.max(0, ordered.length - safeLimit)
  };
}

interface TaskCardProps {
  card: TaskCardData;
  onOpen: () => void;
  onNodeStatus: (taskId: string, nodeId: string, status: NodeStatus) => Promise<void>;
  onNodeTime: (taskId: string, node: TaskCardNode) => void;
  onTaskAction: (action: TaskCardAction) => void;
  tabIndex?: number;
  onFocus?: FocusEventHandler<HTMLButtonElement>;
}

export default function TaskCard({ card, onOpen, onNodeStatus, onNodeTime, onTaskAction, tabIndex = 0, onFocus }: TaskCardProps): React.JSX.Element {
  const { task, progress, nodes, overdue } = card;
  const misc = task.kind === 'misc';
  const [busyNodeId, setBusyNodeId] = useState<string | null>(null);
  const [openNodeId, setOpenNodeId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const nodeTriggers = useRef(new Map<string, HTMLButtonElement>());
  const nodeMenu = useRef<HTMLDivElement | null>(null);
  const nodeWindow = useMemo(() => visibleNodeWindow(nodes), [nodes]);
  const progressText = progress.total === 0
    ? nodes.length === 0 ? '尚未拆分' : '无有效节点'
    : progress.done + '/' + progress.total + ' 已完成';
  const nextTitle = misc
    ? '处理这项杂事'
    : progress.nextTitle ?? (progress.total === 0 ? '添加新的采购节点' : '采购链路已完成');
  const UrgencyIcon = URGENCY_ICON[task.urgency];
  const deadline = formatDeadline(task.deadlineUtc, task.tzId);
  const overdueDuration = overdue ? formatOverdueDuration(task.deadlineUtc) : null;

  const a11y = [
    task.name,
    '下一步：' + nextTitle,
    '紧急程度：' + URGENCY_LABEL[task.urgency],
    deadline,
    overdueDuration ?? '',
    misc ? '杂事' : progressText
  ].filter(Boolean).join('，');

  const changeNodeStatus = async (nodeId: string, status: NodeStatus) => {
    closeNodeMenu();
    setBusyNodeId(nodeId);
    try {
      await onNodeStatus(task.id, nodeId, status);
    } finally {
      setBusyNodeId(null);
    }
  };

  useEffect(() => {
    if (!openNodeId) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (nodeMenu.current?.contains(target) || nodeTriggers.current.get(openNodeId)?.contains(target)) return;
      setOpenNodeId(null);
    };
    const closeOnResize = () => setOpenNodeId(null);
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('resize', closeOnResize);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('resize', closeOnResize);
    };
  }, [openNodeId]);

  useEffect(() => {
    if (!openNodeId) return;
    queueMicrotask(() => nodeMenu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
  }, [openNodeId]);

  const openNodeMenu = (nodeId: string) => {
    if (openNodeId === nodeId) {
      setOpenNodeId(null);
      return;
    }
    const trigger = nodeTriggers.current.get(nodeId);
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setMenuPosition({
      left: Math.max(VIEWPORT_GUTTER, Math.min(window.innerWidth - NODE_MENU_WIDTH - VIEWPORT_GUTTER, rect.left + rect.width / 2 - NODE_MENU_WIDTH / 2)),
      top: Math.max(VIEWPORT_GUTTER, Math.min(window.innerHeight - NODE_MENU_HEIGHT - VIEWPORT_GUTTER, rect.bottom + Number.parseFloat(DESIGN_TOKENS.dark.space1)))
    });
    setOpenNodeId(nodeId);
  };

  const closeNodeMenu = (restoreFocus = true) => {
    const nodeId = openNodeId;
    setOpenNodeId(null);
    if (restoreFocus && nodeId) queueMicrotask(() => nodeTriggers.current.get(nodeId)?.focus());
  };

  const handleMenuKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeNodeMenu();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(nodeMenu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else if (event.key === 'ArrowDown') next = (Math.max(0, current) + 1) % buttons.length;
    else next = current <= 0 ? buttons.length - 1 : current - 1;
    event.preventDefault();
    buttons[next]?.focus();
  };

  const chooseTaskAction = (event: React.MouseEvent<HTMLButtonElement>, action: TaskCardAction) => {
    event.currentTarget.closest('details')?.removeAttribute('open');
    onTaskAction(action);
  };

  return (
    <article className={'task-card urgency-' + task.urgency + (overdue ? ' overdue' : '')}>
      <button
        type="button"
        className="task-card-open"
        aria-label={a11y}
        data-carousel-card="true"
        data-task-id={task.id}
        tabIndex={tabIndex}
        onFocus={onFocus}
        onClick={onOpen}
      >
        <strong className="card-title" title={task.name}>{task.name}</strong>
        <span className="card-next" title={nextTitle}><span>下一步</span>{nextTitle}</span>
        <span className="card-meta">
          <span className={'urgency-label urgency-' + task.urgency}>
            <UrgencyIcon aria-hidden="true" size={14} strokeWidth={1.9} />
            {URGENCY_LABEL[task.urgency]}
          </span>
          <span className={overdue ? 'deadline-overdue' : 'deadline'}>
            <Clock3 aria-hidden="true" size={14} strokeWidth={1.8} />
            {overdueDuration ? overdueDuration + ' · ' : ''}{deadline}
          </span>
        </span>
      </button>

      <details className="card-task-menu" data-carousel-no-drag="true">
        <summary aria-label={'管理任务：' + task.name} role="button" title="任务操作"><MoreHorizontal aria-hidden="true" size={18} /></summary>
        <div className="card-task-menu-popover">
          <button type="button" onClick={(event) => chooseTaskAction(event, 'complete')}><CheckCircle2 aria-hidden="true" size={16} />完成并归档</button>
          <button type="button" onClick={(event) => chooseTaskAction(event, 'cancel')}><Ban aria-hidden="true" size={16} />取消并归档</button>
          <button type="button" className="danger" onClick={(event) => chooseTaskAction(event, 'delete')}><Trash2 aria-hidden="true" size={16} />永久删除</button>
        </div>
      </details>

      {!misc && (
        <div className="card-node-block">
          <div className={'card-node-axis count-' + nodeWindow.nodes.length} aria-label="采购节点速览">
            {nodeWindow.nodes.map((node) => {
              const meta = NODE_STATUS_META[node.status];
              const StatusIcon = meta.icon;
              return (
                <button
                  key={node.id}
                  type="button"
                  className={'card-node-control status-' + node.status + (node.id === nodeWindow.currentId ? ' current' : '')}
                  data-carousel-no-drag="true"
                  data-node-id={node.id}
                  title={node.title + ' · ' + meta.label}
                  aria-label={node.title + '，' + meta.label + (node.startUtc ? '，已设置提醒时间' : '')}
                  aria-haspopup="menu"
                  aria-expanded={openNodeId === node.id}
                  disabled={busyNodeId === node.id}
                  ref={(element) => {
                    if (element) nodeTriggers.current.set(node.id, element);
                    else nodeTriggers.current.delete(node.id);
                  }}
                  onClick={(event) => { event.stopPropagation(); openNodeMenu(node.id); }}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowDown') return;
                    event.preventDefault();
                    openNodeMenu(node.id);
                  }}
                >
                  <span className="card-node-marker"><StatusIcon aria-hidden="true" size={12} strokeWidth={2} /></span>
                  <span className="card-node-title">{node.title}{node.startUtc && <Clock3 aria-label="已设置提醒时间" size={11} strokeWidth={1.8} />}</span>
                </button>
              );
            })}
          </div>
          <span className="card-progress-text">
            <ListChecks aria-hidden="true" size={13} strokeWidth={1.8} />
            {progressText}{nodeWindow.hidden > 0 ? ' · 另 ' + nodeWindow.hidden + ' 项' : ''}
          </span>
        </div>
      )}
      {openNodeId && (() => {
        const node = nodeWindow.nodes.find((item) => item.id === openNodeId);
        if (!node) return null;
        const inactive = node.status === 'completed' || node.status === 'cancelled';
        const timeText = formatUtcInTimeZone(node.startUtc, task.tzId);
        const overlayRoot = document.querySelector<HTMLElement>(APP_OVERLAY_ROOT_SELECTOR) ?? document.body;
        return createPortal(
          <div
            ref={nodeMenu}
            className="card-node-menu-popover"
            role="menu"
            aria-label={'操作节点：' + node.title}
            data-carousel-no-drag="true"
            style={menuPosition}
            onKeyDown={handleMenuKeys}
          >
            {(Object.keys(NODE_STATUS_META) as NodeStatus[]).map((status) => {
              const option = NODE_STATUS_META[status];
              const OptionIcon = option.icon;
              return (
                <button
                  key={status}
                  type="button"
                  role="menuitemradio"
                  aria-checked={node.status === status}
                  onClick={() => {
                    if (node.status === status) {
                      closeNodeMenu();
                      return;
                    }
                    void changeNodeStatus(node.id, status);
                  }}
                >
                  <OptionIcon aria-hidden="true" size={16} />
                  <span>{option.label}</span>
                  {node.status === status && <Check aria-hidden="true" className="menu-check" size={15} />}
                </button>
              );
            })}
            <span className="card-node-menu-rule" />
            <button
              type="button"
              role="menuitem"
              disabled={inactive}
              title={inactive ? '恢复为待完成或进行中后可设置' : undefined}
              onClick={() => {
                closeNodeMenu();
                queueMicrotask(() => onNodeTime(task.id, node));
              }}
            >
              <Clock3 aria-hidden="true" size={16} />
              <span className="node-time-menu-copy">
                <strong>{node.startUtc ? '修改提醒时间' : '设置提醒时间'}</strong>
                <small>{inactive ? '恢复节点后可设置' : timeText ?? '到节点开始时通知'}</small>
              </span>
            </button>
          </div>,
          overlayRoot
        );
      })()}
    </article>
  );
}
