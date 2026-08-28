// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskCard, TaskDetail } from '../src/shared/types';
import TaskEditor from '../src/renderer/src/components/TaskEditor';
import L2Panel from '../src/renderer/src/panels/L2Panel';
import { useTaskStore } from '../src/renderer/src/state/useStore';
import { useWorkspaceStore } from '../src/renderer/src/state/useWorkspaceStore';

const CARD: TaskCard = {
  task: {
    id: 'task-1',
    name: '办公电脑采购',
    description: '用于测试紧急程度快捷调整',
    kind: 'task',
    urgency: 'normal',
    deadlineUtc: '2026-09-01T10:00:00.000Z',
    remindAtUtc: null,
    tzId: 'Asia/Shanghai',
    status: 'active',
    createdAtUtc: '2026-08-24T00:00:00.000Z',
    updatedAtUtc: '2026-08-24T00:00:00.000Z',
    archivedAt: null,
    archiveOutcome: null
  },
  progress: { done: 0, total: 1, nextTitle: '确认参数' },
  nodes: [{ id: 'node-1', title: '确认参数', startUtc: null, status: 'pending', position: 0 }],
  overdue: false,
  miscReminder: null
};

const DETAIL: TaskDetail = {
  task: CARD.task,
  nodes: [{
    id: 'node-1', taskId: 'task-1', title: '确认参数', description: '',
    startUtc: null, endUtc: null, status: 'pending', position: 0
  }],
  links: [],
  note: '',
  miscReminder: null
};

function updatedCard(urgency: TaskCard['task']['urgency']): TaskCard {
  return {
    ...CARD,
    task: { ...CARD.task, urgency, updatedAtUtc: '2026-08-24T01:00:00.000Z' }
  };
}

function setApi(api: Partial<Window['api']>): void {
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
}

function installL2Api(overrides: Partial<Window['api']> = {}): void {
  setApi({
    setL2Detail: vi.fn(async () => ({ accepted: true })),
    interacting: vi.fn(async () => true),
    taskDetail: vi.fn(async () => ({ ok: true as const, data: DETAIL })),
    listTasks: vi.fn(async () => ({ ok: true as const, data: [CARD] })),
    setLevel: vi.fn(async () => ({ accepted: true })),
    ...overrides
  });
}

beforeEach(() => {
  class TestResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  useTaskStore.setState({
    tasks: [CARD], loading: false, loaded: true, loadError: null, detail: null,
    detailLoading: false, detailError: null, detailCache: {}, onboarded: true
  });
  useWorkspaceStore.setState({
    section: 'tasks', l2View: 'overview', taskSection: 'overview', selectedTaskId: null,
    highlightedNodeId: null, pendingUndo: null, toast: null
  });
});

afterEach(() => {
  cleanup();
  useWorkspaceStore.getState().undoPending();
  useWorkspaceStore.getState().clearToast();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('P17 任务紧急程度快捷调整', () => {
  it('L2 菜单显式选择四档，当前值不写入，新值携带并发前置条件', async () => {
    const changed = updatedCard('critical');
    const setTaskUrgency = vi.fn(async () => ({ ok: true as const, data: changed.task }));
    const listTasks = vi.fn(async () => ({ ok: true as const, data: [changed] }));
    const setLevel = vi.fn(async () => ({ accepted: true }));
    installL2Api({ setTaskUrgency, listTasks, setLevel });

    render(<div><L2Panel reducedMotion /><div data-app-overlay-root="true" /></div>);
    const trigger = await screen.findByRole('button', { name: '调整任务紧急程度，当前为普通' });
    await userEvent.click(trigger);
    expect(screen.getByRole('menuitemradio', { name: '普通' }).getAttribute('aria-checked')).toBe('true');
    await userEvent.click(screen.getByRole('menuitemradio', { name: '普通' }));
    expect(setTaskUrgency).not.toHaveBeenCalled();

    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitemradio', { name: '紧急' }));
    await waitFor(() => expect(setTaskUrgency).toHaveBeenCalledWith({
      taskId: 'task-1', urgency: 'critical', expectedUrgency: 'normal'
    }));
    expect(setLevel).not.toHaveBeenCalled();
    expect(useTaskStore.getState().tasks[0]?.task.urgency).toBe('critical');
    expect(useWorkspaceStore.getState().toast?.message).toBe('任务紧急程度已更新');
  });

  it('L2 紧急度菜单支持方向键、Home/End 与 Esc，并隔离全局收起', async () => {
    installL2Api();
    const escapedToWindow = vi.fn();
    window.addEventListener('keydown', escapedToWindow);
    render(<div><L2Panel reducedMotion /><div data-app-overlay-root="true" /></div>);
    const trigger = await screen.findByRole('button', { name: '调整任务紧急程度，当前为普通' });
    await userEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: /调整任务紧急程度/ });
    expect(menu.closest('[data-app-overlay-root="true"]')).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: '紧急' }));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: '高' }));
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: '低' }));
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: '紧急' }));
    escapedToWindow.mockClear();
    await userEvent.keyboard('{Escape}');
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(document.activeElement).toBe(trigger);
    expect(escapedToWindow).not.toHaveBeenCalled();
    window.removeEventListener('keydown', escapedToWindow);
  });

  it('L3 概览使用四档分段按钮并与正式数据同步', async () => {
    const changed = updatedCard('high');
    const setTaskUrgency = vi.fn(async () => ({ ok: true as const, data: changed.task }));
    setApi({
      setTaskUrgency,
      listTasks: vi.fn(async () => ({ ok: true as const, data: [changed] })),
      listReminders: vi.fn(async () => ({ ok: true as const, data: [] }))
    });
    useTaskStore.setState({ detail: DETAIL, detailCache: { 'task-1': DETAIL } });
    function Harness(): React.JSX.Element | null {
      const detail = useTaskStore((state) => state.detail);
      return detail ? <TaskEditor detail={detail} section="overview" /> : null;
    }
    render(<Harness />);
    const group = screen.getByRole('group', { name: '调整任务紧急程度' });
    const normal = within(group).getByRole('button', { name: '普通' });
    expect(normal.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(normal);
    expect(setTaskUrgency).not.toHaveBeenCalled();
    await userEvent.click(within(group).getByRole('button', { name: '高' }));
    await waitFor(() => expect(setTaskUrgency).toHaveBeenCalledWith({
      taskId: 'task-1', urgency: 'high', expectedUrgency: 'normal'
    }));
    expect(within(group).getByRole('button', { name: '高' }).getAttribute('aria-pressed')).toBe('true');
    expect(useWorkspaceStore.getState().toast?.message).toBe('任务紧急程度已更新');
  });

  it('打开的 L2 菜单和 L3 分段按钮没有 serious 或 critical 无障碍问题', async () => {
    installL2Api();
    const view = render(<div><L2Panel reducedMotion /><div data-app-overlay-root="true" /></div>);
    await userEvent.click(await screen.findByRole('button', { name: '调整任务紧急程度，当前为普通' }));
    const menuResult = await axe.run(screen.getByRole('menu'), { rules: { 'color-contrast': { enabled: false } } });
    expect(menuResult.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
    view.unmount();

    setApi({ listReminders: vi.fn(async () => ({ ok: true as const, data: [] })) });
    const l3 = render(<TaskEditor detail={DETAIL} section="overview" />);
    const groupResult = await axe.run(l3.container, { rules: { 'color-contrast': { enabled: false } } });
    expect(groupResult.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
  });
});
