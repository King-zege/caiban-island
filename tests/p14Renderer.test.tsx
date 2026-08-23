// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunEvent, AgentSessionDetail, AgentSessionSummary, DraftRecord } from '../src/shared/types';
import AgentPanel from '../src/renderer/src/components/AgentPanel';
import DraftsPanel from '../src/renderer/src/components/DraftsPanel';
import { useWorkspaceStore } from '../src/renderer/src/state/useWorkspaceStore';

const SESSION: AgentSessionSummary = {
  id: 'session-1', title: '规划采购', model: 'deepseek-v4-flash', summary: '',
  createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z', inputTokens: 0, outputTokens: 0
};

const DETAIL: AgentSessionDetail = {
  session: SESSION,
  messages: [{ id: 'message-1', sessionId: SESSION.id, role: 'user', content: '规划采购', toolName: null, createdAt: SESSION.createdAt }]
};

function setApi(api: Partial<Window['api']>): void {
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal(): void { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close(): void { this.removeAttribute('open'); };
  useWorkspaceStore.getState().undoPending();
});

afterEach(() => {
  cleanup();
  useWorkspaceStore.getState().undoPending();
  vi.restoreAllMocks();
});

describe('P14 Agent 工作区', () => {
  it('支持流式文本、取消和会话完成后的恢复', async () => {
    let listener: ((event: AgentRunEvent) => void) | null = null;
    const cancel = vi.fn(async () => ({ ok: true as const, data: true }));
    setApi({
      listAgentSessions: vi.fn(async () => ({ ok: true as const, data: [] })),
      getAgentSession: vi.fn(async () => ({ ok: true as const, data: { ...DETAIL, messages: [...DETAIL.messages, { id: 'message-2', sessionId: SESSION.id, role: 'assistant' as const, content: '完成规划', toolName: null, createdAt: SESSION.updatedAt }] } })),
      agentStart: vi.fn(async () => ({ ok: true as const, data: DETAIL })),
      agentSend: vi.fn(async () => ({ ok: true as const, data: DETAIL })),
      agentCancel: cancel,
      onAgentEvent: (callback) => { listener = callback; return () => undefined; }
    });
    render(<AgentPanel />);
    const input = screen.getByRole('textbox', { name: '发送给 Pi Agent' });
    await userEvent.type(input, '规划采购');
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByText('规划采购')).not.toBeNull();
    await act(async () => { listener?.({ type: 'text_delta', sessionId: SESSION.id, delta: '正在核对' }); });
    expect(screen.getByText('正在核对')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(cancel).toHaveBeenCalledOnce();
    await act(async () => { listener?.({ type: 'state', sessionId: SESSION.id, state: 'completed' }); });
    expect(await screen.findByText('完成规划')).not.toBeNull();
  });

  it('会话列表可切换、导出，且键盘 Enter 可发送', async () => {
    const second = { ...SESSION, id: 'session-2', title: '供应商比较' };
    const send = vi.fn(async () => ({ ok: true as const, data: { ...DETAIL, session: second } }));
    const exportSession = vi.fn(async () => ({ ok: true as const, data: 'export.md' }));
    setApi({
      listAgentSessions: vi.fn(async () => ({ ok: true as const, data: [SESSION, second] })),
      getAgentSession: vi.fn(async (id: string) => ({ ok: true as const, data: { ...DETAIL, session: id === second.id ? second : SESSION } })),
      agentStart: vi.fn(async () => ({ ok: true as const, data: DETAIL })),
      agentSend: send,
      agentCancel: vi.fn(async () => ({ ok: true as const, data: false })),
      exportAgentSession: exportSession,
      onAgentEvent: () => () => undefined
    });
    render(<AgentPanel />);
    await userEvent.click(await screen.findByRole('button', { name: /供应商比较/ }));
    const input = screen.getByRole('textbox', { name: '发送给 Pi Agent' });
    await userEvent.type(input, '继续比较{enter}');
    expect(send).toHaveBeenCalledWith({ sessionId: second.id, input: '继续比较' });
    await userEvent.click(screen.getByRole('button', { name: '导出 Markdown' }));
    expect(exportSession).toHaveBeenCalledWith(second.id, 'markdown');
  });

  it('空 Agent 工作区没有 serious 或 critical 的 axe 问题', async () => {
    setApi({
      listAgentSessions: vi.fn(async () => ({ ok: true as const, data: [] })),
      agentCancel: vi.fn(async () => ({ ok: true as const, data: false })),
      onAgentEvent: () => () => undefined
    });
    const { container } = render(<AgentPanel />);
    await waitFor(() => expect(screen.getByText('还没有历史会话')).not.toBeNull());
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
  });

  it('Agent 节点删除提案需要二次确认，并先进入 5 秒撤销队列', async () => {
    const draft: DraftRecord = {
      id: 'draft-delete', source: 'pi', state: 'pending', createdAt: '2026-08-23T00:00:00.000Z',
      payload: {
        type: 'action', taskId: 'task-1', sessionId: 'session-1', summary: '删除节点「询价」', warnings: ['需要二次确认'],
        action: { kind: 'delete_node', before: { id: 'node-1', taskId: 'task-1', title: '询价', description: '', startUtc: null, endUtc: null, status: 'pending', position: 0 } }
      }
    };
    const confirm = vi.fn(async () => ({ ok: true as const, data: true }));
    setApi({
      listDrafts: vi.fn(async () => ({ ok: true as const, data: [draft] })),
      getAiStatus: vi.fn(async () => ({ ok: true as const, data: { configured: false, baseUrl: '', model: '' } })),
      confirmDraft: confirm,
      discardDraft: vi.fn(async () => ({ ok: true as const, data: true }))
    });
    render(<DraftsPanel />);
    expect((await screen.findAllByText('删除节点「询价」')).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: '确认并应用此操作' }));
    expect(screen.getByRole('dialog').textContent).toContain('确认删除这个节点');
    await userEvent.click(screen.getByRole('button', { name: '确认并进入撤销倒计时' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().pendingUndo?.id).toBe(draft.id);
    useWorkspaceStore.getState().undoPending();
    expect(confirm).not.toHaveBeenCalled();
  });
});
