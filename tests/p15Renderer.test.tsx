// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryProposal, MemoryRecord } from '../src/shared/types';
import MemoryPanel from '../src/renderer/src/components/MemoryPanel';

const MEMORY: MemoryRecord = {
  id: 'memory-1', category: 'profile', fact: '用户偏好先给结论',
  sourceSessionId: 'session-1', sourceMessageId: 'message-evidence-1',
  createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z'
};

const PROPOSAL: MemoryProposal = {
  id: 'proposal-1', operation: 'add', category: 'work', fact: '供应商准入需要法务复核',
  evidenceMessageId: 'message-evidence-2', sourceSessionId: 'session-1', targetMemoryId: null,
  state: 'pending', capacityWarning: null,
  createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z'
};

function setApi(api: Partial<Window['api']>): void {
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal(): void { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close(): void { this.removeAttribute('open'); };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('P15 长期记忆工作区', () => {
  it('允许编辑后确认或拒绝提案，未确认内容与已确认记忆分开展示', async () => {
    const confirm = vi.fn(async () => ({ ok: true as const, data: MEMORY }));
    const discard = vi.fn(async () => ({ ok: true as const, data: true }));
    setApi({
      listMemories: vi.fn(async () => ({ ok: true as const, data: [MEMORY] })),
      listMemoryProposals: vi.fn(async () => ({ ok: true as const, data: [PROPOSAL] })),
      confirmMemoryProposal: confirm,
      discardMemoryProposal: discard
    });
    render(<MemoryPanel />);
    const proposalInput = await screen.findByRole('textbox', { name: `编辑记忆提案 ${PROPOSAL.id}` });
    await userEvent.clear(proposalInput);
    await userEvent.type(proposalInput, '供应商准入需要法务与财务复核');
    await userEvent.click(screen.getByRole('button', { name: '确认记忆' }));
    expect(confirm).toHaveBeenCalledWith(PROPOSAL.id, '供应商准入需要法务与财务复核');
    await userEvent.click(screen.getByRole('button', { name: '拒绝' }));
    expect(discard).toHaveBeenCalledWith(PROPOSAL.id);
    expect(screen.getByText('已确认记忆')).not.toBeNull();
  });

  it('支持更新、二次确认删除和清空长期记忆', async () => {
    const update = vi.fn(async () => ({ ok: true as const, data: { ...MEMORY, fact: '用户偏好表格结论' } }));
    const remove = vi.fn(async () => ({ ok: true as const, data: true }));
    const clear = vi.fn(async () => ({ ok: true as const, data: 1 }));
    setApi({
      listMemories: vi.fn(async () => ({ ok: true as const, data: [MEMORY] })),
      listMemoryProposals: vi.fn(async () => ({ ok: true as const, data: [] })),
      updateMemory: update,
      deleteMemory: remove,
      clearMemories: clear
    });
    render(<MemoryPanel />);
    const memoryInput = await screen.findByRole('textbox', { name: `编辑用户画像 ${MEMORY.id}` });
    await userEvent.clear(memoryInput);
    await userEvent.type(memoryInput, '用户偏好表格结论');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(update).toHaveBeenCalledWith(MEMORY.id, '用户偏好表格结论');
    await userEvent.click(screen.getByRole('button', { name: '删除记忆' }));
    expect(screen.getByRole('dialog').textContent).toContain('删除这条长期记忆');
    await userEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(remove).toHaveBeenCalledWith(MEMORY.id);
    await userEvent.click(screen.getByRole('button', { name: '清空记忆' }));
    await userEvent.click(screen.getByRole('button', { name: '确认清空' }));
    expect(clear).toHaveBeenCalledOnce();
  });

  it('空记忆工作区的键盘标签和读屏结构没有严重可访问性问题', async () => {
    setApi({
      listMemories: vi.fn(async () => ({ ok: true as const, data: [] })),
      listMemoryProposals: vi.fn(async () => ({ ok: true as const, data: [] }))
    });
    const { container } = render(<MemoryPanel />);
    await waitFor(() => expect(screen.getByText('还没有长期记忆')).not.toBeNull());
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
  });
});
