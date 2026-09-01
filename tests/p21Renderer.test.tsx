// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunSnapshot, AgentSessionDetail, TaskCard } from '../src/shared/types';
import AgentPanel from '../src/renderer/src/components/AgentPanel';
import L2Panel from '../src/renderer/src/panels/L2Panel';
import L3Panel from '../src/renderer/src/panels/L3Panel';
import { useAgentStore } from '../src/renderer/src/state/useAgentStore';
import { useTaskStore } from '../src/renderer/src/state/useStore';
import { useWorkspaceStore } from '../src/renderer/src/state/useWorkspaceStore';

const SESSION: AgentSessionDetail = {
  session: { id: 'session-p21', title: '合成验收', model: 'deepseek-v4-flash', summary: '', createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z', inputTokens: 0, outputTokens: 0 },
  messages: [{ id: 'message-p21', sessionId: 'session-p21', role: 'assistant', content: '可以开始操作。', toolName: null, createdAt: '2026-08-28T00:00:00.000Z' }]
};
const UPDATED_SESSION: AgentSessionDetail = {
  session: { ...SESSION.session, updatedAt: '2026-08-28T01:00:00.000Z' },
  messages: [
    ...SESSION.messages,
    { id: 'message-p21-latest', sessionId: 'session-p21', role: 'assistant', content: '这是数据库中的最新回复。', toolName: null, createdAt: '2026-08-28T01:00:00.000Z' }
  ]
};
const CARD: TaskCard = {
  task: { id: 'task-p21', name: '合成采购卡片', fullName: '合成采购卡片', shortName: '合成采购卡片', shortNameNeedsReview: false, description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, remindAtUtc: null, tzId: 'Asia/Shanghai', status: 'active', createdAtUtc: '2026-08-28T00:00:00.000Z', updatedAtUtc: '2026-08-28T00:00:00.000Z', archivedAt: null, archiveOutcome: null, workflowTemplateId: null, workflowTemplateVersion: null },
  progress: { done: 0, total: 0, nextTitle: null }, nodes: [], overdue: false, miscReminder: null
};
const IDLE_SNAPSHOT: AgentRunSnapshot = { sessionId: null, state: 'idle', startedAt: null, sequence: 0, phase: 'idle', lastActivityAt: null, partialText: '', partialThinking: '', activeTool: null, pendingApproval: null, error: null };

function setApi(api: Partial<Window['api']> = {}): void {
  Object.defineProperty(window, 'api', { value: {
    setL2Detail: vi.fn(async () => ({ accepted: true })), interacting: vi.fn(async () => true),
    setL2ContentMode: vi.fn(async () => ({ accepted: true })), setLevel: vi.fn(async () => ({ accepted: true })),
    listTasks: vi.fn(async () => ({ ok: true as const, data: [CARD] })), taskDetail: vi.fn(async () => ({ ok: false as const, error: 'not needed' })),
    listAgentSessions: vi.fn(async () => ({ ok: true as const, data: [SESSION.session] })), getAgentSession: vi.fn(async () => ({ ok: true as const, data: SESSION })),
    getAgentRunSnapshot: vi.fn(async () => ({ ok: true as const, data: IDLE_SNAPSHOT })),
    getAgentPermissions: vi.fn(async () => ({ ok: true as const, data: { mode: 'confirm_all' as const, bypassWarningAccepted: false, authorizedDirectories: [] } })),
    setAgentPermissionMode: vi.fn(async (mode) => ({ ok: true as const, data: { mode, bypassWarningAccepted: mode === 'bypass', authorizedDirectories: [] } })),
    chooseAgentAuthorizedDirectory: vi.fn(async () => ({ ok: true as const, data: { mode: 'confirm_all' as const, bypassWarningAccepted: false, authorizedDirectories: [] } })),
    removeAgentAuthorizedDirectory: vi.fn(async () => ({ ok: true as const, data: { mode: 'confirm_all' as const, bypassWarningAccepted: false, authorizedDirectories: [] } })),
    resolveAgentApproval: vi.fn(async () => ({ ok: true as const, data: true })),
    listAgentProposals: vi.fn(async () => ({ ok: true as const, data: [] })), listMemoryProposals: vi.fn(async () => ({ ok: true as const, data: [] })),
    agentCancel: vi.fn(async () => ({ ok: true as const, data: true })), exportAgentSession: vi.fn(async () => ({ ok: true as const, data: 'exported' })),
    deleteAgentSession: vi.fn(async () => ({ ok: true as const, data: true })), clearAgentSessions: vi.fn(async () => ({ ok: true as const, data: 1 })),
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
  useTaskStore.setState({ tasks: [CARD], loading: false, loaded: true, loadError: null, detail: null, detailLoading: false, detailError: null, detailCache: {}, onboarded: true });
  useWorkspaceStore.setState({ l2View: 'overview', section: 'tasks', taskSection: 'overview', selectedTaskId: null, highlightedNodeId: null, pendingUndo: null, toast: null });
  useAgentStore.setState({ sessions: [SESSION.session], detail: SESSION, runState: 'idle', runPhase: 'idle', runningSessionId: null, streaming: '', streamingThinking: '', thinkingByMessageId: {}, activeToolName: null, error: null, errorCategory: null, lastSequence: 0, lastActivityAt: null, pendingApproval: null, permissions: { mode: 'confirm_all', bypassWarningAccepted: false, authorizedDirectories: [] }, proposals: [], memoryProposals: [], attention: null, bootstrapped: true });
  setApi();
});
afterEach(() => { cleanup(); useWorkspaceStore.getState().undoPending(); useWorkspaceStore.getState().clearToast(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('P21 统一 Agent 工作区', () => {
  it('L2 默认任务卡片，切换后只显示 Agent 对话并可展开同一会话', async () => {
    const agentSend = vi.fn(async () => ({ ok: true as const, data: SESSION }));
    setApi({ agentSend });
    const { container } = render(<L2Panel reducedMotion />);
    expect(screen.getByRole('tab', { name: '任务卡片' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('合成采购卡片')).not.toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'Agent' }));
    expect(screen.getByText('可以开始操作。')).not.toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Agent 权限模式' })).toBeNull();
    expect(screen.queryByRole('button', { name: '新对话' })).toBeNull();
    expect(screen.queryByRole('button', { name: '导出 JSON' })).toBeNull();
    const composer = screen.getByRole('textbox', { name: '发送给 Pi Agent' });
    await userEvent.type(composer, '检查今天的采购任务');
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(agentSend).toHaveBeenCalledWith({ sessionId: SESSION.session.id, input: '检查今天的采购任务' }));
    await userEvent.click(screen.getByRole('button', { name: '展开工作台' }));
    expect(useWorkspaceStore.getState().section).toBe('agent');
    expect(window.api.setLevel).toHaveBeenCalledWith('l3');
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
  });

  it('L3 只保留 Agent 且功能与 L2 一致，返回一律切到任务卡片', async () => {
    const getAgentSession = vi.fn(async () => ({ ok: true as const, data: UPDATED_SESSION }));
    setApi({ getAgentSession });
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1280);
    useWorkspaceStore.setState({ section: 'agent', l2View: 'agent' });
    render(<L3Panel layoutWidth={1180} />);
    expect(await screen.findByRole('button', { name: 'Agent' })).not.toBeNull();
    expect(screen.queryByText('AI 草稿')).toBeNull();
    expect(await screen.findByRole('combobox', { name: 'Agent 权限模式' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '新对话' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '导出 JSON' })).not.toBeNull();
    expect(await screen.findByText('这是数据库中的最新回复。')).not.toBeNull();
    expect(getAgentSession).toHaveBeenCalledWith(SESSION.session.id);
    expect(screen.getByRole('textbox', { name: '发送给 Pi Agent' })).not.toBeNull();
    const viewport = document.querySelector<HTMLElement>('.agent-messages');
    await waitFor(() => expect(viewport?.scrollTop).toBe(1280));
    await userEvent.click(screen.getByRole('button', { name: '返回任务卡片' }));
    expect(useWorkspaceStore.getState().l2View).toBe('overview');
    expect(window.api.setLevel).toHaveBeenCalledWith('l2');
    scrollHeight.mockRestore();
  });

  it('内联差异卡批准后继续当前工具循环，Bypass 首次启用显示风险确认', async () => {
    const resolve = vi.fn(async () => ({ ok: true as const, data: true })); setApi({ resolveAgentApproval: resolve });
    render(<AgentPanel />);
    act(() => useAgentStore.getState().handleEvent({ type: 'approval_required', sessionId: SESSION.session.id, sequence: 1, at: '2026-08-28T00:00:01.000Z', request: { id: 'approval-1', sessionId: SESSION.session.id, toolCallId: 'tool-1', toolName: 'execute_app_command', summary: '永久删除任务', risk: 'high', changes: [{ label: '操作', before: '保留卡片', after: '永久删除卡片' }], createdAt: '2026-08-28T00:00:01.000Z' } }));
    expect(screen.getByText('永久删除任务')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '批准并继续' }));
    expect(resolve).toHaveBeenCalledWith('approval-1', 'approve');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Agent 权限模式' }), 'bypass');
    expect(screen.getByRole('dialog').textContent).toContain('未授权目录');
  });

  it('检测事件序号缺口并从 main 快照补偿暂存流文本', async () => {
    const recovered: AgentRunSnapshot = { sessionId: SESSION.session.id, state: 'running', startedAt: '2026-08-28T00:00:00.000Z', sequence: 3, phase: 'streaming', lastActivityAt: '2026-08-28T00:00:03.000Z', partialText: '从快照恢复的完整文本', partialThinking: '正在核对任务', activeTool: null, pendingApproval: null, error: null };
    const snapshot = vi.fn(async () => ({ ok: true as const, data: recovered })); setApi({ getAgentRunSnapshot: snapshot });
    useAgentStore.setState({ lastSequence: 1 });
    act(() => useAgentStore.getState().handleEvent({ type: 'text_delta', sessionId: SESSION.session.id, sequence: 3, at: recovered.lastActivityAt ?? '', delta: '尾部' }));
    await waitFor(() => expect(useAgentStore.getState().streaming).toBe('从快照恢复的完整文本'));
    expect(snapshot).toHaveBeenCalled();
  });

  it('流式思考先展开显示，正式回答开始后收起并始终滚动到最新内容', async () => {
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(960);
    const view = render(<AgentPanel compact />);
    act(() => useAgentStore.getState().handleEvent({ type: 'thinking_delta', sessionId: SESSION.session.id, sequence: 1, at: '2026-08-28T00:00:01.000Z', delta: '正在核对采购节点' }));
    await waitFor(() => expect(screen.getByText('正在核对采购节点')).not.toBeNull());
    expect(screen.getByText('思考中').closest('details')?.hasAttribute('open')).toBe(true);
    act(() => useAgentStore.getState().handleEvent({ type: 'text_delta', sessionId: SESSION.session.id, sequence: 2, at: '2026-08-28T00:00:02.000Z', delta: '今天先完成询价。' }));
    await waitFor(() => expect(screen.getByText('今天先完成询价。')).not.toBeNull());
    expect(screen.getByText('思考过程').closest('details')?.hasAttribute('open')).toBe(false);
    const viewport = document.querySelector<HTMLElement>('.agent-messages');
    await waitFor(() => expect(viewport?.scrollTop).toBe(960));
    act(() => useAgentStore.getState().handleEvent({ type: 'message', sessionId: SESSION.session.id, sequence: 3, at: '2026-08-28T00:00:03.000Z', message: { id: 'answer-1', sessionId: SESSION.session.id, role: 'assistant', content: '今天先完成询价。', toolName: null, createdAt: '2026-08-28T00:00:03.000Z' } }));
    await waitFor(() => expect(useAgentStore.getState().thinkingByMessageId['answer-1']).toBe('正在核对采购节点'));
    const persistedDetail = useAgentStore.getState().detail;
    setApi({ getAgentSession: vi.fn(async () => ({ ok: true as const, data: persistedDetail! })) });
    view.unmount();
    render(<AgentPanel />);
    const reopenedViewport = document.querySelector<HTMLElement>('.agent-messages');
    await waitFor(() => expect(reopenedViewport?.scrollTop).toBe(960));
    expect(screen.getByText('思考过程').closest('details')?.hasAttribute('open')).toBe(false);
    scrollHeight.mockRestore();
  });
});
