// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractCard, ContractCreateRequest, ContractDetail } from '../src/shared/contractContracts';
import type { TaskCard } from '../src/shared/types';
import L2Panel from '../src/renderer/src/panels/L2Panel';
import L3Panel from '../src/renderer/src/panels/L3Panel';
import NewContractForm from '../src/renderer/src/components/NewContractForm';
import { useContractStore } from '../src/renderer/src/state/useContractStore';
import { useTaskStore } from '../src/renderer/src/state/useStore';
import { useWorkspaceStore } from '../src/renderer/src/state/useWorkspaceStore';

const PROJECT: TaskCard = {
  task: { id: 'project-24', name: '总部终端采购', fullName: '总部办公终端设备框架采购项目', shortName: '总部终端采购', shortNameNeedsReview: false, description: '', kind: 'procurement', urgency: 'high', deadlineUtc: null, remindAtUtc: null, tzId: 'Asia/Shanghai', status: 'active', createdAtUtc: '2026-08-01T00:00:00.000Z', updatedAtUtc: '2026-08-01T00:00:00.000Z', archivedAt: null, archiveOutcome: null, workflowTemplateId: 'standard-procurement-v1', workflowTemplateVersion: 1 },
  progress: { done: 2, total: 10, nextTitle: '供应商寻源' }, nodes: [], overdue: false, miscReminder: null
};

const MISC: TaskCard = {
  ...PROJECT,
  task: { ...PROJECT.task, id: 'misc-24', name: '催交盖章件', fullName: '催交盖章件', shortName: '催交盖章件', kind: 'misc', remindAtUtc: '2099-09-01T01:00:00.000Z' },
  progress: { done: 0, total: 0, nextTitle: null }, miscReminder: { state: 'scheduled', fireAtUtc: '2099-09-01T01:00:00.000Z', legacyDeadlineUtc: null }
};

const CONTRACT_CARD: ContractCard = {
  contract: { id: 'contract-24', procurementProjectId: PROJECT.task.id, fullName: '总部办公终端设备框架采购合同（第一批）', shortName: '终端框采一批', contractNo: 'HT-2026-024', supplierName: '合成科技有限公司', amountMinor: 12345678, currency: 'CNY', signedOn: '2026-08-01', effectiveOn: '2026-08-02', expiresOn: '2027-08-01', tzId: 'Asia/Shanghai', status: 'active', archivedFromStatus: null, createdAtUtc: '2026-08-01T00:00:00.000Z', updatedAtUtc: '2026-08-01T00:00:00.000Z' },
  nextAction: { id: 'action-24', contractId: 'contract-24', type: 'payment', title: '支付首付款', description: '', dueAtUtc: '2099-09-01T01:00:00.000Z', amountMinor: 3000000, relatedActionId: null, status: 'pending', position: 0, completedAtUtc: null, createdAtUtc: '2026-08-01T00:00:00.000Z', updatedAtUtc: '2026-08-01T00:00:00.000Z' },
  pendingActionCount: 1,
  risk: 'normal'
};

const CONTRACT_DETAIL: ContractDetail = { contract: CONTRACT_CARD.contract, actions: [CONTRACT_CARD.nextAction!], reminders: [], links: [], note: '' };

function setApi(overrides: Partial<Window['api']> = {}): void {
  Object.defineProperty(window, 'api', { configurable: true, writable: true, value: {
    setL2Detail: vi.fn(async () => ({ accepted: true })), setL2ContentMode: vi.fn(async () => ({ accepted: true })), interacting: vi.fn(async () => true), setLevel: vi.fn(async () => ({ accepted: true })),
    listTasks: vi.fn(async () => ({ ok: true as const, data: [PROJECT, MISC] })), taskDetail: vi.fn(async () => ({ ok: false as const, error: 'not needed' })), listReminders: vi.fn(async () => ({ ok: true as const, data: [] })),
    listContracts: vi.fn(async () => ({ ok: true as const, data: [CONTRACT_CARD] })), contractDetail: vi.fn(async () => ({ ok: true as const, data: CONTRACT_DETAIL })),
    createContract: vi.fn(async () => ({ ok: true as const, data: CONTRACT_CARD.contract })), updateContract: vi.fn(async () => ({ ok: true as const, data: CONTRACT_CARD.contract })),
    ...overrides
  } });
}

beforeEach(() => {
  class TestResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  HTMLDialogElement.prototype.showModal = function showModal(): void { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close(): void { this.removeAttribute('open'); };
  useTaskStore.setState({ tasks: [PROJECT, MISC], loading: false, loaded: true, loadError: null, detail: null, detailLoading: false, detailError: null, detailCache: {}, onboarded: true });
  useContractStore.setState({ contracts: [CONTRACT_CARD], loading: false, loaded: true, error: null, detail: CONTRACT_DETAIL, detailLoading: false, detailError: null });
  useWorkspaceStore.setState({ section: 'tasks', l2View: 'overview', taskSection: 'overview', selectedTaskId: PROJECT.task.id, selectedContractId: null, contractSection: 'overview', highlightedNodeId: null, pendingUndo: null, toast: null });
  setApi();
});

afterEach(() => { cleanup(); useWorkspaceStore.getState().undoPending(); useWorkspaceStore.getState().clearToast(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('P24 Renderer 合同轨道与工作区', () => {
  it('L2 按采购项目、合同、杂事显示三条轨道并使用封顶高度模式', async () => {
    const setL2ContentMode = vi.fn(async () => ({ accepted: true })); setApi({ setL2ContentMode });
    const { container } = render(<L2Panel reducedMotion />);
    expect(screen.getByRole('region', { name: '采购项目' })).not.toBeNull();
    expect(screen.getByRole('region', { name: '合同' })).not.toBeNull();
    expect(screen.getByRole('region', { name: '杂事' })).not.toBeNull();
    expect(container.querySelector('.l2-lanes-triple')).not.toBeNull();
    await waitFor(() => expect(setL2ContentMode).toHaveBeenCalledWith({ agent: false, procurement: true, contracts: true, misc: true }));
    await userEvent.click(screen.getByRole('button', { name: /终端框采一批，供应商/ }));
    expect(useWorkspaceStore.getState().section).toBe('contracts');
    expect(window.api.setLevel).toHaveBeenCalledWith('l3');
  });

  it('L3 合同台账提供六个专用分区，并可按合同号和供应商搜索', async () => {
    useWorkspaceStore.setState({ section: 'contracts', selectedContractId: CONTRACT_CARD.contract.id });
    const view = render(<L3Panel layoutWidth={1200} />);
    expect(await screen.findByRole('heading', { name: CONTRACT_CARD.contract.fullName })).not.toBeNull();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['概览', '履约', '付款开票', '验收', '资料', '备注']);
    const search = screen.getByRole('textbox', { name: '搜索工作项' });
    await userEvent.type(search, 'HT-2026-024');
    expect(screen.getByRole('button', { name: /终端框采一批/ })).not.toBeNull();
    await userEvent.clear(search); await userEvent.type(search, '合成科技');
    expect(screen.getByRole('button', { name: /终端框采一批/ })).not.toBeNull();
    const result = await axe.run(view.container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([]);
  });

  it('新建合同同时提交正式全名、简称、精确金额和采购项目关联', async () => {
    const createContract = vi.fn(async (_input: ContractCreateRequest) => ({ ok: true as const, data: CONTRACT_CARD.contract })); setApi({ createContract });
    render(<NewContractForm projects={[PROJECT]} onClose={() => undefined} />);
    await userEvent.type(screen.getByRole('textbox', { name: /^合同正式全名/ }), '总部办公终端框架合同');
    await userEvent.type(screen.getByRole('textbox', { name: /合同卡片简称/ }), '终端框采');
    await userEvent.type(screen.getByRole('textbox', { name: /^供应商/ }), '合成科技');
    await userEvent.type(screen.getByRole('textbox', { name: '合同金额（CNY）' }), '123456.78');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '关联采购项目' }), PROJECT.task.id);
    await userEvent.click(screen.getByRole('button', { name: '创建合同' }));
    const input = createContract.mock.calls[0]?.[0];
    expect(input).toMatchObject({ fullName: '总部办公终端框架合同', shortName: '终端框采', supplierName: '合成科技', procurementProjectId: PROJECT.task.id, amountMinor: 12345678, currency: 'CNY' });
  });

  it('新建合同只填写一种名称也可先生成草拟卡片', async () => {
    const createContract = vi.fn(async (_input: ContractCreateRequest) => ({ ok: true as const, data: CONTRACT_CARD.contract })); setApi({ createContract });
    render(<NewContractForm projects={[]} onClose={() => undefined} />);
    await userEvent.type(screen.getByRole('textbox', { name: /合同正式全名/ }), '待补充合同信息');
    await userEvent.click(screen.getByRole('button', { name: '创建合同' }));
    expect(createContract.mock.calls[0]?.[0]).toMatchObject({ fullName: '待补充合同信息', shortName: '', supplierName: '', status: 'draft' });
  });
});
