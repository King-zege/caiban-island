// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskCard } from '../src/shared/types';
import NodeTimeDialog from '../src/renderer/src/components/NodeTimeDialog';
import L2Panel from '../src/renderer/src/panels/L2Panel';
import { useTaskStore } from '../src/renderer/src/state/useStore';
import { useWorkspaceStore } from '../src/renderer/src/state/useWorkspaceStore';

const CARD: TaskCard = {
  task: {
    id: 'task-1',
    name: '办公电脑采购',
    fullName: '办公电脑采购', shortName: '办公电脑采购', shortNameNeedsReview: false,
    description: '',
    kind: 'task',
    urgency: 'normal',
    deadlineUtc: '2026-08-25T10:00:00.000Z',
    remindAtUtc: null,
    tzId: 'Asia/Shanghai',
    status: 'active',
    createdAtUtc: '2026-08-23T00:00:00.000Z',
    updatedAtUtc: '2026-08-23T00:00:00.000Z',
    archivedAt: null,
    archiveOutcome: null, workflowTemplateId: null, workflowTemplateVersion: null
  },
  progress: { done: 0, total: 1, nextTitle: '确认技术参数' },
  nodes: [{ id: 'node-1', title: '确认技术参数', startUtc: null, status: 'pending', position: 0 }],
  overdue: false,
  miscReminder: null
};

function setApi(api: Partial<Window['api']>): void {
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
}

beforeEach(() => {
  class TestResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  HTMLDialogElement.prototype.showModal = function showModal(): void { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close(): void { this.removeAttribute('open'); };
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('P16 节点快捷时间与提醒', () => {
  it('L2 直接提交任务时区下的精确时间和并发前置值', async () => {
    vi.setSystemTime(new Date('2026-08-23T00:00:00.000Z'));
    const setNodeStartTime = vi.fn(async () => ({ ok: true as const, data: {} }));
    setApi({
      setL2Detail: vi.fn(async () => ({ accepted: true })),
      interacting: vi.fn(async () => true),
      taskDetail: vi.fn(async () => ({ ok: false as const, error: '仅预取' })),
      setNodeStartTime,
      listTasks: vi.fn(async () => ({ ok: true as const, data: [CARD] }))
    });

    render(<L2Panel reducedMotion />);
    const node = await screen.findByRole('button', { name: /确认技术参数，待完成/ });
    await userEvent.click(node);
    await userEvent.click(screen.getByRole('menuitem', { name: /设置提醒时间/ }));
    fireEvent.change(screen.getByLabelText(/^提醒时间/), { target: { value: '2026-08-24T09:30' } });
    await userEvent.click(screen.getByRole('button', { name: '保存时间' }));

    await waitFor(() => expect(setNodeStartTime).toHaveBeenCalledWith({
      nodeId: 'node-1',
      startUtc: '2026-08-24T01:30:00.000Z',
      expectedStartUtc: null
    }));
    expect(useWorkspaceStore.getState().toast?.message).toBe('节点提醒时间已更新');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /确认技术参数，待完成/ })));
  });

  it('快捷对话框拒绝过去时间，并可明确清除已有提醒', async () => {
    vi.setSystemTime(new Date('2026-08-23T00:00:00.000Z'));
    const onSave = vi.fn(async () => null);
    const view = render(
      <NodeTimeDialog
        open
        mode="quick"
        nodeTitle="签订合同"
        status="pending"
        startUtc={null}
        taskDeadlineUtc={null}
        tzId="Asia/Shanghai"
        onClose={() => undefined}
        onSave={onSave}
      />
    );
    fireEvent.change(screen.getByLabelText(/^提醒时间/), { target: { value: '2026-08-22T09:30' } });
    await userEvent.click(screen.getByRole('button', { name: '保存时间' }));
    expect(screen.getByRole('alert').textContent).toContain('不能早于当前时间');
    expect(onSave).not.toHaveBeenCalled();

    view.rerender(
      <NodeTimeDialog
        open
        mode="quick"
        nodeTitle="签订合同"
        status="pending"
        startUtc="2026-08-24T01:30:00.000Z"
        taskDeadlineUtc={null}
        tzId="Asia/Shanghai"
        onClose={() => undefined}
        onSave={onSave}
      />
    );
    await waitFor(() => expect((screen.getByLabelText(/^提醒时间/) as HTMLInputElement).value).toBe('2026-08-24T09:30'));
    await userEvent.click(screen.getByRole('button', { name: '清除提醒' }));
    await userEvent.click(screen.getByRole('button', { name: '保存时间' }));
    expect(onSave).toHaveBeenCalledWith(null, null);
  });

  it('L2 并发冲突保留对话框和用户输入，不覆盖新值', async () => {
    vi.setSystemTime(new Date('2026-08-23T00:00:00.000Z'));
    const setNodeStartTime = vi.fn(async () => ({ ok: false as const, error: '节点时间已变化，请刷新后重试' }));
    setApi({
      setL2Detail: vi.fn(async () => ({ accepted: true })),
      interacting: vi.fn(async () => true),
      taskDetail: vi.fn(async () => ({ ok: false as const, error: '仅预取' })),
      setNodeStartTime
    });
    render(<L2Panel reducedMotion />);
    await userEvent.click(await screen.findByRole('button', { name: /确认技术参数，待完成/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /设置提醒时间/ }));
    const input = screen.getByLabelText(/^提醒时间/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-08-24T09:30' } });
    await userEvent.click(screen.getByRole('button', { name: '保存时间' }));

    expect((await screen.findByRole('alert')).textContent).toContain('节点时间已变化，请刷新后重试');
    expect(input.value).toBe('2026-08-24T09:30');
    expect(screen.getByRole('dialog').hasAttribute('open')).toBe(true);
  });

  it('完整时间编辑拒绝截止早于开始，并对超出任务截止执行二次确认', async () => {
    vi.setSystemTime(new Date('2026-08-23T00:00:00.000Z'));
    const onSave = vi.fn(async () => null);
    render(
      <NodeTimeDialog
        open
        mode="full"
        nodeTitle="签订合同"
        status="in_progress"
        startUtc={null}
        endUtc={null}
        taskDeadlineUtc="2026-08-24T02:00:00.000Z"
        tzId="Asia/Shanghai"
        onClose={() => undefined}
        onSave={onSave}
      />
    );
    fireEvent.change(screen.getByLabelText(/^开始时间（到时提醒）/), { target: { value: '2026-08-24T12:00' } });
    fireEvent.change(screen.getByLabelText(/^截止时间（仅用于计划）/), { target: { value: '2026-08-24T11:00' } });
    await userEvent.click(screen.getByRole('button', { name: '保存时间' }));
    expect(screen.getByRole('alert').textContent).toContain('截止时间不能早于开始时间');

    fireEvent.change(screen.getByLabelText(/^截止时间（仅用于计划）/), { target: { value: '2026-08-24T13:00' } });
    await userEvent.click(screen.getByRole('button', { name: '保存时间' }));
    expect(screen.getByRole('alert').textContent).toContain('晚于任务截止时间');
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '仍要保存' }));
    expect(onSave).toHaveBeenCalledWith('2026-08-24T04:00:00.000Z', '2026-08-24T05:00:00.000Z');
  });

  it('节点菜单支持方向键和 Esc，关闭后焦点返回原节点', async () => {
    const escapedToWindow = vi.fn();
    window.addEventListener('keydown', escapedToWindow);
    setApi({
      setL2Detail: vi.fn(async () => ({ accepted: true })),
      interacting: vi.fn(async () => true),
      taskDetail: vi.fn(async () => ({ ok: false as const, error: '仅预取' }))
    });
    render(<L2Panel reducedMotion />);
    const node = await screen.findByRole('button', { name: /确认技术参数，待完成/ });
    await userEvent.click(node);
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: '待完成' }));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: '进行中' }));
    escapedToWindow.mockClear();
    await userEvent.keyboard('{Escape}');
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(document.activeElement).toBe(node);
    expect(escapedToWindow).not.toHaveBeenCalled();
    window.removeEventListener('keydown', escapedToWindow);
  });

  it('节点菜单挂载到应用弹层根节点并继承主题上下文', async () => {
    setApi({
      setL2Detail: vi.fn(async () => ({ accepted: true })),
      interacting: vi.fn(async () => true),
      taskDetail: vi.fn(async () => ({ ok: false as const, error: '仅预取' }))
    });
    render(
      <div>
        <L2Panel reducedMotion />
        <div data-app-overlay-root="true" />
      </div>
    );
    await userEvent.click(await screen.findByRole('button', { name: /确认技术参数，待完成/ }));
    const menu = screen.getByRole('menu');
    expect(menu.closest('[data-app-overlay-root="true"]')).not.toBeNull();
  });

  it('打开的节点菜单没有 serious 或 critical 的无障碍问题', async () => {
    setApi({
      setL2Detail: vi.fn(async () => ({ accepted: true })),
      interacting: vi.fn(async () => true),
      taskDetail: vi.fn(async () => ({ ok: false as const, error: '仅预取' }))
    });
    render(<L2Panel reducedMotion />);
    await userEvent.click(await screen.findByRole('button', { name: /确认技术参数，待完成/ }));
    const result = await axe.run(screen.getByRole('menu'), { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
  });
});
