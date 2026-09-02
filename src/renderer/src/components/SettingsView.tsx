import { Bot, Cloud, Database, Download, Eye, EyeOff, FolderOpen, Pause, Play, Save, Settings2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { DEEPSEEK_BASE_URL, DEEPSEEK_MODELS, GLM_BASE_URLS, GLM_MODELS } from '../../../shared/types';
import type { AgentProviderId, AgentProviderStatus } from '../../../shared/types';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import { AsyncFeedback } from './ui/AsyncFeedback';
import { Button, IconButton } from './ui/Button';
import { Field } from './ui/Field';
import { Switch } from './ui/Switch';

const OFFSET_CHOICES = [
  { label: '不自动提醒', value: 0 }, { label: '提前 30 分钟', value: 30 },
  { label: '提前 1 小时', value: 60 }, { label: '提前 1 天', value: 1440 }
];

type SettingsSection = 'common' | 'agent' | 'feishu' | 'data';
type FeishuStatus = {
  configured: boolean; autoSync: boolean; target: { appToken: string; tableId: string } | null;
  lastSync?: { at: string; ok: boolean; created: number; updated: number; error?: string } | null;
};

const SETTINGS_SECTIONS = [
  { id: 'common' as const, label: '常用', icon: Settings2 },
  { id: 'agent' as const, label: 'Agent', icon: Bot },
  { id: 'feishu' as const, label: '飞书同步', icon: Cloud },
  { id: 'data' as const, label: '数据与高级', icon: Database }
];

const PROVIDER_LABELS: Record<AgentProviderId, string> = {
  deepseek: 'DeepSeek 官方',
  glm: '智谱 GLM',
  enterprise: '企业模型网关'
};

export default function SettingsView(): React.JSX.Element {
  const notify = useWorkspaceStore((state) => state.notify);
  const [section, setSection] = useState<SettingsSection>('common');
  const [loading, setLoading] = useState(true);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string; retry?: () => void } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [defaultOffsets, setDefaultOffsets] = useState<number[]>([]);
  const [autostart, setAutostart] = useState(false);
  const [acrylic, setAcrylic] = useState(true);
  const [paused, setPaused] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentProviderStatus | null>(null);
  const [agentProvider, setAgentProvider] = useState<AgentProviderId>('deepseek');
  const [agentBaseUrl, setAgentBaseUrl] = useState<string>(DEEPSEEK_BASE_URL);
  const [agentModel, setAgentModel] = useState<string>(DEEPSEEK_MODELS[0]);
  const [agentKey, setAgentKey] = useState('');
  const [agentKeyVisible, setAgentKeyVisible] = useState(false);
  const [feishuToken, setFeishuToken] = useState('');
  const [feishuTokenVisible, setFeishuTokenVisible] = useState(false);
  const [feishuStatus, setFeishuStatus] = useState<FeishuStatus | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setInitialError(null);
    const [settingsResult, feishuResult, agentResult] = await Promise.all([
      window.api.getSettings(), window.api.getFeishuStatus(), window.api.getAgentProviderStatus()
    ]);
    setLoading(false);
    const failed = [settingsResult, feishuResult, agentResult].find((result) => !result.ok);
    if (failed && !failed.ok) setInitialError(failed.error);
    if (settingsResult.ok) {
      const settings = settingsResult.data as { reminder_default_offsets: number[]; autostart: boolean; acrylic_disabled: boolean };
      setDefaultOffsets(settings.reminder_default_offsets ?? []); setAutostart(settings.autostart === true); setAcrylic(settings.acrylic_disabled !== true);
    }
    if (feishuResult.ok) setFeishuStatus(feishuResult.data as FeishuStatus);
    if (agentResult.ok) {
      setAgentStatus(agentResult.data);
      setAgentProvider(agentResult.data.provider);
      setAgentBaseUrl(agentResult.data.baseUrl);
      setAgentModel(agentResult.data.model);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const showError = (message: string, retry?: () => void) => setFeedback({ tone: 'error', message, retry });
  const showSuccess = (message: string) => setFeedback({ tone: 'success', message });

  const saveSetting = async (key: string, value: string, success: string) => {
    const result = await window.api.setSetting(key, value);
    if (result.ok) { showSuccess(success); notify(success, 'success'); return true; }
    showError(result.error, () => void saveSetting(key, value, success)); return false;
  };
  const toggleDefault = async (value: number) => {
    const previous = defaultOffsets;
    const next = value === 0 ? [] : previous.includes(value) ? previous.filter((offset) => offset !== value) : [...previous, value].sort((left, right) => left - right);
    setDefaultOffsets(next);
    if (!await saveSetting('reminder_default_offsets', JSON.stringify(next), '默认提醒已更新')) setDefaultOffsets(previous);
  };
  const selectAgentProvider = (provider: AgentProviderId) => {
    setAgentProvider(provider);
    const saved = agentStatus?.profiles[provider];
    setAgentBaseUrl(saved?.baseUrl || (provider === 'deepseek' ? DEEPSEEK_BASE_URL : provider === 'glm' ? GLM_BASE_URLS[0] : ''));
    setAgentModel(saved?.model || (provider === 'deepseek' ? DEEPSEEK_MODELS[0] : provider === 'glm' ? GLM_MODELS[0] : ''));
    setAgentKey('');
    setAgentKeyVisible(false);
  };
  const refreshAgentStatus = async () => {
    const result = await window.api.getAgentProviderStatus();
    if (result.ok) setAgentStatus(result.data);
    return result;
  };
  const saveAgentProvider = async () => {
    setBusyAction('agent-provider-save');
    const result = await window.api.saveAgentProviderConfig({ provider: agentProvider, baseUrl: agentBaseUrl, model: agentModel, apiKey: agentKey });
    setBusyAction(null);
    if (!result.ok) { showError(result.error, () => void saveAgentProvider()); return; }
    setAgentKey(''); setAgentKeyVisible(false);
    const status = await refreshAgentStatus();
    if (status.ok) {
      setAgentBaseUrl(status.data.baseUrl);
      setAgentModel(status.data.model);
    }
    showSuccess(`${PROVIDER_LABELS[agentProvider]}配置已安全保存`);
  };
  const testAgentProvider = async () => {
    setBusyAction('agent-provider-test'); const result = await window.api.testAgentProvider(); setBusyAction(null);
    if (result.ok) showSuccess(result.data); else showError(result.error, () => void testAgentProvider());
  };
  const refreshFeishu = async () => { const result = await window.api.getFeishuStatus(); if (result.ok) setFeishuStatus(result.data as FeishuStatus); };
  const saveFeishu = async () => {
    setBusyAction('feishu-save'); const result = await window.api.saveFeishuToken(feishuToken); setBusyAction(null);
    if (!result.ok) { showError(result.error, () => void saveFeishu()); return; }
    setFeishuToken(''); setFeishuTokenVisible(false); await refreshFeishu(); showSuccess('飞书令牌已安全保存');
  };
  const testFeishu = async () => { setBusyAction('feishu-test'); const result = await window.api.testFeishu(); setBusyAction(null); if (result.ok) showSuccess(result.data); else showError(result.error, () => void testFeishu()); };
  const syncFeishu = async () => {
    setBusyAction('feishu-sync'); const result = await window.api.syncFeishu(); setBusyAction(null);
    if (result.ok) { showSuccess(`同步完成：新增 ${result.data.created} 条，更新 ${result.data.updated} 条`); await refreshFeishu(); }
    else showError(result.error, () => void syncFeishu());
  };
  const exportData = async (kind: 'csv' | 'markdown') => {
    setBusyAction('export-' + kind); const result = kind === 'csv' ? await window.api.exportCsv() : await window.api.exportMarkdown(); setBusyAction(null);
    if (result.ok) showSuccess(kind === 'csv' ? 'CSV 已导出' : 'Markdown 已导出'); else showError(result.error, () => void exportData(kind));
  };

  if (loading) return <p className="loading-state section-loading">正在读取设置</p>;
  if (initialError) return <AsyncFeedback tone="error" message={initialError} onRetry={() => void load()} />;

  return <div className="settings-view">
    <div className="standalone-heading"><div><h1>设置</h1><p>主题与辅助功能自动跟随 Windows。</p></div></div>
    <nav className="settings-tabs" role="tablist" aria-label="设置分区">{SETTINGS_SECTIONS.map((item) => { const Icon = item.icon; return <button key={item.id} data-settings-section={item.id} role="tab" aria-selected={section === item.id} className={section === item.id ? 'active' : ''} onClick={() => { setSection(item.id); setFeedback(null); }}><Icon aria-hidden="true" size={18} /><span>{item.label}</span></button>; })}</nav>
    {feedback && <AsyncFeedback tone={feedback.tone} message={feedback.message} onRetry={feedback.retry} />}

    {section === 'common' && <div className="settings-section" role="tabpanel">
      <div className="section-heading"><div><h2>提醒与启动</h2></div></div>
      <div className="setting-group"><div className="setting-copy"><strong>新任务的默认提醒</strong><span>仅在任务设置了截止时间时生效，可多选。</span></div><div className="segmented-control reminder-segments">{OFFSET_CHOICES.map((choice) => <button key={choice.value} type="button" className={choice.value === 0 ? defaultOffsets.length === 0 ? 'active' : '' : defaultOffsets.includes(choice.value) ? 'active' : ''} aria-pressed={choice.value === 0 ? defaultOffsets.length === 0 : defaultOffsets.includes(choice.value)} onClick={() => void toggleDefault(choice.value)}>{choice.label}</button>)}</div></div>
      <div className="setting-list">
        <div><span className="setting-copy"><strong>登录后自动启动</strong><small>让采办岛在 Windows 登录后进入顶部待命。</small></span><Switch checked={autostart} label="登录后自动启动" onChange={(next) => { const previous = autostart; setAutostart(next); void saveSetting('autostart', next ? '1' : '0', '启动设置已更新').then((ok) => { if (!ok) setAutostart(previous); }); }} /></div>
        <div><span className="setting-copy"><strong>磨砂背景</strong><small>系统不支持或高对比度开启时自动使用纯色。</small></span><Switch checked={acrylic} label="磨砂背景" onChange={(next) => { const previous = acrylic; setAcrylic(next); void saveSetting('acrylic_disabled', next ? '0' : '1', '背景效果已更新').then((ok) => { if (!ok) setAcrylic(previous); }); }} /></div>
        <div><span className="setting-copy"><strong>暂时隐藏顶部岛</strong><small>暂停后仍可从托盘恢复，退出也在托盘中完成。</small></span><Button icon={paused ? Play : Pause} onClick={() => void window.api.togglePause().then((value) => setPaused(value))}>{paused ? '恢复' : '暂停'}</Button></div>
      </div>
    </div>}

    {section === 'agent' && <div className="settings-section" role="tabpanel">
      <div className="section-heading"><div><h2>Agent 模型连接</h2><p>权限模式与授权目录在 Agent 工作区内管理。</p></div></div>
      <div className="connection-block">
        <div className="connection-head"><span><strong>Pi Agent · 多模型 Provider</strong><small>Key 分 Provider 加密保存；企业网关使用 OpenAI Chat Completions 兼容协议。</small></span><span className={'connection-status ' + (agentStatus?.profiles[agentProvider]?.configured ? 'configured' : '')}>{agentStatus?.profiles[agentProvider]?.configured ? '已配置' : '未配置'}</span></div>
        <div className="settings-form-grid agent-provider-grid">
          <label className="ui-field"><span className="ui-field-label">模型服务</span><select aria-label="Agent 模型服务" value={agentProvider} onChange={(event) => selectAgentProvider(event.target.value as AgentProviderId)}><option value="deepseek">DeepSeek 官方</option><option value="glm">智谱 GLM</option><option value="enterprise">企业模型网关</option></select></label>
          {agentProvider === 'glm' ? <label className="ui-field"><span className="ui-field-label">GLM 服务类型</span><select aria-label="GLM 服务地址" value={agentBaseUrl} onChange={(event) => setAgentBaseUrl(event.target.value)}><option value={GLM_BASE_URLS[0]}>开放平台通用 API</option><option value={GLM_BASE_URLS[1]}>Coding Plan</option></select></label> : <Field label={agentProvider === 'deepseek' ? '官方服务地址' : '企业 Base URL'} aria-label={agentProvider === 'deepseek' ? 'DeepSeek 官方服务地址' : '企业 Base URL'} value={agentBaseUrl} disabled={agentProvider === 'deepseek'} maxLength={2048} placeholder="https://gateway.example.com/v1" hint={agentProvider === 'enterprise' ? '填写到 /v1 等基础路径，不要包含 /chat/completions；仅支持 HTTPS，回环地址可用 HTTP。' : undefined} onChange={(event) => setAgentBaseUrl(event.target.value)} />}
          {agentProvider === 'enterprise' ? <Field label="企业模型 ID" aria-label="企业模型 ID" value={agentModel} maxLength={200} placeholder="例如企业网关公布的 gpt、claude 或 deepseek 模型 ID" hint="不限制模型品牌；请求会原样使用这个模型 ID。" onChange={(event) => setAgentModel(event.target.value)} /> : <label className="ui-field"><span className="ui-field-label">模型</span><select aria-label="Agent 模型" value={agentModel} onChange={(event) => setAgentModel(event.target.value)}>{agentProvider === 'deepseek' ? <><option value="deepseek-v4-flash">DeepSeek V4 Flash（默认）</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></> : GLM_MODELS.map((model) => <option key={model} value={model}>{model === 'glm-5.2' ? `${model}（默认）` : model}</option>)}</select></label>}
          <Field label={`${PROVIDER_LABELS[agentProvider]} API Key`} aria-label={`${PROVIDER_LABELS[agentProvider]} API Key`} type={agentKeyVisible ? 'text' : 'password'} value={agentKey} maxLength={8192} autoComplete="off" placeholder={agentStatus?.profiles[agentProvider]?.configured ? '已保存；留空表示不修改' : '粘贴 API Key'} hint={agentProvider === 'enterprise' ? '同一个企业 Key 可配合不同模型 ID 使用；Key 不会进入数据库明文或日志。' : 'Key 仅经 Windows safeStorage 加密保存。'} onChange={(event) => setAgentKey(event.target.value)} trailing={<IconButton icon={agentKeyVisible ? EyeOff : Eye} label={agentKeyVisible ? `隐藏${PROVIDER_LABELS[agentProvider]} API Key` : `显示${PROVIDER_LABELS[agentProvider]} API Key`} onClick={() => setAgentKeyVisible((value) => !value)} />} />
        </div>
        <p className="connection-test-note">连接测试不会发送采购资料；DeepSeek 读取模型列表，GLM 与企业网关只发送固定的“仅回复 OK”测试消息。</p>
        <div className="settings-actions"><Button icon={Save} variant="primary" disabled={busyAction === 'agent-provider-save' || !agentBaseUrl.trim() || !agentModel.trim() || (!agentStatus?.profiles[agentProvider]?.configured && !agentKey.trim())} onClick={() => void saveAgentProvider()}>{busyAction === 'agent-provider-save' ? '正在保存' : '保存并启用'}</Button><Button disabled={busyAction === 'agent-provider-test' || !agentStatus?.configured || agentStatus.provider !== agentProvider || agentStatus.baseUrl !== agentBaseUrl.trim() || agentStatus.model !== agentModel.trim()} onClick={() => void testAgentProvider()}>{busyAction === 'agent-provider-test' ? '正在测试' : '测试已保存配置'}</Button></div>
      </div>
    </div>}

    {section === 'feishu' && <div className="settings-section" role="tabpanel">
      <div className="section-heading"><div><h2>单向导出采购任务</h2></div></div>
      <div className="connection-block"><div className="connection-head"><span><strong>飞书多维表格</strong><small>以采办岛数据为准，不会从表格回写任务。</small></span><span className={'connection-status ' + (feishuStatus?.configured ? 'configured' : '')}>{feishuStatus?.configured ? '已配置' : '未配置'}</span></div>{feishuStatus?.lastSync && <p className={'sync-readout ' + (feishuStatus.lastSync.ok ? 'success' : 'error')}>最近同步 {feishuStatus.lastSync.at.slice(5, 16).replace('T', ' ')}：{feishuStatus.lastSync.ok ? `新增 ${feishuStatus.lastSync.created} 条，更新 ${feishuStatus.lastSync.updated} 条` : feishuStatus.lastSync.error ?? '失败'}</p>}<Field label="个人访问令牌" type={feishuTokenVisible ? 'text' : 'password'} value={feishuToken} placeholder="粘贴新令牌，保存后输入框会清空" onChange={(event) => setFeishuToken(event.target.value)} trailing={<IconButton icon={feishuTokenVisible ? EyeOff : Eye} label={feishuTokenVisible ? '隐藏飞书令牌' : '显示飞书令牌'} onClick={() => setFeishuTokenVisible((value) => !value)} />} /><div className="settings-actions"><Button icon={Save} variant="primary" disabled={busyAction === 'feishu-save' || !feishuToken.trim()} onClick={() => void saveFeishu()}>保存令牌</Button><Button disabled={busyAction === 'feishu-test'} onClick={() => void testFeishu()}>测试连接</Button><Button icon={Cloud} disabled={busyAction === 'feishu-sync'} onClick={() => void syncFeishu()}>立即同步</Button></div></div>
      <div className="setting-list"><div><span className="setting-copy"><strong>任务变更后自动同步</strong><small>短时间内的连续变更会合并后发送。</small></span><Switch checked={feishuStatus?.autoSync ?? false} label="任务变更后自动同步" onChange={(next) => void window.api.setFeishuAutoSync(next).then((result) => { if (result.ok) { setFeishuStatus((current) => current ? { ...current, autoSync: next } : current); showSuccess('自动同步设置已更新'); } else showError(result.error); })} /></div></div>
    </div>}

    {section === 'data' && <div className="settings-section" role="tabpanel"><div className="section-heading"><div><h2>本机数据与导出</h2></div></div><div className="setting-list"><div><span className="setting-copy"><strong>打开本机数据目录</strong><small>任务数据库、归档快照与备份都保存在这里。</small></span><Button icon={FolderOpen} onClick={() => void window.api.openDataDir().then((result) => result.ok ? showSuccess('数据目录已打开') : showError(result.error))}>打开目录</Button></div><div><span className="setting-copy"><strong>导出全部活跃任务</strong><small>用于离线备份或导入其他工具。</small></span><span className="settings-actions"><Button icon={Download} disabled={busyAction === 'export-csv'} onClick={() => void exportData('csv')}>导出 CSV</Button><Button icon={Download} disabled={busyAction === 'export-markdown'} onClick={() => void exportData('markdown')}>导出 Markdown</Button></span></div></div><details className="advanced-details"><summary>高级说明</summary><p>应用使用本机 SQLite 数据库和版本化迁移。Agent、renderer 与 CLI 都通过受限命令注册表工作。</p></details></div>}
  </div>;
}
