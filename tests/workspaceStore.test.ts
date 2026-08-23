import { afterEach, describe, expect, it, vi } from 'vitest';
import { UNDO_DELAY_MS, useWorkspaceStore } from '../src/renderer/src/state/useWorkspaceStore';

afterEach(() => {
  useWorkspaceStore.getState().undoPending();
  useWorkspaceStore.getState().clearToast();
  useWorkspaceStore.setState({ section: 'tasks', taskSection: 'overview', selectedTaskId: null, highlightedNodeId: null, pendingUndo: null, toast: null });
  vi.useRealTimers();
});

describe('工作台导航与撤销', () => {
  it('设置入口能直达设置分区', () => {
    useWorkspaceStore.getState().openSection('settings');
    expect(useWorkspaceStore.getState().section).toBe('settings');
  });

  it('删除延迟 5 秒提交，并可在提交前撤销', async () => {
    vi.useFakeTimers();
    const commit = vi.fn(async () => null);

    expect(useWorkspaceStore.getState().scheduleUndo({ id: 'node-1', kind: 'node', label: '节点', commit })).toBe(true);
    await vi.advanceTimersByTimeAsync(UNDO_DELAY_MS - 1);
    expect(commit).not.toHaveBeenCalled();
    useWorkspaceStore.getState().undoPending();
    await vi.advanceTimersByTimeAsync(1);
    expect(commit).not.toHaveBeenCalled();

    expect(useWorkspaceStore.getState().scheduleUndo({ id: 'node-2', kind: 'node', label: '节点', commit })).toBe(true);
    await vi.advanceTimersByTimeAsync(UNDO_DELAY_MS);
    expect(commit).toHaveBeenCalledOnce();
    expect(useWorkspaceStore.getState().pendingUndo).toBeNull();
  });

  it('已有待撤销操作时不会覆盖它', () => {
    vi.useFakeTimers();
    const firstCommit = vi.fn(async () => null);
    const secondCommit = vi.fn(async () => null);
    useWorkspaceStore.getState().scheduleUndo({ id: 'node-1', kind: 'node', label: '第一个节点', commit: firstCommit });

    expect(useWorkspaceStore.getState().scheduleUndo({ id: 'link-1', kind: 'link', label: '资料', commit: secondCommit })).toBe(false);
    expect(useWorkspaceStore.getState().pendingUndo?.id).toBe('node-1');
    expect(secondCommit).not.toHaveBeenCalled();
  });

  it('任务永久删除使用同一 5 秒撤销队列', async () => {
    vi.useFakeTimers();
    const commit = vi.fn(async () => null);
    expect(useWorkspaceStore.getState().scheduleUndo({ id: 'task-1', kind: 'task', label: '任务', commit })).toBe(true);
    await vi.advanceTimersByTimeAsync(UNDO_DELAY_MS);
    expect(commit).toHaveBeenCalledOnce();
  });

  it('提醒通知定位节点后短暂高亮，并在超时后清除', async () => {
    vi.useFakeTimers();
    useWorkspaceStore.getState().openTask('task-1', 'nodes');
    useWorkspaceStore.getState().highlightNode('node-1');
    expect(useWorkspaceStore.getState()).toMatchObject({
      selectedTaskId: 'task-1', taskSection: 'nodes', highlightedNodeId: 'node-1'
    });
    await vi.advanceTimersByTimeAsync(4500);
    expect(useWorkspaceStore.getState().highlightedNodeId).toBeNull();
  });
});
