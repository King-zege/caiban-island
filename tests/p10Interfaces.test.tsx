// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEEPSEEK_BASE_URL, GLM_BASE_URLS } from '../src/shared/types';
import type { AgentProviderStatus, TaskDetail } from '../src/shared/types';
import NewTaskForm from '../src/renderer/src/components/NewTaskForm';
import SettingsView from '../src/renderer/src/components/SettingsView';
import TaskEditor from '../src/renderer/src/components/TaskEditor';
import { useTaskStore } from '../src/renderer/src/state/useStore';
import { useWorkspaceStore } from '../src/renderer/src/state/useWorkspaceStore';

const DETAIL: TaskDetail = {
  task: {
    id: 'task-1',
    name: '办公电脑采购',
    fullName: '办公电脑采购', shortName: '办公电脑采购', shortNameNeedsReview: false,
    description: '',
    kind: 'task',
    urgency: 'normal',
    deadlineUtc: null,
    remindAtUtc: null,
    tzId: 'Asia/Shanghai',
    status: 'active',
    createdAtUtc: '2026-08-16T00:00:00.000Z',
    updatedAtUtc: '2026-08-16T00:00:00.000Z',
    archivedAt: null,
    archiveOutcome: null, workflowTemplateId: null, workflowTemplateVersion: null
  },
  nodes: [],
  links: [{ id: 'link-1', taskId: 'task-1', kind: 'url', title: '供应商报价', target: 'https://supplier.example/quote?id=1', meta: '{}' }],
  note: '',
  miscReminder: null
};

const AGENT_STATUS: AgentProviderStatus = {
  provider: 'deepseek',
  configured: false,
  configuredProviders: [],
  baseUrl: DEEPSEEK_BASE_URL,
  model: 'deepseek-v4-flash',
  profiles: {
    deepseek: { configured: false, baseUrl: DEEPSEEK_BASE_URL, model: 'deepseek-v4-flash' },
    glm: { configured: false, baseUrl: GLM_BASE_URLS[0], model: 'glm-5.2' },
    enterprise: { configured: false, baseUrl: '', model: '' }
  }
};

function installDialogPolyfill(): void {
  HTMLDialogElement.prototype.showModal = function showModal(): void { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close(): void { this.removeAttribute('open'); };
}

function setApi(api: Partial<Window['api']>): void {
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
}

beforeEach(() => {
  installDialogPolyfill();
  useTaskStore.setState({ tasks: [], loading: false, detail: DETAIL, detailLoading: false });
  useWorkspaceStore.getState().undoPending();
  useWorkspaceStore.getState().clearToast();
});

afterEach(() => {
  cleanup();
  useWorkspaceStore.getState().undoPending();
  useWorkspaceStore.getState().clearToast();
  vi.restoreAllMocks();
});

describe('P10 完整界面与安全交互', () => {
  it('新建任务默认只显示必要字段，失败后保留输入并可重试', async () => {
    const createProcurementProject = vi.fn(async () => ({ ok: false as const, error: '暂时无法保存' }));
    setApi({ createProcurementProject, listTasks: vi.fn(async () => ({ ok: true as const, data: [] })) });
    render(<NewTaskForm onClose={() => undefined} />);

    expect(screen.getByRole('group', { name: '工作类型' })).not.toBeNull();
    await userEvent.type(screen.getByRole('textbox', { name: '项目正式名称' }), '办公电脑采购项目');
    await userEvent.type(screen.getByRole('textbox', { name: /^卡片简称/ }), '办公电脑采购');
    await userEvent.click(screen.getByRole('button', { name: '补充截止时间、优先级与说明' }));
    expect(screen.getByText('紧急程度')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '创建项目' }));

    expect(await screen.findByText('暂时无法保存')).not.toBeNull();
    expect((screen.getByRole('textbox', { name: '项目正式名称' }) as HTMLInputElement).value).toBe('办公电脑采购项目');
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(createProcurementProject).toHaveBeenCalledTimes(2);
  });

  it('外部链接先展示完整目标，确认后才打开', async () => {
    const openUrl = vi.fn(async () => ({ ok: true as const, data: true }));
    setApi({ listReminders: vi.fn(async () => ({ ok: true as const, data: [] })), openUrl });
    render(<TaskEditor detail={DETAIL} section="materials" />);

    await userEvent.click(screen.getByTitle('https://supplier.example/quote?id=1'));
    expect(openUrl).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog').textContent).toContain('https://supplier.example/quote?id=1');
    await userEvent.click(screen.getByRole('button', { name: '确认打开' }));
    expect(openUrl).toHaveBeenCalledWith('https://supplier.example/quote?id=1');
  });

  it('外部目标打开失败时保留确认框并提供重试', async () => {
    const openUrl = vi.fn(async () => ({ ok: false as const, error: '系统拒绝打开该地址' }));
    setApi({ listReminders: vi.fn(async () => ({ ok: true as const, data: [] })), openUrl });
    render(<TaskEditor detail={DETAIL} section="materials" />);

    await userEvent.click(screen.getByTitle('https://supplier.example/quote?id=1'));
    await userEvent.click(screen.getByRole('button', { name: '确认打开' }));
    expect(await screen.findByText('系统拒绝打开该地址')).not.toBeNull();
    expect(screen.getByRole('dialog')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(openUrl).toHaveBeenCalledTimes(2);
  });

  it('Agent 设置提供 DeepSeek、GLM 与企业多模型网关，不再出现旧通道', async () => {
    setApi({
      getSettings: vi.fn(async () => ({ ok: true as const, data: { reminder_default_offsets: [], autostart: false, acrylic_disabled: true } })),
      getFeishuStatus: vi.fn(async () => ({ ok: true as const, data: { configured: false, autoSync: false, target: null } })),
      getAgentProviderStatus: vi.fn(async () => ({ ok: true as const, data: AGENT_STATUS }))
    });
    const { container } = render(<SettingsView />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Agent' }));
    expect(container.textContent).toContain('Pi Agent · 多模型 Provider');
    expect(screen.getByRole('option', { name: 'DeepSeek 官方' })).not.toBeNull();
    expect(screen.getByRole('option', { name: '智谱 GLM' })).not.toBeNull();
    expect(screen.getByRole('option', { name: '企业模型网关' })).not.toBeNull();
    expect(container.textContent).not.toContain('Qoder');
    expect(container.textContent).not.toContain('内置 AI');
  });

  it('企业网关接受自定义 Base URL、任意模型 ID，并按 Provider 保存', async () => {
    const saveAgentProviderConfig = vi.fn(async () => ({ ok: true as const, data: true }));
    setApi({
      getSettings: vi.fn(async () => ({ ok: true as const, data: { reminder_default_offsets: [], autostart: false, acrylic_disabled: true } })),
      getFeishuStatus: vi.fn(async () => ({ ok: true as const, data: { configured: false, autoSync: false, target: null } })),
      getAgentProviderStatus: vi.fn(async () => ({ ok: true as const, data: AGENT_STATUS })),
      saveAgentProviderConfig
    });
    render(<SettingsView />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Agent' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Agent 模型服务' }), 'enterprise');
    await userEvent.type(screen.getByRole('textbox', { name: '企业 Base URL' }), 'https://gateway.corp.example/v1');
    await userEvent.type(screen.getByRole('textbox', { name: '企业模型 ID' }), 'anthropic/claude-enterprise');
    await userEvent.type(screen.getByLabelText('企业模型网关 API Key'), 'enterprise-test-key');
    await userEvent.click(screen.getByRole('button', { name: '保存并启用' }));

    expect(saveAgentProviderConfig).toHaveBeenCalledWith({
      provider: 'enterprise',
      baseUrl: 'https://gateway.corp.example/v1',
      model: 'anthropic/claude-enterprise',
      apiKey: 'enterprise-test-key'
    });
  });

  it('设置主分区没有 serious 或 critical 的 axe 问题', async () => {
    setApi({
      getSettings: vi.fn(async () => ({ ok: true as const, data: { reminder_default_offsets: [], autostart: false, acrylic_disabled: true } })),
      getFeishuStatus: vi.fn(async () => ({ ok: true as const, data: { configured: false, autoSync: false, target: null } })),
      getAgentProviderStatus: vi.fn(async () => ({ ok: true as const, data: AGENT_STATUS }))
    });
    const { container } = render(<SettingsView />);
    await screen.findByRole('tab', { name: '常用' });
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
  });
});
