import {
  ArrowDown,
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronsUp,
  Circle,
  CircleDot,
  Clock3,
  File,
  Link2,
  ListChecks,
  Paperclip,
  Pencil,
  Play,
  RotateCw,
  Trash2,
  TriangleAlert
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FocusEventHandler } from 'react';
import { createPortal } from 'react-dom';
import { URGENCIES } from '../../../shared/types';
import type { NodeStatus, TaskCard as TaskCardData, TaskCardNode, TaskLink, TaskUrgencyUpdateRequest, Urgency } from '../../../shared/types';
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
const TASK_MENU_WIDTH = Number.parseFloat(DESIGN_TOKENS.dark.taskMenuWidth);
const TASK_MENU_MAX_HEIGHT = Number.parseFloat(DESIGN_TOKENS.dark.taskMenuMaxHeight);
const CONTROL_MIN = Number.parseFloat(DESIGN_TOKENS.dark.controlMin);
const VIEWPORT_GUTTER = Number.parseFloat(DESIGN_TOKENS.dark.space2);
const NODE_MENU_HEIGHT = CONTROL_MIN * 6 + Number.parseFloat(DESIGN_TOKENS.dark.space4);
const URGENCY_MENU_HEIGHT = CONTROL_MIN * 4 + Number.parseFloat(DESIGN_TOKENS.dark.space2);
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
  onUrgencyChange: (request: TaskUrgencyUpdateRequest) => Promise<void>;
  onNodeStatus: (taskId: string, nodeId: string, status: NodeStatus) => Promise<void>;
  onNodeTime: (taskId: string, node: TaskCardNode) => void;
  onLoadMaterials?: (taskId: string) => Promise<{ links: TaskLink[]; error: string | null }>;
  onOpenMaterial?: (link: TaskLink) => void;
  onRenameTask?: () => void;
  onRenameNode?: (node: TaskCardNode) => void;
  onTaskAction: (action: TaskCardAction) => void;
  tabIndex?: number;
  onFocus?: FocusEventHandler<HTMLButtonElement>;
}

export default function TaskCard({ card, onOpen, onUrgencyChange, onNodeStatus, onNodeTime, onLoadMaterials, onOpenMaterial, onRenameTask, onRenameNode, onTaskAction, tabIndex = 0, onFocus }: TaskCardProps): React.JSX.Element {
  const { task, progress, nodes, overdue } = card;
  const misc = task.kind === 'misc';
  const [busyNodeId, setBusyNodeId] = useState<string | null>(null);
  const [urgencyBusy, setUrgencyBusy] = useState(false);
  const [urgencyMenuOpen, setUrgencyMenuOpen] = useState(false);
  const [taskMenuOpen, setTaskMenuOpen] = useState(false);
  const [taskMenuLoading, setTaskMenuLoading] = useState(false);
  const [taskMenuError, setTaskMenuError] = useState<string | null>(null);
  const [taskLinks, setTaskLinks] = useState<TaskLink[] | null>(null);
  const [openNodeId, setOpenNodeId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const nodeTriggers = useRef(new Map<string, HTMLButtonElement>());
  const nodeMenu = useRef<HTMLDivElement | null>(null);
  const urgencyTrigger = useRef<HTMLButtonElement | null>(null);
  const urgencyMenu = useRef<HTMLDivElement | null>(null);
  const taskMenuTrigger = useRef<HTMLButtonElement | null>(null);
  const taskMenu = useRef<HTMLDivElement | null>(null);
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
    if (!openNodeId && !urgencyMenuOpen && !taskMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (nodeMenu.current?.contains(target) || (openNodeId && nodeTriggers.current.get(openNodeId)?.contains(target))) return;
      if (urgencyMenu.current?.contains(target) || urgencyTrigger.current?.contains(target)) return;
      if (taskMenu.current?.contains(target) || taskMenuTrigger.current?.contains(target)) return;
      setOpenNodeId(null);
      setUrgencyMenuOpen(false);
      setTaskMenuOpen(false);
    };
    const closeOnResize = () => {
      setOpenNodeId(null);
      setUrgencyMenuOpen(false);
      setTaskMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('resize', closeOnResize);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('resize', closeOnResize);
    };
  }, [openNodeId, taskMenuOpen, urgencyMenuOpen]);

  useEffect(() => {
    if (!openNodeId) return;
    queueMicrotask(() => nodeMenu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
  }, [openNodeId]);

  useEffect(() => {
    if (!urgencyMenuOpen) return;
    queueMicrotask(() => urgencyMenu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
  }, [urgencyMenuOpen]);

  useEffect(() => {
    if (!taskMenuOpen || taskMenuLoading) return;
    queueMicrotask(() => taskMenu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
  }, [taskMenuLoading, taskMenuOpen]);

  const positionMenu = (trigger: HTMLButtonElement, width: number, height: number) => {
    const rect = trigger.getBoundingClientRect();
    setMenuPosition({
      left: Math.max(VIEWPORT_GUTTER, Math.min(window.innerWidth - width - VIEWPORT_GUTTER, rect.left + rect.width / 2 - width / 2)),
      top: Math.max(VIEWPORT_GUTTER, Math.min(window.innerHeight - height - VIEWPORT_GUTTER, rect.bottom + Number.parseFloat(DESIGN_TOKENS.dark.space1)))
    });
  };

  const openNodeMenu = (nodeId: string) => {
    if (openNodeId === nodeId) {
      setOpenNodeId(null);
      return;
    }
    const trigger = nodeTriggers.current.get(nodeId);
    if (!trigger) return;
    setUrgencyMenuOpen(false);
    setTaskMenuOpen(false);
    positionMenu(trigger, NODE_MENU_WIDTH, NODE_MENU_HEIGHT);
    setOpenNodeId(nodeId);
  };

  const openUrgencyMenu = () => {
    if (urgencyMenuOpen) {
      setUrgencyMenuOpen(false);
      return;
    }
    if (!urgencyTrigger.current) return;
    setOpenNodeId(null);
    setTaskMenuOpen(false);
    positionMenu(urgencyTrigger.current, NODE_MENU_WIDTH, URGENCY_MENU_HEIGHT);
    setUrgencyMenuOpen(true);
  };

  const loadMaterials = async () => {
    setTaskMenuLoading(true);
    setTaskMenuError(null);
    const result = onLoadMaterials
      ? await onLoadMaterials(task.id)
      : { links: [], error: null };
    setTaskMenuLoading(false);
    setTaskLinks(result.links);
    setTaskMenuError(result.error);
  };

  const openTaskMenu = () => {
    if (taskMenuOpen) {
      setTaskMenuOpen(false);
      return;
    }
    if (!taskMenuTrigger.current) return;
    setOpenNodeId(null);
    setUrgencyMenuOpen(false);
    positionMenu(taskMenuTrigger.current, TASK_MENU_WIDTH, TASK_MENU_MAX_HEIGHT);
    setTaskMenuOpen(true);
    if (taskLinks === null) void loadMaterials();
  };

  const closeNodeMenu = (restoreFocus = true) => {
    const nodeId = openNodeId;
    setOpenNodeId(null);
    if (restoreFocus && nodeId) queueMicrotask(() => nodeTriggers.current.get(nodeId)?.focus());
  };

  const closeUrgencyMenu = (restoreFocus = true) => {
    setUrgencyMenuOpen(false);
    if (restoreFocus) queueMicrotask(() => urgencyTrigger.current?.focus());
  };

  const closeTaskMenu = (restoreFocus = true) => {
    setTaskMenuOpen(false);
    if (restoreFocus) queueMicrotask(() => taskMenuTrigger.current?.focus());
  };

  const moveMenuFocus = (
    event: React.KeyboardEvent<HTMLDivElement>,
    menu: HTMLDivElement | null,
    close: () => void
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else if (event.key === 'ArrowDown') next = (Math.max(0, current) + 1) % buttons.length;
    else next = current <= 0 ? buttons.length - 1 : current - 1;
    event.preventDefault();
    event.stopPropagation();
    buttons[next]?.focus();
  };

  const handleMenuKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    moveMenuFocus(event, nodeMenu.current, closeNodeMenu);
  };

  const changeUrgency = async (urgency: Urgency) => {
    if (urgency === task.urgency) {
      closeUrgencyMenu();
      return;
    }
    const request: TaskUrgencyUpdateRequest = {
      taskId: task.id,
      urgency,
      expectedUrgency: task.urgency
    };
    closeUrgencyMenu();
    setUrgencyBusy(true);
    try {
      await onUrgencyChange(request);
    } finally {
      setUrgencyBusy(false);
    }
  };

  const chooseTaskAction = (action: TaskCardAction) => {
    closeTaskMenu(false);
    onTaskAction(action);
  };

  return (
    <article className={'task-card urgency-' + task.urgency + (overdue ? ' overdue' : '')}>
      <div className="task-card-summary">
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
        </button>
        <span className="card-meta">
          <button
            ref={urgencyTrigger}
            type="button"
            className={'card-urgency-button urgency-label urgency-' + task.urgency}
            data-carousel-no-drag="true"
            aria-label={'调整任务紧急程度，当前为' + URGENCY_LABEL[task.urgency]}
            aria-haspopup="menu"
            aria-expanded={urgencyMenuOpen}
            disabled={urgencyBusy}
            onClick={(event) => { event.stopPropagation(); openUrgencyMenu(); }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return;
              event.preventDefault();
              openUrgencyMenu();
            }}
          >
            <UrgencyIcon aria-hidden="true" size={14} strokeWidth={1.9} />
            {URGENCY_LABEL[task.urgency]}
            <ChevronDown aria-hidden="true" size={12} strokeWidth={1.9} />
          </button>
          <span className={overdue ? 'deadline-overdue' : 'deadline'}>
            <Clock3 aria-hidden="true" size={14} strokeWidth={1.8} />
            <span className="deadline-text">{overdueDuration ? overdueDuration + ' · ' : ''}{deadline}</span>
          </span>
        </span>
      </div>

      <button
        ref={taskMenuTrigger}
        type="button"
        className="card-task-menu-trigger"
        data-carousel-no-drag="true"
        aria-label={'展开任务资料与操作：' + task.name}
        aria-haspopup="menu"
        aria-expanded={taskMenuOpen}
        title="资料与任务操作"
        onClick={(event) => { event.stopPropagation(); openTaskMenu(); }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          openTaskMenu();
        }}
      >
        <Paperclip aria-hidden="true" size={17} />
        <ChevronDown aria-hidden="true" size={11} />
      </button>

      {taskMenuOpen && (() => {
        const overlayRoot = document.querySelector<HTMLElement>(APP_OVERLAY_ROOT_SELECTOR) ?? document.body;
        return createPortal(
          <div
            ref={taskMenu}
            className="card-task-menu-popover"
            role="menu"
            aria-label={'任务资料与操作：' + task.name}
            data-carousel-no-drag="true"
            style={menuPosition}
            onKeyDown={(event) => moveMenuFocus(event, taskMenu.current, closeTaskMenu)}
          >
            <span className="card-task-menu-label">关联资料</span>
            {taskMenuLoading ? (
              <span className="card-task-menu-state" role="status">正在读取资料</span>
            ) : taskMenuError ? (
              <button type="button" role="menuitem" onClick={() => void loadMaterials()}>
                <RotateCw aria-hidden="true" size={16} /><span><strong>重新载入资料</strong><small>{taskMenuError}</small></span>
              </button>
            ) : taskLinks?.length ? taskLinks.map((link) => {
              const MaterialIcon = link.kind === 'url' ? Link2 : File;
              return (
                <button
                  key={link.id}
                  type="button"
                  className="card-material-menu-item"
                  role="menuitem"
                  title={link.target}
                  onClick={() => { closeTaskMenu(false); onOpenMaterial?.(link); }}
                >
                  <MaterialIcon aria-hidden="true" size={16} />
                  <span><strong>{link.title || (link.kind === 'url' ? '网页链接' : '文件')}</strong><small>{link.target}</small></span>
                </button>
              );
            }) : (
              <span className="card-task-menu-state">尚未添加链接或文件</span>
            )}
            <span className="card-node-menu-rule" />
            <button type="button" role="menuitem" onClick={() => { closeTaskMenu(false); onRenameTask?.(); }}><Pencil aria-hidden="true" size={16} /><span>编辑任务名称</span></button>
            <button type="button" role="menuitem" onClick={() => chooseTaskAction('complete')}><CheckCircle2 aria-hidden="true" size={16} /><span>完成并归档</span></button>
            <button type="button" role="menuitem" onClick={() => chooseTaskAction('cancel')}><Ban aria-hidden="true" size={16} /><span>取消并归档</span></button>
            <button type="button" role="menuitem" className="danger" onClick={() => chooseTaskAction('delete')}><Trash2 aria-hidden="true" size={16} /><span>永久删除</span></button>
          </div>,
          overlayRoot
        );
      })()}

      {urgencyMenuOpen && (() => {
        const overlayRoot = document.querySelector<HTMLElement>(APP_OVERLAY_ROOT_SELECTOR) ?? document.body;
        return createPortal(
          <div
            ref={urgencyMenu}
            className="card-node-menu-popover task-urgency-menu-popover"
            role="menu"
            aria-label={'调整任务紧急程度：' + task.name}
            data-carousel-no-drag="true"
            style={menuPosition}
            onKeyDown={(event) => moveMenuFocus(event, urgencyMenu.current, closeUrgencyMenu)}
          >
            {URGENCIES.map((urgency) => {
              const OptionIcon = URGENCY_ICON[urgency];
              return (
                <button
                  key={urgency}
                  type="button"
                  className={'urgency-' + urgency}
                  role="menuitemradio"
                  aria-checked={task.urgency === urgency}
                  onClick={() => void changeUrgency(urgency)}
                >
                  <OptionIcon aria-hidden="true" size={16} />
                  <span>{URGENCY_LABEL[urgency]}</span>
                  {task.urgency === urgency && <Check aria-hidden="true" className="menu-check" size={15} />}
                </button>
              );
            })}
          </div>,
          overlayRoot
        );
      })()}

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
              onClick={() => {
                closeNodeMenu(false);
                onRenameNode?.(node);
              }}
            >
              <Pencil aria-hidden="true" size={16} />
              <span>编辑节点名称</span>
            </button>
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
