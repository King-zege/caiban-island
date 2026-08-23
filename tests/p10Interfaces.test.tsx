// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskDetail } from '../src/shared/types';
import NewTaskForm from '../src/renderer/src/components/NewTaskForm';
import SettingsView from '../src/renderer/src/components/SettingsView';
import TaskEditor from '../src/renderer/src/components/TaskEditor';
import { useTaskStore } from '../src/renderer/src/state/useStore';
import { useWorkspaceStore } from '../src/renderer/src/state/useWorkspaceStore';

const DETAIL: TaskDetail = {
  task: {
    id: 'task-1',
    name: '办公电脑采购',
    description: '',
    kind: 'task',
    urgency: 'normal',
    deadlineUtc: null,
    tzId: 'Asia/Shanghai',
    status: 'active',
    createdAtUtc: '2026-08-16T00:00:00.000Z',
    updatedAtUtc: '2026-08-16T00:00:00.000Z',
    archivedAt: null,
    archiveOutcome: null
  },
  nodes: [],
  links: [{ id: 'link-1', taskId: 'task-1', kind: 'url', title: '供应商报价', target: 'https://supplier.example/quote?id=1', meta: '{}' }],
  note: ''
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
    const createTask = vi.fn(async () => ({ ok: false as const, error: '暂时无法保存' }));
    setApi({ createTask, listTasks: vi.fn(async () => ({ ok: true as const, data: [] })) });
    render(<NewTaskForm onClose={() => undefined} />);

    expect(screen.queryByText('任务类型')).toBeNull();
    await userEvent.type(screen.getByRole('textbox', { name: '任务名称' }), '办公电脑采购');
    await userEvent.click(screen.getByRole('button', { name: '补充截止时间、优先级与说明' }));
    expect(screen.getByText('任务类型')).not.toBeNull();
    expect(screen.getByText('紧急程度')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '创建任务' }));

    expect(await screen.findByText('暂时无法保存')).not.toBeNull();
    expect((screen.getByRole('textbox', { name: '任务名称' }) as HTMLInputElement).value).toBe('办公电脑采购');
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(createTask).toHaveBeenCalledTimes(2);
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

  it('Qoder 连接地址默认遮罩，显示与复制都由用户明确触发', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setApi({
      getSettings: vi.fn(async () => ({ ok: true as const, data: { reminder_default_offsets: [], autostart: false, acrylic_disabled: true } })),
      getMcpConfig: vi.fn(async () => ({ ok: true as const, data: { url: 'http://127.0.0.1:3210/sse?token=session-secret', token: 'session-secret', stdioCommand: 'node bridge session-secret' } })),
      getFeishuStatus: vi.fn(async () => ({ ok: true as const, data: { configured: false, autoSync: false, target: null } })),
      getAiStatus: vi.fn(async () => ({ ok: true as const, data: { configured: false, baseUrl: '', model: '' } })),
      getDeepSeekStatus: vi.fn(async () => ({ ok: true as const, data: { configured: false, baseUrl: 'https://api.deepseek.com' as const, model: 'deepseek-v4-flash' as const } }))
    });
    const { container } = render(<SettingsView />);
    await screen.findByRole('tab', { name: 'AI 与 Qoder' });
    await userEvent.click(screen.getByRole('tab', { name: 'AI 与 Qoder' }));

    expect(container.textContent).not.toContain('session-secret');
    await userEvent.click(screen.getByRole('button', { name: '显示' }));
    expect(container.textContent).toContain('http://127.0.0.1:3210/sse?token=session-secret');
    await userEvent.click(screen.getByRole('button', { name: '复制地址' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:3210/sse?token=session-secret'));
  });

  it('设置主分区没有 serious 或 critical 的 axe 问题', async () => {
    setApi({
      getSettings: vi.fn(async () => ({ ok: true as const, data: { reminder_default_offsets: [], autostart: false, acrylic_disabled: true } })),
      getMcpConfig: vi.fn(async () => ({ ok: true as const, data: { url: 'http://127.0.0.1:3210/sse?token=masked', token: 'masked', stdioCommand: 'node bridge' } })),
      getFeishuStatus: vi.fn(async () => ({ ok: true as const, data: { configured: false, autoSync: false, target: null } })),
      getAiStatus: vi.fn(async () => ({ ok: true as const, data: { configured: false, baseUrl: '', model: '' } })),
      getDeepSeekStatus: vi.fn(async () => ({ ok: true as const, data: { configured: false, baseUrl: 'https://api.deepseek.com' as const, model: 'deepseek-v4-flash' as const } }))
    });
    const { container } = render(<SettingsView />);
    await screen.findByRole('tab', { name: '常用' });
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
  });
});
