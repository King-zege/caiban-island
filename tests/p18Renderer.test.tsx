// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskCard, TaskDetail } from '../src/shared/types';
import L2Panel from '../src/renderer/src/panels/L2Panel';
import L3Panel from '../src/renderer/src/panels/L3Panel';
import { useTaskStore } from '../src/renderer/src/state/useStore';
import { useWorkspaceStore } from '../src/renderer/src/state/useWorkspaceStore';

const NORMAL_CARD: TaskCard = {
  task: {
    id: 'task-normal', name: '普通采购', description: '', kind: 'task', urgency: 'normal',
    deadlineUtc: '2026-09-01T10:00:00.000Z', tzId: 'Asia/Shanghai', status: 'active',
    createdAtUtc: '2026-08-20T00:00:00.000Z', updatedAtUtc: '2026-08-20T00:00:00.000Z',
    archivedAt: null, archiveOutcome: null
  },
  progress: { done: 0, total: 1, nextTitle: '确认需求' },
  nodes: [{ id: 'node-1', title: '确认需求', startUtc: null, status: 'pending', position: 0 }],
  overdue: false
};

const CRITICAL_CARD: TaskCard = {
  ...NORMAL_CARD,
  task: {
    ...NORMAL_CARD.task,
    id: 'task-critical', name: '紧急采购', urgency: 'critical',
    deadlineUtc: null, createdAtUtc: '2026-08-21T00:00:00.000Z'
  },
  progress: { done: 0, total: 1, nextTitle: '立即询价' },
  nodes: [{ id: 'node-critical', title: '立即询价', startUtc: null, status: 'in_progress', position: 0 }]
};

function detailFor(card: TaskCard): TaskDetail {
  return {
    task: card.task,
    nodes: card.nodes.map((node) => ({ ...node, taskId: card.task.id, description: '', endUtc: null })),
    links: card.task.id === 'task-critical' ? [
      { id: 'link-url', taskId: card.task.id, kind: 'url', title: '供应商报价页', target: 'https://example.com/quote', meta: '{}' },
      { id: 'link-file', taskId: card.task.id, kind: 'file', title: '报价单', target: 'C:\\Fixtures\\quote.pdf', meta: '{}' }
    ] : [],
    note: ''
  };
}

function setApi(api: Partial<Window['api']>): void {
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
}

function installApi(cards: () => TaskCard[], overrides: Partial<Window['api']> = {}): void {
  setApi({
    setL2Detail: vi.fn(async () => ({ accepted: true })),
    interacting: vi.fn(async () => true),
    setLevel: vi.fn(async () => ({ accepted: true })),
    listTasks: vi.fn(async () => ({ ok: true as const, data: cards() })),
    taskDetail: vi.fn(async (id: string) => {
      const card = cards().find((item) => item.task.id === id);
      return card
        ? { ok: true as const, data: detailFor(card) }
        : { ok: false as const, error: '任务不存在' };
    }),
    listReminders: vi.fn(async () => ({ ok: true as const, data: [] })),
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('P18 L2 排序、资料与名称编辑', () => {
  it('L2 首次打开复用 shared 自动排序，把紧急任务排在普通任务前', async () => {
    const cards = [NORMAL_CARD, CRITICAL_CARD];
    installApi(() => cards);
    useTaskStore.setState({ tasks: cards });
    const view = render(<div><L2Panel reducedMotion /><div data-app-overlay-root="true" /></div>);
    await waitFor(() => expect(view.container.querySelectorAll('[data-carousel-card]')).toHaveLength(2));
    expect([...view.container.querySelectorAll<HTMLElement>('[data-carousel-card]')].map((item) => item.dataset.taskId))
      .toEqual(['task-critical', 'task-normal']);
    expect(screen.getByText('紧急程度（默认）').closest('button')?.classList.contains('active')).toBe(true);
  });

  it('资料下拉从详情缓存按需展示网页与文件，并在打开前确认完整目标', async () => {
    const cards = [CRITICAL_CARD];
    const openUrl = vi.fn(async () => ({ ok: true as const, data: true }));
    installApi(() => cards, { openUrl });
    useTaskStore.setState({ tasks: cards });
    render(<div><L2Panel reducedMotion /><div data-app-overlay-root="true" /></div>);

    await userEvent.click(await screen.findByRole('button', { name: /展开任务资料与操作：紧急采购/ }));
    expect(await screen.findByRole('menuitem', { name: /供应商报价页.*example.com\/quote/ })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /报价单.*quote.pdf/ })).not.toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: /供应商报价页/ }));
    expect(openUrl).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: '确认打开外部目标' });
    expect(dialog.textContent).toContain('https://example.com/quote');
    await userEvent.click(screen.getByRole('button', { name: '确认打开' }));
    expect(openUrl).toHaveBeenCalledWith('https://example.com/quote');
  });

  it('L2 可分别编辑任务名和节点名，并携带预期旧值', async () => {
    let cards = [CRITICAL_CARD];
    const setTaskName = vi.fn(async (request) => {
      cards = [{ ...cards[0], task: { ...cards[0].task, name: request.name } }];
      return { ok: true as const, data: cards[0].task };
    });
    const setNodeTitle = vi.fn(async (request) => {
      cards = [{
        ...cards[0],
        nodes: cards[0].nodes.map((node) => node.id === request.nodeId ? { ...node, title: request.title } : node),
        progress: { ...cards[0].progress, nextTitle: request.title }
      }];
      return { ok: true as const, data: { ...detailFor(cards[0]).nodes[0], title: request.title } };
    });
    installApi(() => cards, { setTaskName, setNodeTitle });
    useTaskStore.setState({ tasks: cards });
    render(<div><L2Panel reducedMotion /><div data-app-overlay-root="true" /></div>);

    await userEvent.click(await screen.findByRole('button', { name: /展开任务资料与操作：紧急采购/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '编辑任务名称' }));
    const taskName = screen.getByRole('textbox', { name: '任务名称' });
    await userEvent.clear(taskName);
    await userEvent.type(taskName, '加急办公设备采购');
    await userEvent.click(screen.getByRole('button', { name: '保存名称' }));
    await waitFor(() => expect(setTaskName).toHaveBeenCalledWith({
      taskId: 'task-critical', name: '加急办公设备采购', expectedName: '紧急采购'
    }));

    await userEvent.click(await screen.findByRole('button', { name: /立即询价，进行中/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: '编辑节点名称' }));
    const nodeName = screen.getByRole('textbox', { name: '节点名称' });
    await userEvent.clear(nodeName);
    await userEvent.type(nodeName, '联系三家供应商');
    await userEvent.click(screen.getByRole('button', { name: '保存名称' }));
    await waitFor(() => expect(setNodeTitle).toHaveBeenCalledWith({
      nodeId: 'node-critical', title: '联系三家供应商', expectedTitle: '立即询价'
    }));
  });

  it('L3 标题与节点行都有明确编辑键，弹层无严重无障碍问题', async () => {
    let cards = [CRITICAL_CARD];
    const setTaskName = vi.fn(async (request) => {
      cards = [{ ...cards[0], task: { ...cards[0].task, name: request.name } }];
      return { ok: true as const, data: cards[0].task };
    });
    const setNodeTitle = vi.fn(async (request) => ({
      ok: true as const,
      data: { ...detailFor(cards[0]).nodes[0], title: request.title }
    }));
    installApi(() => cards, { setTaskName, setNodeTitle });
    const detail = detailFor(cards[0]);
    useTaskStore.setState({ tasks: cards, detail, detailCache: { 'task-critical': detail } });
    useWorkspaceStore.setState({ selectedTaskId: 'task-critical', taskSection: 'nodes' });
    const view = render(<L3Panel />);

    const taskEdit = await screen.findByRole('button', { name: '编辑任务名称' });
    expect(taskEdit).not.toBeNull();
    expect(await screen.findByRole('button', { name: '编辑立即询价的名称' })).not.toBeNull();
    await userEvent.click(taskEdit);
    const result = await axe.run(view.container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
  });
});
