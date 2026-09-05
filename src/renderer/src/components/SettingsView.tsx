import { Bot, Cloud, Database, Download, Eye, EyeOff, FolderOpen, Pause, Play, RefreshCw, Save, Settings2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent } from 'react';
import { DEEPSEEK_BASE_URL, DEEPSEEK_MODELS, GLM_BASE_URLS, GLM_MODELS, PENG_OPENAI_BASE_URL, PENG_PROVIDER_IDS } from '../../../shared/types';
import type { AgentProviderId, AgentProviderStatus, FeishuBotStatus, FeishuPairingCode } from '../../../shared/types';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import { AsyncFeedback } from './ui/AsyncFeedback';
import { Button, IconButton } from './ui/Button';
import { Field } from './ui/Field';
import { Switch } from './ui/Switch';
import FeishuSetupWizard, { feishuDiagnosis, parseFeishuCredentialPaste } from './FeishuSetupWizard';

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
  { id: 'feishu' as const, label: '飞书', icon: Cloud },
  { id: 'data' as const, label: '数据与高级', icon: Database }
];

const PROVIDER_LABELS: Record<AgentProviderId, string> = {
  deepseek: 'DeepSeek 官方',
  glm: '智谱 GLM',
  peng: 'Peng 企业网关'
};

const isPengProvider = (provider: AgentProviderId): boolean => PENG_PROVIDER_IDS.includes(provider as (typeof PENG_PROVIDER_IDS)[number]);

export default function SettingsView(): React.JSX.Element {
  const notify = useWorkspaceStore((state) => state.notify);
  const setupRequested = window.sessionStorage.getItem('caiban-open-feishu-setup') === '1';
  const [section, setSection] = useState<SettingsSection>(setupRequested ? 'feishu' : 'common');
  const [showFeishuWizard, setShowFeishuWizard] = useState(setupRequested);
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
  const [pengModels, setPengModels] = useState<string[]>([]);
  const [feishuToken, setFeishuToken] = useState('');
  const [feishuTokenVisible, setFeishuTokenVisible] = useState(false);
  const [feishuStatus, setFeishuStatus] = useState<FeishuStatus | null>(null);
  const [feishuAgentStatus, setFeishuAgentStatus] = useState<FeishuBotStatus | null>(null);
  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');
  const [feishuAppSecretVisible, setFeishuAppSecretVisible] = useState(false);
  const [feishuAgentEnabled, setFeishuAgentEnabled] = useState(false);
  const [pairingCode, setPairingCode] = useState<FeishuPairingCode | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setInitialError(null);
    const [settingsResult, feishuResult, agentResult, feishuAgentResult] = await Promise.all([
      window.api.getSettings(), window.api.getFeishuStatus(), window.api.getAgentProviderStatus(), window.api.getFeishuAgentStatus()
    ]);
    setLoading(false);
    const failed = [settingsResult, feishuResult, agentResult, feishuAgentResult].find((result) => !result.ok);
    if (failed && !failed.ok) setInitialError(failed.error);
    if (settingsResult.ok) {
      const settings = settingsResult.data as { reminder_default_offsets: number[]; autostart: boolean; acrylic_disabled: boolean };
      setDefaultOffsets(settings.reminder_default_offsets ?? []); setAutostart(settings.autostart === true); setAcrylic(settings.acrylic_disabled !== true);
    }
    if (feishuResult.ok) setFeishuStatus(feishuResult.data as FeishuStatus);
    if (feishuAgentResult.ok) {
      setFeishuAgentStatus(feishuAgentResult.data);
      setFeishuAppId(feishuAgentResult.data.appId);
      setFeishuAgentEnabled(feishuAgentResult.data.enabled);
    }
    if (agentResult.ok) {
      setAgentStatus(agentResult.data);
      setAgentProvider(agentResult.data.provider);
      setAgentBaseUrl(agentResult.data.baseUrl);
      setAgentModel(agentResult.data.model);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    window.sessionStorage.removeItem('caiban-open-feishu-setup');
    if (typeof window.api.onFeishuAgentChanged !== 'function') return;
    return window.api.onFeishuAgentChanged((status) => {
      setFeishuAgentStatus(status);
      setFeishuAgentEnabled(status.enabled);
      if (status.appId) setFeishuAppId(status.appId);
    });
  }, []);
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
    setAgentBaseUrl(saved?.baseUrl || (provider === 'deepseek' ? DEEPSEEK_BASE_URL : provider === 'glm' ? GLM_BASE_URLS[0] : PENG_OPENAI_BASE_URL));
    setAgentModel(saved?.model || (provider === 'deepseek' ? DEEPSEEK_MODELS[0] : provider === 'glm' ? GLM_MODELS[0] : ''));
    setAgentKey('');
    setAgentKeyVisible(false);
    setPengModels([]);
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
  const discoverPengModels = async () => {
    setBusyAction('agent-provider-models'); const result = await window.api.discoverPengModels(agentKey); setBusyAction(null);
    if (!result.ok) { showError(result.error, () => void discoverPengModels()); return; }
    setPengModels(result.data.models);
    if (!result.data.models.includes(agentModel)) setAgentModel(result.data.models[0] ?? '');
    showSuccess(`已获取 ${result.data.models.length} 个模型`);
  };
  const refreshFeishu = async () => { const result = await window.api.getFeishuStatus(); if (result.ok) setFeishuStatus(result.data as FeishuStatus); };
  const saveFeishu = async () => {
    setBusyAction('feishu-save'); const result = await window.api.saveFeishuToken(feishuToken); setBusyAction(null);
    if (!result.ok) { showError(result.error, () => void saveFeishu()); return; }
    setFeishuToken(''); setFeishuTokenVisible(false); await refreshFeishu(); showSuccess('飞书令牌已安全保存');
  };
  const testFeishu = async () => { setBusyAction('feishu-test'); const result = await window.api.testFeishu(); setBusyAction(null); if (result.ok) showSuccess(result.data); else showError(result.error, () => void testFeishu()); };
  const saveFeishuAgent = async () => {
    setBusyAction('feishu-agent-save');
    const result = await window.api.saveFeishuAgentConfig({ appId: feishuAppId, appSecret: feishuAppSecret, enabled: feishuAgentEnabled });
    setBusyAction(null);
    if (!result.ok) { showError(result.error, () => void saveFeishuAgent()); return; }
    setFeishuAgentStatus(result.data); setFeishuAppSecret(''); setFeishuAppSecretVisible(false);
    if (result.data.enabled && result.data.connectionState !== 'connected') showError(`配置已保存，但连接失败（${result.data.lastErrorCategory ?? 'unknown'}）`, () => void testFeishuAgent());
    else showSuccess('飞书机器人配置已安全保存');
  };
  const testFeishuAgent = async () => { setBusyAction('feishu-agent-test'); const result = await window.api.testFeishuAgent(); setBusyAction(null); if (result.ok) showSuccess(result.data); else showError(result.error, () => void testFeishuAgent()); };
  const reconnectFeishuAgent = async () => { setBusyAction('feishu-agent-reconnect'); const result = await window.api.reconnectFeishuAgent(); setBusyAction(null); if (result.ok) { setFeishuAgentStatus(result.data); showSuccess(`已连接${result.data.botName ? `：${result.data.botName}` : ''}`); } else showError(result.error, () => void reconnectFeishuAgent()); };
  const generatePairingCode = async () => { const result = await window.api.generateFeishuPairingCode(); if (result.ok) { setPairingCode(result.data); showSuccess('已生成一次性配对码'); } else showError(result.error); };
  const revokePairedUser = async (openId: string) => { const result = await window.api.revokeFeishuPairedUser(openId); if (result.ok) { setFeishuAgentStatus(result.data); showSuccess('已撤销飞书用户授权'); } else showError(result.error); };
  const toggleFeishuDiagnostics = async (enabled: boolean) => { const result = await window.api.setFeishuAgentDiagnosticsEnabled(enabled); if (result.ok) { setFeishuAgentStatus(result.data); showSuccess(enabled ? '诊断记录已开启' : '诊断记录已关闭并清空'); } else showError(result.error); };
  const exportFeishuDiagnostics = async () => { setBusyAction('feishu-agent-export-diagnostics'); const result = await window.api.exportFeishuAgentDiagnostics(); setBusyAction(null); if (result.ok) showSuccess(`已导出 ${result.data.entryCount} 条诊断记录`); else if (result.error !== '已取消导出') showError(result.error); };
  const pasteFeishuCredentials = (event: ReactClipboardEvent<HTMLInputElement>) => {
    const parsed = parseFeishuCredentialPaste(event.clipboardData.getData('text'));
    if (!parsed.appId && !parsed.appSecret) return;
    event.preventDefault();
    if (parsed.appId) setFeishuAppId(parsed.appId);
    if (parsed.appSecret) setFeishuAppSecret(parsed.appSecret);
  };
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
      {agentStatus?.pengMigrationRequired && <AsyncFeedback tone="error" message="旧企业网关不是 Peng 地址，原密钥未被发送或迁移。请重新配置 Peng Key；成功保存后会清理旧配置。" />}
      <div className="connection-block">
        <div className="connection-head"><span><strong>Pi Agent · 多模型 Provider</strong><small>DeepSeek、GLM 与 Peng 分别保存配置；Peng 使用统一企业 Key 和模型。</small></span><span className={'connection-status ' + (agentStatus?.profiles[agentProvider]?.configured ? 'configured' : '')}>{agentStatus?.profiles[agentProvider]?.configured ? '已配置' : '未配置'}</span></div>
        <div className="settings-form-grid agent-provider-grid">
          <label className="ui-field"><span className="ui-field-label">模型服务</span><select aria-label="Agent 模型服务" value={agentProvider} onChange={(event) => selectAgentProvider(event.target.value as AgentProviderId)}>{Object.entries(PROVIDER_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          {agentProvider === 'glm' ? <label className="ui-field"><span className="ui-field-label">GLM 服务类型</span><select aria-label="GLM 服务地址" value={agentBaseUrl} onChange={(event) => setAgentBaseUrl(event.target.value)}><option value={GLM_BASE_URLS[0]}>开放平台通用 API</option><option value={GLM_BASE_URLS[1]}>Coding Plan</option></select></label> : <Field label="服务地址" aria-label="Agent 服务地址" value={agentBaseUrl} disabled maxLength={2048} hint={isPengProvider(agentProvider) ? '统一 OpenAI 兼容入口；运行时自行追加 /chat/completions。' : 'DeepSeek 官方固定入口。'} onChange={(event) => setAgentBaseUrl(event.target.value)} />}
          {isPengProvider(agentProvider) ? <><Field label={pengModels.length > 0 ? '搜索或选择 Peng 模型' : 'Peng 模型 ID'} aria-label="Peng 模型 ID" list={pengModels.length > 0 ? 'peng-model-options' : undefined} value={agentModel} maxLength={200} placeholder="先验证 Key 并获取模型" hint={pengModels.length > 0 ? '输入可搜索目录；保存后可测试所选模型。' : '从网关返回列表选择模型，不再区分 OpenAI、Anthropic 或 DeepSeek 模式。'} onChange={(event) => setAgentModel(event.target.value)} />{pengModels.length > 0 && <datalist id="peng-model-options">{pengModels.map((model) => <option key={model} value={model} />)}</datalist>}</> : <label className="ui-field"><span className="ui-field-label">模型</span><select aria-label="Agent 模型" value={agentModel} onChange={(event) => setAgentModel(event.target.value)}>{agentProvider === 'deepseek' ? <><option value="deepseek-v4-flash">DeepSeek V4 Flash（默认）</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></> : GLM_MODELS.map((model) => <option key={model} value={model}>{model === 'glm-5.2' ? `${model}（默认）` : model}</option>)}</select></label>}
          <Field label={isPengProvider(agentProvider) ? 'Peng 企业 API Key' : `${PROVIDER_LABELS[agentProvider]} API Key`} aria-label={isPengProvider(agentProvider) ? 'Peng 企业 API Key' : `${PROVIDER_LABELS[agentProvider]} API Key`} type={agentKeyVisible ? 'text' : 'password'} value={agentKey} maxLength={8192} autoComplete="off" placeholder={(isPengProvider(agentProvider) ? agentStatus?.pengKeyConfigured : agentStatus?.profiles[agentProvider]?.configured) ? '已保存；留空表示不修改' : '粘贴 API Key'} hint={isPengProvider(agentProvider) ? 'Peng 只保存一份企业 Key；不会进入数据库明文、renderer 返回值或日志。' : 'Key 仅经 Windows safeStorage 加密保存。'} onChange={(event) => setAgentKey(event.target.value)} trailing={<IconButton icon={agentKeyVisible ? EyeOff : Eye} label={agentKeyVisible ? '隐藏 API Key' : '显示 API Key'} onClick={() => setAgentKeyVisible((value) => !value)} />} />
        </div>
        <p className="connection-test-note">模型测试只发送固定的“仅回复 OK”，不携带采购资料。Peng 模型目录统一使用 Bearer 鉴权读取。</p>
        <div className="settings-actions">{isPengProvider(agentProvider) && <Button disabled={busyAction === 'agent-provider-models' || (!agentKey.trim() && !agentStatus?.pengKeyConfigured)} onClick={() => void discoverPengModels()}>{busyAction === 'agent-provider-models' ? '正在获取' : '验证 Key 并获取模型'}</Button>}<Button icon={Save} variant="primary" disabled={busyAction === 'agent-provider-save' || !agentBaseUrl.trim() || !agentModel.trim() || (!(isPengProvider(agentProvider) ? agentStatus?.pengKeyConfigured : agentStatus?.profiles[agentProvider]?.configured) && !agentKey.trim())} onClick={() => void saveAgentProvider()}>{busyAction === 'agent-provider-save' ? '正在保存' : '保存并启用'}</Button><Button disabled={busyAction === 'agent-provider-test' || !agentStatus?.configured || agentStatus.provider !== agentProvider || agentStatus.baseUrl !== agentBaseUrl.trim() || agentStatus.model !== agentModel.trim()} onClick={() => void testAgentProvider()}>{busyAction === 'agent-provider-test' ? '正在测试' : '测试已保存配置'}</Button></div>
      </div>
    </div>}

    {section === 'feishu' && <div className="settings-section" role="tabpanel">
      <div className="section-heading"><div><h2>飞书连接</h2><p>Agent 机器人与多维表格是彼此独立的能力。</p></div><Button icon={Bot} onClick={() => setShowFeishuWizard(true)}>{feishuAgentStatus?.configured ? '重新运行连接向导' : '开始连接向导'}</Button></div>
      {showFeishuWizard && feishuAgentStatus ? <FeishuSetupWizard status={feishuAgentStatus} onStatusChange={(status) => { setFeishuAgentStatus(status); setFeishuAgentEnabled(status.enabled); setFeishuAppId(status.appId); }} onClose={() => setShowFeishuWizard(false)} /> : <div className="connection-block">
        <div className="connection-head"><span><strong>飞书 Agent 机器人</strong><small>{feishuAgentStatus?.botName ? `机器人：${feishuAgentStatus.botName}` : '应用运行时通过官方长连接收取私聊或群内 @机器人 消息，不开放公网 Webhook。'}</small></span><span className={'connection-status ' + (feishuAgentStatus?.connectionState === 'connected' ? 'configured' : '')}>{feishuAgentStatus?.connectionState === 'connected' ? '已连接' : feishuAgentStatus?.connectionState === 'connecting' || feishuAgentStatus?.connectionState === 'reconnecting' ? '连接中' : feishuAgentStatus?.enabled ? '未连接' : '未启用'}</span></div>
        {feishuAgentStatus && feishuDiagnosis(feishuAgentStatus) && <div className="feishu-inline-diagnosis" role="alert"><strong>{feishuDiagnosis(feishuAgentStatus)?.title}</strong><span>{feishuDiagnosis(feishuAgentStatus)?.detail}</span>{feishuAgentStatus.lastErrorMessage && <small>{feishuAgentStatus.lastErrorMessage}</small>}</div>}
        <div className="settings-form-grid">
          <Field label="飞书应用 App ID" aria-label="飞书应用 App ID" value={feishuAppId} maxLength={200} placeholder="cli_..." error={feishuAppId.length > 0 && !/^cli_[A-Za-z0-9]+$/u.test(feishuAppId.trim()) ? '应以 cli_ 开头，且只包含字母和数字。' : null} onPaste={pasteFeishuCredentials} onChange={(event) => setFeishuAppId(event.target.value)} />
          <Field label="飞书应用 App Secret" aria-label="飞书应用 App Secret" type={feishuAppSecretVisible ? 'text' : 'password'} value={feishuAppSecret} maxLength={8192} autoComplete="off" placeholder={feishuAgentStatus?.configured ? '已保存；留空表示不修改' : '粘贴 App Secret'} hint="App Secret 仅经 Windows safeStorage 加密保存；支持粘贴两行 App ID + Secret。" onPaste={pasteFeishuCredentials} onChange={(event) => setFeishuAppSecret(event.target.value)} trailing={<IconButton icon={feishuAppSecretVisible ? EyeOff : Eye} label={feishuAppSecretVisible ? '隐藏 App Secret' : '显示 App Secret'} onClick={() => setFeishuAppSecretVisible((value) => !value)} />} />
        </div>
        <div className="setting-list compact-setting-list"><div><span className="setting-copy"><strong>启用 Agent 机器人</strong><small>启用后随采办岛连接并自动重连；禁用会取消正在执行的飞书任务与待审批。</small></span><Switch checked={feishuAgentEnabled} label="启用 Agent 机器人" onChange={setFeishuAgentEnabled} /></div></div>
        <p className="connection-test-note">飞书后台仅订阅 <code>im.message.receive_v1</code> 与 <code>card.action.trigger</code>；授权私聊、群内 @机器人、机器人发消息及读取/更新机器人消息，不申请附件或群内全部消息权限。</p>
        <div className="settings-actions"><Button icon={Save} variant="primary" disabled={busyAction === 'feishu-agent-save' || !/^cli_[A-Za-z0-9]+$/u.test(feishuAppId.trim()) || (!feishuAgentStatus?.configured && !feishuAppSecret.trim())} onClick={() => void saveFeishuAgent()}>{busyAction === 'feishu-agent-save' ? '正在保存' : '保存机器人配置'}</Button><Button disabled={busyAction === 'feishu-agent-test' || !feishuAgentStatus?.configured} onClick={() => void testFeishuAgent()}>{busyAction === 'feishu-agent-test' ? '正在测试' : '测试长连接'}</Button><Button icon={RefreshCw} disabled={busyAction === 'feishu-agent-reconnect' || !feishuAgentStatus?.enabled} onClick={() => void reconnectFeishuAgent()}>{busyAction === 'feishu-agent-reconnect' ? '正在重连' : '立即重连'}</Button><Button disabled={!feishuAgentStatus?.configured} onClick={() => void generatePairingCode()}>生成配对码</Button></div>
        {pairingCode && <div className="pairing-code" role="status"><strong>{pairingCode.code}</strong><span>10 分钟内在机器人私聊发送 <code>/bind {pairingCode.code}</code>，到期时间 {new Date(pairingCode.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>}
        <div className="paired-users"><strong>已配对用户</strong>{feishuAgentStatus?.pairedUsers.length ? feishuAgentStatus.pairedUsers.map((user) => <div key={user.openId}><span>{user.displayName || user.openId}<small>配对于 {new Date(user.pairedAt).toLocaleString()}</small></span><Button onClick={() => void revokePairedUser(user.openId)}>撤销</Button></div>) : <p>尚无已配对用户。</p>}</div>
        <div className="setting-list compact-setting-list"><div><span className="setting-copy"><strong>诊断记录</strong><small>默认关闭；只记录连接状态、错误类别和去重计数，不记录消息正文、Secret 或 token。</small></span><Switch checked={feishuAgentStatus?.diagnosticsEnabled ?? false} label="飞书机器人诊断记录" onChange={(next) => void toggleFeishuDiagnostics(next)} /></div></div>
        <div className="settings-actions"><Button icon={Download} disabled={!feishuAgentStatus?.diagnosticsEnabled || busyAction === 'feishu-agent-export-diagnostics'} onClick={() => void exportFeishuDiagnostics()}>{busyAction === 'feishu-agent-export-diagnostics' ? '正在导出' : '导出诊断日志'}</Button></div>
      </div>}
      <div className="section-heading subsection-heading"><div><h2>飞书多维表格单向导出</h2></div></div>
      <div className="connection-block"><div className="connection-head"><span><strong>飞书多维表格</strong><small>以采办岛数据为准，不会从表格回写任务。</small></span><span className={'connection-status ' + (feishuStatus?.configured ? 'configured' : '')}>{feishuStatus?.configured ? '已配置' : '未配置'}</span></div>{feishuStatus?.lastSync && <p className={'sync-readout ' + (feishuStatus.lastSync.ok ? 'success' : 'error')}>最近同步 {feishuStatus.lastSync.at.slice(5, 16).replace('T', ' ')}：{feishuStatus.lastSync.ok ? `新增 ${feishuStatus.lastSync.created} 条，更新 ${feishuStatus.lastSync.updated} 条` : feishuStatus.lastSync.error ?? '失败'}</p>}<Field label="个人访问令牌" type={feishuTokenVisible ? 'text' : 'password'} value={feishuToken} placeholder="粘贴新令牌，保存后输入框会清空" onChange={(event) => setFeishuToken(event.target.value)} trailing={<IconButton icon={feishuTokenVisible ? EyeOff : Eye} label={feishuTokenVisible ? '隐藏飞书令牌' : '显示飞书令牌'} onClick={() => setFeishuTokenVisible((value) => !value)} />} /><div className="settings-actions"><Button icon={Save} variant="primary" disabled={busyAction === 'feishu-save' || !feishuToken.trim()} onClick={() => void saveFeishu()}>保存令牌</Button><Button disabled={busyAction === 'feishu-test'} onClick={() => void testFeishu()}>测试连接</Button><Button icon={Cloud} disabled={busyAction === 'feishu-sync'} onClick={() => void syncFeishu()}>立即同步</Button></div></div>
      <div className="setting-list"><div><span className="setting-copy"><strong>任务变更后自动同步</strong><small>短时间内的连续变更会合并后发送。</small></span><Switch checked={feishuStatus?.autoSync ?? false} label="任务变更后自动同步" onChange={(next) => void window.api.setFeishuAutoSync(next).then((result) => { if (result.ok) { setFeishuStatus((current) => current ? { ...current, autoSync: next } : current); showSuccess('自动同步设置已更新'); } else showError(result.error); })} /></div></div>
    </div>}

    {section === 'data' && <div className="settings-section" role="tabpanel"><div className="section-heading"><div><h2>本机数据与导出</h2></div></div><div className="setting-list"><div><span className="setting-copy"><strong>打开本机数据目录</strong><small>任务数据库、归档快照与备份都保存在这里。</small></span><Button icon={FolderOpen} onClick={() => void window.api.openDataDir().then((result) => result.ok ? showSuccess('数据目录已打开') : showError(result.error))}>打开目录</Button></div><div><span className="setting-copy"><strong>导出全部活跃任务</strong><small>用于离线备份或导入其他工具。</small></span><span className="settings-actions"><Button icon={Download} disabled={busyAction === 'export-csv'} onClick={() => void exportData('csv')}>导出 CSV</Button><Button icon={Download} disabled={busyAction === 'export-markdown'} onClick={() => void exportData('markdown')}>导出 Markdown</Button></span></div></div><details className="advanced-details"><summary>高级说明</summary><p>应用使用本机 SQLite 数据库和版本化迁移。Agent、renderer 与 CLI 都通过受限命令注册表工作。</p></details></div>}
  </div>;
}
