// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import L2Panel from '../src/renderer/src/panels/L2Panel';
import L3Panel from '../src/renderer/src/panels/L3Panel';
import { useTaskStore } from '../src/renderer/src/state/useStore';
import { useWorkspaceStore } from '../src/renderer/src/state/useWorkspaceStore';

function setApi(api: Partial<Window['api']>): void {
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
}

beforeEach(() => {
  useTaskStore.setState({ tasks: [], loading: false, detail: null, detailLoading: false });
  useWorkspaceStore.setState({ section: 'tasks', l2View: 'overview', taskSection: 'overview', selectedTaskId: null, highlightedNodeId: null, pendingUndo: null, toast: null });
});

afterEach(() => {
  cleanup();
  useWorkspaceStore.getState().undoPending();
  useWorkspaceStore.getState().clearToast();
  vi.restoreAllMocks();
});

describe('P11 三级返回与交互锁', () => {
  it('L2 卸载时总会释放交互锁，鼠标离开可自动收起', async () => {
    const interacting = vi.fn(async () => true);
    setApi({
      listTasks: vi.fn(async () => ({ ok: true as const, data: [] })),
      getSettings: vi.fn(async () => ({ ok: true as const, data: { onboarded: true } })),
      setL2Detail: vi.fn(async () => ({ accepted: true })),
      interacting
    });

    const view = render(<L2Panel reducedMotion={false} />);
    await waitFor(() => expect(interacting).toHaveBeenCalled());
    view.unmount();
    expect(interacting).toHaveBeenLastCalledWith(false);
  });

  it('L3 提供可见返回任务卡片按钮并返回 L2', async () => {
    const setLevel = vi.fn(async () => ({ accepted: true }));
    setApi({
      listTasks: vi.fn(async () => ({ ok: true as const, data: [] })),
      interacting: vi.fn(async () => true),
      setLevel
    });

    render(<L3Panel />);
    await userEvent.click(screen.getByRole('button', { name: '返回任务卡片' }));
    expect(setLevel).toHaveBeenCalledWith('l2');
  });
});
