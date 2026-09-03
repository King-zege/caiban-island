// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEEPSEEK_BASE_URL, GLM_BASE_URLS, PENG_OPENAI_BASE_URL, PENG_ROOT_URL } from '../src/shared/types';
import type { AgentProviderStatus, FeishuBotStatus, TaskDetail } from '../src/shared/types';
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
  protocol: 'openai-completions',
  configured: false,
  configuredProviders: [],
  baseUrl: DEEPSEEK_BASE_URL,
  model: 'deepseek-v4-flash',
  profiles: {
    deepseek: { configured: false, baseUrl: DEEPSEEK_BASE_URL, model: 'deepseek-v4-flash', protocol: 'openai-completions' },
    glm: { configured: false, baseUrl: GLM_BASE_URLS[0], model: 'glm-5.2', protocol: 'openai-completions' },
    peng_deepseek: { configured: false, baseUrl: PENG_OPENAI_BASE_URL, model: '', protocol: 'openai-completions' },
    peng_openai: { configured: false, baseUrl: PENG_OPENAI_BASE_URL, model: '', protocol: 'openai-responses' },
    peng_anthropic: { configured: false, baseUrl: PENG_ROOT_URL, model: '', protocol: 'anthropic-messages' }
  },
  pengKeyConfigured: false,
  pengMigrationRequired: false
};

const FEISHU_AGENT_STATUS: FeishuBotStatus = {
  appId: '', configured: false, enabled: false, connectionState: 'disabled', botName: null,
  botOpenId: null, lastErrorCategory: null, pairedUsers: []
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

  it('Agent 设置提供 DeepSeek、GLM 与 Peng 三种显式协议，不再出现旧通道', async () => {
    setApi({
      getSettings: vi.fn(async () => ({ ok: true as const, data: { reminder_default_offsets: [], autostart: false, acrylic_disabled: true } })),
      getFeishuStatus: vi.fn(async () => ({ ok: true as const, data: { configured: false, autoSync: false, target: null } })),
      getAgentProviderStatus: vi.fn(async () => ({ ok: true as const, data: AGENT_STATUS })),
      getFeishuAgentStatus: vi.fn(async () => ({ ok: true as const, data: FEISHU_AGENT_STATUS }))
    });
    const { container } = render(<SettingsView />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Agent' }));
    expect(container.textContent).toContain('Pi Agent · 多模型 Provider');
    expect(screen.getByRole('option', { name: 'DeepSeek 官方' })).not.toBeNull();
    expect(screen.getByRole('option', { name: '智谱 GLM' })).not.toBeNull();
    expect(screen.getByRole('option', { name: 'Peng · DeepSeek' })).not.toBeNull();
    expect(screen.getByRole('option', { name: 'Peng · OpenAI' })).not.toBeNull();
    expect(screen.getByRole('option', { name: 'Peng · Anthropic' })).not.toBeNull();
    expect(container.textContent).not.toContain('Qoder');
    expect(container.textContent).not.toContain('内置 AI');
  });

  it('Peng 显式协议使用固定 Base URL、模型 ID 与共用 Key', async () => {
    const saveAgentProviderConfig = vi.fn(async () => ({ ok: true as const, data: true }));
    setApi({
      getSettings: vi.fn(async () => ({ ok: true as const, data: { reminder_default_offsets: [], autostart: false, acrylic_disabled: true } })),
      getFeishuStatus: vi.fn(async () => ({ ok: true as const, data: { configured: false, autoSync: false, target: null } })),
      getAgentProviderStatus: vi.fn(async () => ({ ok: true as const, data: AGENT_STATUS })),
      getFeishuAgentStatus: vi.fn(async () => ({ ok: true as const, data: FEISHU_AGENT_STATUS })),
      saveAgentProviderConfig
    });
    render(<SettingsView />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Agent' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Agent 模型服务' }), 'peng_anthropic');
    expect((screen.getByRole('textbox', { name: 'Agent 服务地址' }) as HTMLInputElement).value).toBe(PENG_ROOT_URL);
    await userEvent.type(screen.getByRole('textbox', { name: 'Peng 模型 ID' }), 'anthropic/claude-enterprise');
    await userEvent.type(screen.getByLabelText('Peng 企业 API Key'), 'enterprise-test-key');
    await userEvent.click(screen.getByRole('button', { name: '保存并启用' }));

    expect(saveAgentProviderConfig).toHaveBeenCalledWith({
      provider: 'peng_anthropic',
      baseUrl: PENG_ROOT_URL,
      model: 'anthropic/claude-enterprise',
      apiKey: 'enterprise-test-key'
    });
  });

  it('飞书设置将 Agent 机器人与多维表格单向导出分块并遮罩 Secret', async () => {
    const botStatus: FeishuBotStatus = {
      ...FEISHU_AGENT_STATUS, appId: 'cli_test', configured: true, enabled: true, connectionState: 'connected',
      botName: '采办岛机器人', botOpenId: 'bot-1', pairedUsers: [{ openId: 'user-1', displayName: '合成用户', pairedAt: '2026-09-02T00:00:00.000Z', lastSeenAt: '2026-09-02T00:00:00.000Z' }]
    };
    setApi({
      getSettings: vi.fn(async () => ({ ok: true as const, data: { reminder_default_offsets: [], autostart: false, acrylic_disabled: true } })),
      getFeishuStatus: vi.fn(async () => ({ ok: true as const, data: { configured: false, autoSync: false, target: null } })),
      getAgentProviderStatus: vi.fn(async () => ({ ok: true as const, data: AGENT_STATUS })),
      getFeishuAgentStatus: vi.fn(async () => ({ ok: true as const, data: botStatus }))
    });
    render(<SettingsView />);
    await userEvent.click(await screen.findByRole('tab', { name: '飞书' }));
    expect(screen.getByText('飞书 Agent 机器人')).not.toBeNull();
    expect(screen.getByText('飞书多维表格单向导出')).not.toBeNull();
    expect(screen.getByText('合成用户')).not.toBeNull();
    expect((screen.getByLabelText('飞书应用 App Secret') as HTMLInputElement).type).toBe('password');
  });

  it('设置主分区没有 serious 或 critical 的 axe 问题', async () => {
    setApi({
      getSettings: vi.fn(async () => ({ ok: true as const, data: { reminder_default_offsets: [], autostart: false, acrylic_disabled: true } })),
      getFeishuStatus: vi.fn(async () => ({ ok: true as const, data: { configured: false, autoSync: false, target: null } })),
      getAgentProviderStatus: vi.fn(async () => ({ ok: true as const, data: AGENT_STATUS })),
      getFeishuAgentStatus: vi.fn(async () => ({ ok: true as const, data: FEISHU_AGENT_STATUS }))
    });
    const { container } = render(<SettingsView />);
    await screen.findByRole('tab', { name: '常用' });
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
  });
});
