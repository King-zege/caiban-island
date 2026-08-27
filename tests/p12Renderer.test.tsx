// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskCard, TaskDetail } from '../src/shared/types';
import L2Panel from '../src/renderer/src/panels/L2Panel';
import { useTaskStore } from '../src/renderer/src/state/useStore';

function card(index: number): TaskCard {
  return {
    task: {
      id: `task-${index}`,
      name: `采购任务 ${index}`,
      description: '',
      kind: 'task',
      urgency: 'normal',
      deadlineUtc: null,
      remindAtUtc: null,
      tzId: 'Asia/Shanghai',
      status: 'active',
      createdAtUtc: '2026-08-18T00:00:00.000Z',
      updatedAtUtc: '2026-08-18T00:00:00.000Z',
      archivedAt: null,
      archiveOutcome: null
    },
    progress: { done: 0, total: 0, nextTitle: null },
    nodes: [],
    overdue: false,
    miscReminder: null
  };
}

function detail(index: number): TaskDetail {
  const item = card(index);
  return { task: item.task, nodes: [], links: [], note: '', miscReminder: null };
}

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
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  useTaskStore.setState({
    tasks: [],
    loading: false,
    loaded: false,
    loadError: null,
    detail: null,
    detailLoading: false,
    detailError: null,
    detailCache: {},
    onboarded: true
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('P12 renderer 缓存与虚拟化', () => {
  it('并发预载任务只发起一次 IPC，后续层级挂载复用缓存', async () => {
    const listTasks = vi.fn(async () => ({ ok: true as const, data: [card(1)] }));
    setApi({ listTasks });
    await Promise.all([useTaskStore.getState().ensureLoaded(), useTaskStore.getState().ensureLoaded()]);
    await useTaskStore.getState().ensureLoaded();
    expect(listTasks).toHaveBeenCalledTimes(1);
    expect(useTaskStore.getState().tasks).toHaveLength(1);
  });

  it('任务详情按 ID 预取并由进入 L3 的 openDetail 直接复用', async () => {
    const taskDetail = vi.fn(async () => ({ ok: true as const, data: detail(8) }));
    setApi({ taskDetail });
    await Promise.all([
      useTaskStore.getState().prefetchDetail('task-8'),
      useTaskStore.getState().prefetchDetail('task-8')
    ]);
    await useTaskStore.getState().openDetail('task-8');
    expect(taskDetail).toHaveBeenCalledTimes(1);
    expect(useTaskStore.getState().detail?.task.id).toBe('task-8');
  });

  it('100 个任务保持完整逻辑数量，但最多挂载 7 张 TaskCard', () => {
    const tasks = Array.from({ length: 100 }, (_, index) => card(index));
    useTaskStore.setState({ tasks, loaded: true, onboarded: true });
    setApi({
      taskDetail: vi.fn(async () => ({ ok: true as const, data: detail(0) })),
      setL2Detail: vi.fn(async () => ({ accepted: false })),
      interacting: vi.fn(async () => true)
    });
    const { container } = render(<L2Panel reducedMotion />);
    expect(container.querySelectorAll('.task-card').length).toBeLessThanOrEqual(7);
    expect(container.querySelector('[aria-setsize="100"]')).not.toBeNull();
    expect(container.querySelectorAll('*').length).toBeLessThanOrEqual(700);
  });
});
