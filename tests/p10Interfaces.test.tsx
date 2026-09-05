// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEEPSEEK_BASE_URL, GLM_BASE_URLS, PENG_OPENAI_BASE_URL } from '../src/shared/types';
import type { AgentProviderStatus, FeishuBotStatus, TaskDetail } from '../src/shared/types';
import NewTaskForm from '../src/renderer/src/components/NewTaskForm';
import SettingsView from '../src/renderer/src/components/SettingsView';
import { parseFeishuCredentialPaste } from '../src/renderer/src/components/FeishuSetupWizard';
import WelcomeView from '../src/renderer/src/components/WelcomeView';
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
    peng: { configured: false, baseUrl: PENG_OPENAI_BASE_URL, model: '', protocol: 'openai-completions' }
  },
  pengKeyConfigured: false,
  pengMigrationRequired: false
};

const FEISHU_AGENT_STATUS: FeishuBotStatus = {
  appId: '', configured: false, enabled: false, connectionState: 'disabled', botName: null,
  botOpenId: null, lastErrorCategory: null, lastErrorMessage: null, retryAttempt: 0, diagnosticsEnabled: false, pairedUsers: []
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
  window.sessionStorage.clear();
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

  it('Agent 设置将 Peng 收敛为单一企业网关，不再显示三个重复协议入口', async () => {
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
    expect(screen.getByRole('option', { name: 'Peng 企业网关' })).not.toBeNull();
    expect(screen.queryByRole('option', { name: 'Peng · DeepSeek' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Peng · OpenAI' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Peng · Anthropic' })).toBeNull();
    expect(container.textContent).not.toContain('Qoder');
    expect(container.textContent).not.toContain('内置 AI');
  });

  it('Peng 单一入口使用固定 Base URL、模型 ID 与企业 Key', async () => {
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
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Agent 模型服务' }), 'peng');
    expect((screen.getByRole('textbox', { name: 'Agent 服务地址' }) as HTMLInputElement).value).toBe(PENG_OPENAI_BASE_URL);
    await userEvent.type(screen.getByRole('textbox', { name: 'Peng 模型 ID' }), 'gpt-5.5');
    await userEvent.type(screen.getByLabelText('Peng 企业 API Key'), 'enterprise-test-key');
    await userEvent.click(screen.getByRole('button', { name: '保存并启用' }));

    expect(saveAgentProviderConfig).toHaveBeenCalledWith({
      provider: 'peng',
      baseUrl: PENG_OPENAI_BASE_URL,
      model: 'gpt-5.5',
      apiKey: 'enterprise-test-key'
    });
  });

  it('飞书设置将 Agent 机器人与多维表格单向导出分块并遮罩 Secret', async () => {
    const botStatus: FeishuBotStatus = {
      ...FEISHU_AGENT_STATUS, appId: 'cli_testapp', configured: true, enabled: true, connectionState: 'connected',
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

  it('飞书向导可从两行凭据连接，并进入后台配置检查', async () => {
    const connected: FeishuBotStatus = {
      ...FEISHU_AGENT_STATUS, appId: 'cli_wizardapp', configured: true, enabled: true,
      connectionState: 'connected', botName: '向导机器人', botOpenId: 'bot-wizard'
    };
    const saveFeishuAgentConfig = vi.fn(async () => ({ ok: true as const, data: connected }));
    setApi({
      getSettings: vi.fn(async () => ({ ok: true as const, data: { reminder_default_offsets: [], autostart: false, acrylic_disabled: true } })),
      getFeishuStatus: vi.fn(async () => ({ ok: true as const, data: { configured: false, autoSync: false, target: null } })),
      getAgentProviderStatus: vi.fn(async () => ({ ok: true as const, data: AGENT_STATUS })),
      getFeishuAgentStatus: vi.fn(async () => ({ ok: true as const, data: FEISHU_AGENT_STATUS })),
      saveFeishuAgentConfig
    });
    const { container } = render(<SettingsView />);
    await userEvent.click(await screen.findByRole('tab', { name: '飞书' }));
    await userEvent.click(screen.getByRole('button', { name: '开始连接向导' }));
    await userEvent.click(screen.getByRole('button', { name: '开始连接' }));
    await userEvent.type(screen.getByLabelText('向导 App ID'), 'cli_wizardapp');
    await userEvent.type(screen.getByLabelText('向导 App Secret'), 'synthetic-secret');
    await userEvent.click(screen.getByRole('button', { name: '保存并连接' }));
    expect((await screen.findAllByText('已连接：向导机器人')).length).toBeGreaterThan(0);
    expect(saveFeishuAgentConfig).toHaveBeenCalledWith({ appId: 'cli_wizardapp', appSecret: 'synthetic-secret', enabled: true });
    await userEvent.click(screen.getByRole('button', { name: '继续后台检查' }));
    expect(screen.getByText('事件订阅选择“使用长连接接收事件”')).not.toBeNull();
    const accessibility = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(accessibility.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
  });

  it('飞书凭据粘贴可识别后台标签格式且不回显额外文本', () => {
    expect(parseFeishuCredentialPaste('App ID: cli_demo123\nApp Secret: synthetic-value')).toEqual({
      appId: 'cli_demo123', appSecret: 'synthetic-value'
    });
    expect(parseFeishuCredentialPaste('cli_only123')).toEqual({ appId: 'cli_only123', appSecret: undefined });
  });

  it('飞书配对状态通过主进程事件实时显示，无需重进设置页', async () => {
    let statusListener: ((status: FeishuBotStatus) => void) | null = null;
    const base = { ...FEISHU_AGENT_STATUS, appId: 'cli_liveapp', configured: true, enabled: true, connectionState: 'connected' as const, botName: '实时机器人' };
    setApi({
      getSettings: vi.fn(async () => ({ ok: true as const, data: { reminder_default_offsets: [], autostart: false, acrylic_disabled: true } })),
      getFeishuStatus: vi.fn(async () => ({ ok: true as const, data: { configured: false, autoSync: false, target: null } })),
      getAgentProviderStatus: vi.fn(async () => ({ ok: true as const, data: AGENT_STATUS })),
      getFeishuAgentStatus: vi.fn(async () => ({ ok: true as const, data: base })),
      onFeishuAgentChanged: (listener) => { statusListener = listener; return () => { statusListener = null; }; }
    });
    render(<SettingsView />);
    await userEvent.click(await screen.findByRole('tab', { name: '飞书' }));
    expect(screen.getByText('尚无已配对用户。')).not.toBeNull();
    act(() => statusListener?.({ ...base, pairedUsers: [{ openId: 'user-live', displayName: '实时用户', pairedAt: '2026-09-05T00:00:00.000Z', lastSeenAt: '2026-09-05T00:00:00.000Z' }] }));
    expect(await screen.findByText('实时用户')).not.toBeNull();
  });

  it('首次启动提供可跳过的飞书连接入口', async () => {
    const setSetting = vi.fn(async () => ({ ok: true as const, data: true }));
    const onDone = vi.fn();
    setApi({ setSetting });
    render(<WelcomeView onDone={onDone} />);
    await userEvent.click(screen.getByRole('button', { name: '继续' }));
    await userEvent.click(screen.getByRole('button', { name: '暂不启用' }));
    expect(screen.getByText('要连接飞书机器人吗？')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '跳过，进入工作台' }));
    expect(onDone).toHaveBeenCalledWith(false);
    expect(setSetting).toHaveBeenCalledWith('onboarded', '1');
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
