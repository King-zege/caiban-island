// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskCard, TaskDetail } from '../src/shared/types';
import NewTaskForm from '../src/renderer/src/components/NewTaskForm';
import L2Panel from '../src/renderer/src/panels/L2Panel';
import L3Panel from '../src/renderer/src/panels/L3Panel';
import { useTaskStore } from '../src/renderer/src/state/useStore';
import { useWorkspaceStore } from '../src/renderer/src/state/useWorkspaceStore';

const MISC_CARD: TaskCard = {
  task: {
    id: 'misc-1', name: '联系物业续门禁卡', description: '', kind: 'misc', urgency: 'normal',
    deadlineUtc: null, remindAtUtc: '2099-09-01T08:30:00.000Z', tzId: 'Asia/Shanghai', status: 'active',
    createdAtUtc: '2026-08-20T00:00:00.000Z', updatedAtUtc: '2026-08-25T00:00:00.000Z',
    archivedAt: null, archiveOutcome: null
  },
  progress: { done: 0, total: 0, nextTitle: null },
  nodes: [],
  overdue: false,
  miscReminder: { state: 'scheduled', fireAtUtc: '2099-09-01T08:30:00.000Z', legacyDeadlineUtc: null }
};

const PROJECT_CARD: TaskCard = {
  task: {
    ...MISC_CARD.task, id: 'project-1', name: '办公电脑采购', kind: 'task', urgency: 'high',
    deadlineUtc: '2099-09-02T08:30:00.000Z', remindAtUtc: null
  },
  progress: { done: 0, total: 1, nextTitle: '询价' },
  nodes: [{ id: 'node-1', title: '询价', startUtc: null, status: 'pending', position: 0 }],
  overdue: false,
  miscReminder: null
};

const MISC_DETAIL: TaskDetail = { task: MISC_CARD.task, nodes: [], links: [], note: '记得带旧卡', miscReminder: MISC_CARD.miscReminder };

function setApi(api: Partial<Window['api']>): void {
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
}

function baseApi(overrides: Partial<Window['api']> = {}): Partial<Window['api']> {
  return {
    setL2Detail: vi.fn(async () => ({ accepted: true })),
    setL2ContentMode: vi.fn(async () => ({ accepted: true })),
    interacting: vi.fn(async () => true),
    setLevel: vi.fn(async () => ({ accepted: true })),
    listTasks: vi.fn(async () => ({ ok: true as const, data: [PROJECT_CARD, MISC_CARD] })),
    taskDetail: vi.fn(async (id: string) => id === MISC_CARD.task.id
      ? { ok: true as const, data: MISC_DETAIL }
      : { ok: false as const, error: '测试未提供项目详情' }),
    listReminders: vi.fn(async () => ({ ok: true as const, data: [] })),
    ...overrides
  };
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
  HTMLDialogElement.prototype.showModal = function showModal(): void { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close(): void { this.removeAttribute('open'); };
  useTaskStore.setState({
    tasks: [], loading: false, loaded: true, loadError: null, detail: null,
    detailLoading: false, detailError: null, detailCache: {}, onboarded: true
  });
  useWorkspaceStore.setState({
    section: 'tasks', taskSection: 'overview', selectedTaskId: null,
    highlightedNodeId: null, pendingUndo: null, toast: null
  });
});

afterEach(() => {
  cleanup();
  useWorkspaceStore.getState().undoPending();
  useWorkspaceStore.getState().clearToast();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('P19 Renderer 任务分层', () => {
  it('新建表单先选类型，杂事仅提交名称、备注与精确提醒', async () => {
    const createTask = vi.fn(async () => ({ ok: true as const, data: MISC_CARD.task }));
    setApi(baseApi({ createTask, listTasks: vi.fn(async () => ({ ok: true as const, data: [MISC_CARD] })) }));
    render(<NewTaskForm onClose={() => undefined} />);

    await userEvent.click(screen.getByRole('button', { name: '杂事' }));
    expect(screen.queryByText('紧急程度')).toBeNull();
    expect(screen.queryByLabelText('截止时间')).toBeNull();
    await userEvent.type(screen.getByRole('textbox', { name: '杂事名称' }), '联系物业续卡');
    const reminderInput = document.querySelector<HTMLInputElement>('input[type="datetime-local"]');
    if (!reminderInput) throw new Error('提醒时间输入框未渲染');
    fireEvent.change(reminderInput, { target: { value: '2099-08-27T16:30' } });
    await userEvent.type(screen.getByRole('textbox', { name: '备注' }), '带上旧卡');
    await userEvent.click(screen.getByRole('button', { name: '创建杂事' }));

    expect(createTask).toHaveBeenCalledWith({
      kind: 'misc', name: '联系物业续卡', note: '带上旧卡',
      remindAtUtc: '2099-08-27T08:30:00.000Z', tzId: 'Asia/Shanghai'
    });
  });

  it('L2 混合布局同步原生尺寸模式；杂事贴纸正文打开 L3，完成操作进入 5 秒撤销队列', async () => {
    const setL2ContentMode = vi.fn(async () => ({ accepted: true }));
    const setLevel = vi.fn(async () => ({ accepted: true }));
    const completeTask = vi.fn(async () => ({ ok: true as const, data: MISC_CARD.task }));
    setApi(baseApi({ setL2ContentMode, setLevel, completeTask }));
    useTaskStore.setState({ tasks: [PROJECT_CARD, MISC_CARD] });
    render(<div><L2Panel reducedMotion /><div data-app-overlay-root="true" /></div>);

    const sticker = await screen.findByRole('button', { name: /打开杂事「联系物业续门禁卡」/ });
    await waitFor(() => expect(setL2ContentMode).toHaveBeenCalledWith('mixed'));
    expect(screen.getByRole('region', { name: '采购项目' })).not.toBeNull();
    expect(screen.getByRole('region', { name: '杂事' })).not.toBeNull();
    await userEvent.click(sticker);
    expect(useWorkspaceStore.getState().selectedTaskId).toBe('misc-1');
    expect(setLevel).toHaveBeenCalledWith('l3');

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: '完成杂事「联系物业续门禁卡」' }));
    expect(screen.queryByRole('button', { name: /打开杂事「联系物业续门禁卡」/ })).toBeNull();
    expect(completeTask).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(completeTask).toHaveBeenCalledWith('misc-1');
  });

  it('L3 为杂事使用无页签单页，保留提醒、备注、资料和生命周期操作', async () => {
    setApi(baseApi());
    useTaskStore.setState({
      tasks: [MISC_CARD], detail: MISC_DETAIL, detailCache: { 'misc-1': MISC_DETAIL }
    });
    useWorkspaceStore.setState({ section: 'tasks', selectedTaskId: 'misc-1' });
    const view = render(<L3Panel layoutWidth={1200} />);

    expect(await screen.findByRole('heading', { name: '提醒时间' })).not.toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByRole('heading', { name: '备注' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: '链接与附件' })).not.toBeNull();
    expect(screen.queryByText('紧急程度')).toBeNull();
    expect(screen.queryByText('项目进度')).toBeNull();
    const result = await axe.run(view.container);
    expect(result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([]);
  });

  it('杂事操作失败时在对应区块就近反馈，不提供无法真正重试的动作', async () => {
    setApi(baseApi({ setMiscReminder: vi.fn(async () => ({ ok: false as const, error: '提醒时间已被其他操作修改' })) }));
    useTaskStore.setState({
      tasks: [MISC_CARD], detail: MISC_DETAIL, detailCache: { 'misc-1': MISC_DETAIL }
    });
    useWorkspaceStore.setState({ section: 'tasks', selectedTaskId: 'misc-1' });
    render(<L3Panel layoutWidth={1200} />);

    const reminderHeading = await screen.findByRole('heading', { name: '提醒时间' });
    const reminderSection = reminderHeading.closest('section');
    if (!reminderSection) throw new Error('提醒区块未渲染');
    await userEvent.click(within(reminderSection).getByRole('button', { name: '保存提醒' }));

    expect((await within(reminderSection).findByRole('alert')).textContent).toContain('提醒时间已被其他操作修改');
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
  });
});
