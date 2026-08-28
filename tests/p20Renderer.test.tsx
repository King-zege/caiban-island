// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSessionDetail, DraftRecord, MemoryProposal, TaskCard } from '../src/shared/types';
import L2Panel from '../src/renderer/src/panels/L2Panel';
import { useAgentStore } from '../src/renderer/src/state/useAgentStore';
import { useTaskStore } from '../src/renderer/src/state/useStore';
import { useWorkspaceStore } from '../src/renderer/src/state/useWorkspaceStore';

const SESSION: AgentSessionDetail = {
  session: { id: 'session-p20', title: '加油站招标', model: 'deepseek-v4-flash', summary: '', createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z', inputTokens: 0, outputTokens: 0 },
  messages: [{ id: 'message-p20', sessionId: 'session-p20', role: 'assistant', content: '我已整理好一份方案，请确认或继续要求修改。', toolName: null, createdAt: '2026-08-28T00:00:00.000Z' }]
};

const TASK_DRAFT: DraftRecord = {
  id: 'draft-task', source: 'pi', sessionId: 'session-p20', state: 'pending', createdAt: '2026-08-28T00:00:00.000Z',
  payload: {
    type: 'task',
    taskInput: { kind: 'task', name: '加油站招标', description: '完成需求、公告和评标', urgency: 'high', deadlineUtc: null, tzId: 'Asia/Shanghai' },
    nodes: [{ title: '确认需求', description: '', startUtc: null, endUtc: null }], warnings: []
  }
};

const NODE_DRAFT: DraftRecord = {
  id: 'draft-nodes', source: 'pi', sessionId: 'session-p20', state: 'pending', createdAt: '2026-08-28T00:01:00.000Z',
  payload: { type: 'nodes', taskId: 'existing-task', nodes: [{ title: '复核预算', description: '', startUtc: null, endUtc: null }], warnings: [] }
};

const ACTION_DRAFT: DraftRecord = {
  id: 'draft-action', source: 'pi', sessionId: 'session-p20', state: 'pending', createdAt: '2026-08-28T00:02:00.000Z',
  payload: { type: 'action', taskId: 'existing-task', sessionId: 'session-p20', summary: '将“确认需求”改为进行中', warnings: [], action: { kind: 'set_node_status', nodeId: 'node-1', before: 'pending', after: 'in_progress' } }
};

const MEMORY: MemoryProposal = {
  id: 'memory-p20', operation: 'add', category: 'work', fact: '招标项目通常先确认需求范围', evidenceMessageId: 'message-p20', sourceSessionId: 'session-p20', targetMemoryId: null,
  state: 'pending', capacityWarning: null, createdAt: '2026-08-28T00:03:00.000Z', updatedAt: '2026-08-28T00:03:00.000Z'
};

const CARD: TaskCard = {
  task: { id: 'created-task', name: '加油站招标', description: '完成需求、公告和评标', kind: 'task', urgency: 'high', deadlineUtc: null, remindAtUtc: null, tzId: 'Asia/Shanghai', status: 'active', createdAtUtc: '2026-08-28T00:00:00.000Z', updatedAtUtc: '2026-08-28T00:00:00.000Z', archivedAt: null, archiveOutcome: null },
  progress: { done: 0, total: 1, nextTitle: '确认需求' }, nodes: [{ id: 'node-1', title: '确认需求', startUtc: null, status: 'pending', position: 0 }], overdue: false, miscReminder: null
};

function setApi(api: Partial<Window['api']> = {}): void {
  Object.defineProperty(window, 'api', { value: {
    setL2Detail: vi.fn(async () => ({ accepted: true, state: {} })),
    interacting: vi.fn(async () => true),
    setL2ContentMode: vi.fn(async () => ({ accepted: true, state: {} })),
    setLevel: vi.fn(async () => ({ accepted: true, state: {} })),
    listTasks: vi.fn(async () => ({ ok: true as const, data: [CARD] })),
    taskDetail: vi.fn(async () => ({ ok: false as const, error: 'not needed' })),
    listDrafts: vi.fn(async () => ({ ok: true as const, data: [] })),
    listMemoryProposals: vi.fn(async () => ({ ok: true as const, data: [] })),
    confirmDraft: vi.fn(async () => ({ ok: true as const, data: { type: 'task' as const, taskId: CARD.task.id } })),
    discardDraft: vi.fn(async () => ({ ok: true as const, data: true })),
    confirmMemoryProposal: vi.fn(async () => ({ ok: true as const, data: null })),
    discardMemoryProposal: vi.fn(async () => ({ ok: true as const, data: true })),
    agentCancel: vi.fn(async () => ({ ok: true as const, data: true })),
    ...api
  }, configurable: true, writable: true });
}

beforeEach(() => {
  class TestResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  HTMLDialogElement.prototype.showModal = function showModal(): void { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close(): void { this.removeAttribute('open'); };
  useTaskStore.setState({ tasks: [], loading: false, loaded: true, loadError: null, detail: null, detailLoading: false, detailError: null, detailCache: {}, onboarded: true });
  useWorkspaceStore.setState({ l2View: 'agent', section: 'tasks', taskSection: 'overview', selectedTaskId: null, highlightedNodeId: null, pendingUndo: null, toast: null });
  useAgentStore.setState({ sessions: [SESSION.session], detail: SESSION, runState: 'idle', runningSessionId: null, streaming: '', activeToolName: null, error: null, drafts: [TASK_DRAFT, NODE_DRAFT, ACTION_DRAFT], memoryProposals: [MEMORY], attention: null, bootstrapped: true });
  setApi();
});

afterEach(() => {
  cleanup();
  useWorkspaceStore.getState().undoPending();
  useWorkspaceStore.getState().clearToast();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('P20 L2 Agent 对话', () => {
  it('默认显示 AI，对话与速览可切换，并内联呈现四类待确认提案', async () => {
    const { container } = render(<L2Panel reducedMotion />);
    expect(screen.getByRole('tab', { name: /AI 对话/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('textbox', { name: '发送给 Pi Agent' })).not.toBeNull();
    expect(screen.getByText('任务方案')).not.toBeNull();
    expect(screen.getByText('节点方案')).not.toBeNull();
    expect(screen.getByText('操作差异')).not.toBeNull();
    expect(screen.getByText(/记忆提案/)).not.toBeNull();
    expect(window.api.setL2ContentMode).toHaveBeenCalledWith('agent');
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);

    screen.getByRole('tab', { name: /AI 对话/ }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(await screen.findByText('开始第一项采购')).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /任务速览/ }));
  });

  it('运行中隐藏只收起 L2，不取消 Agent', async () => {
    useAgentStore.setState({ runState: 'running', runningSessionId: SESSION.session.id });
    render(<L2Panel reducedMotion />);
    await userEvent.click(screen.getByRole('tab', { name: /任务速览/ }));
    expect(window.api.agentCancel).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('tab', { name: /AI 对话/ }));
    await userEvent.click(screen.getByRole('button', { name: '隐藏并继续' }));
    expect(window.api.setLevel).toHaveBeenCalledWith('l1');
    expect(window.api.agentCancel).not.toHaveBeenCalled();
  });

  it('任务方案一次确认后写入并切到速览定位新卡片', async () => {
    render(<L2Panel reducedMotion />);
    await userEvent.click(screen.getByRole('button', { name: '创建任务' }));
    await waitFor(() => expect(useWorkspaceStore.getState().l2View).toBe('overview'));
    expect(window.api.confirmDraft).toHaveBeenCalledWith(TASK_DRAFT.id);
    expect(await screen.findByText('加油站招标')).not.toBeNull();
    expect(useWorkspaceStore.getState().toast?.message).toBe('方案已创建为正式任务');
  });

  it('renderer 重载可从 main 快照恢复运行中的同一会话', async () => {
    useAgentStore.setState({ bootstrapped: false, sessions: [], detail: null, runState: 'idle', runningSessionId: null });
    setApi({
      listAgentSessions: vi.fn(async () => ({ ok: true as const, data: [SESSION.session] })),
      getAgentRunSnapshot: vi.fn(async () => ({ ok: true as const, data: { sessionId: SESSION.session.id, state: 'running' as const, startedAt: '2026-08-28T00:00:00.000Z' } })),
      getAgentSession: vi.fn(async () => ({ ok: true as const, data: SESSION }))
    });
    await useAgentStore.getState().bootstrap();
    expect(useAgentStore.getState()).toMatchObject({ runningSessionId: SESSION.session.id, runState: 'running', detail: SESSION });
  });
});
