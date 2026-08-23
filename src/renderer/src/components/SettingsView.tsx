import { Bot, Cloud, Copy, Database, Download, Eye, EyeOff, FolderOpen, Pause, Play, RefreshCw, Save, Settings2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { AiStatus, DeepSeekModel, DeepSeekStatus, MCPConfig } from '../../../shared/types';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import { AsyncFeedback } from './ui/AsyncFeedback';
import { Button, IconButton } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Field } from './ui/Field';
import { Switch } from './ui/Switch';

const OFFSET_CHOICES = [
  { label: '不自动提醒', value: 0 },
  { label: '提前 30 分钟', value: 30 },
  { label: '提前 1 小时', value: 60 },
  { label: '提前 1 天', value: 1440 }
];

type SettingsSection = 'common' | 'ai' | 'feishu' | 'data';
type FeishuStatus = {
  configured: boolean;
  autoSync: boolean;
  target: { appToken: string; tableId: string } | null;
  lastSync?: { at: string; ok: boolean; created: number; updated: number; error?: string } | null;
};

const SETTINGS_SECTIONS = [
  { id: 'common' as const, label: '常用', icon: Settings2 },
  { id: 'ai' as const, label: 'AI 与 Qoder', icon: Bot },
  { id: 'feishu' as const, label: '飞书同步', icon: Cloud },
  { id: 'data' as const, label: '数据与高级', icon: Database }
];

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

  const [mcpConfig, setMcpConfig] = useState<MCPConfig | null>(null);
  const [mcpVisible, setMcpVisible] = useState(false);
  const [resetMcpOpen, setResetMcpOpen] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiBase, setAiBase] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [aiKeyVisible, setAiKeyVisible] = useState(false);
  const [deepSeekStatus, setDeepSeekStatus] = useState<DeepSeekStatus | null>(null);
  const [deepSeekModel, setDeepSeekModel] = useState<DeepSeekModel>('deepseek-v4-flash');
  const [deepSeekKey, setDeepSeekKey] = useState('');
  const [deepSeekKeyVisible, setDeepSeekKeyVisible] = useState(false);

  const [feishuToken, setFeishuToken] = useState('');
  const [feishuTokenVisible, setFeishuTokenVisible] = useState(false);
  const [feishuStatus, setFeishuStatus] = useState<FeishuStatus | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setInitialError(null);
    const [settingsResult, mcpResult, feishuResult, aiResult, deepSeekResult] = await Promise.all([
      window.api.getSettings(),
      window.api.getMcpConfig(),
      window.api.getFeishuStatus(),
      window.api.getAiStatus(),
      window.api.getDeepSeekStatus()
    ]);
    setLoading(false);
    const failed = [settingsResult, mcpResult, feishuResult, aiResult, deepSeekResult].find((result) => !result.ok);
    if (failed && !failed.ok) setInitialError(failed.error);
    if (settingsResult.ok) {
      const settings = settingsResult.data as { reminder_default_offsets: number[]; autostart: boolean; acrylic_disabled: boolean };
      setDefaultOffsets(settings.reminder_default_offsets ?? []);
      setAutostart(settings.autostart === true);
      setAcrylic(settings.acrylic_disabled !== true);
    }
    if (mcpResult.ok) setMcpConfig(mcpResult.data);
    if (feishuResult.ok) setFeishuStatus(feishuResult.data as FeishuStatus);
    if (aiResult.ok) {
      setAiStatus(aiResult.data);
      setAiBase(aiResult.data.baseUrl);
      setAiModel(aiResult.data.model);
    }
    if (deepSeekResult.ok) {
      setDeepSeekStatus(deepSeekResult.data);
      setDeepSeekModel(deepSeekResult.data.model);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const showError = (message: string, retry?: () => void) => setFeedback({ tone: 'error', message, retry });
  const showSuccess = (message: string) => setFeedback({ tone: 'success', message });

  const saveSetting = async (key: string, value: string, success: string) => {
    const result = await window.api.setSetting(key, value);
    if (result.ok) {
      showSuccess(success);
      notify(success, 'success');
      return true;
    }
    showError(result.error, () => void saveSetting(key, value, success));
    return false;
  };

  const toggleDefault = async (value: number) => {
    const previous = defaultOffsets;
    const next = value === 0 ? [] : previous.includes(value) ? previous.filter((offset) => offset !== value) : [...previous, value].sort((left, right) => left - right);
    setDefaultOffsets(next);
    if (!await saveSetting('reminder_default_offsets', JSON.stringify(next), '默认提醒已更新')) setDefaultOffsets(previous);
  };

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showSuccess(label + '已复制');
    } catch {
      showError('复制失败，请再次尝试', () => void copyText(value, label));
    }
  };

  const resetMcp = async () => {
    setBusyAction('mcp-reset');
    const result = await window.api.resetMcpToken();
    setBusyAction(null);
    setResetMcpOpen(false);
    if (result.ok) {
      setMcpConfig(result.data);
      setMcpVisible(false);
      showSuccess('Qoder 会话凭据已更新');
    } else showError(result.error, () => void resetMcp());
  };

  const saveAi = async () => {
    setBusyAction('ai-save');
    const result = await window.api.saveAiConfig(aiBase, aiModel, aiKey);
    setBusyAction(null);
    if (!result.ok) {
      showError(result.error, () => void saveAi());
      return;
    }
    setAiKey('');
    const status = await window.api.getAiStatus();
    if (status.ok) setAiStatus(status.data);
    showSuccess('AI 配置已保存');
  };

  const testAi = async () => {
    setBusyAction('ai-test');
    const result = await window.api.testAi();
    setBusyAction(null);
    if (result.ok) showSuccess(result.data);
    else showError(result.error, () => void testAi());
  };

  const saveDeepSeek = async () => {
    setBusyAction('deepseek-save');
    const result = await window.api.saveDeepSeekConfig(deepSeekModel, deepSeekKey);
    setBusyAction(null);
    if (!result.ok) { showError(result.error, () => void saveDeepSeek()); return; }
    setDeepSeekKey('');
    setDeepSeekKeyVisible(false);
    const status = await window.api.getDeepSeekStatus();
    if (status.ok) setDeepSeekStatus(status.data);
    showSuccess('DeepSeek 配置已安全保存');
  };

  const testDeepSeek = async () => {
    setBusyAction('deepseek-test');
    const result = await window.api.testDeepSeek();
    setBusyAction(null);
    if (result.ok) showSuccess(result.data);
    else showError(result.error, () => void testDeepSeek());
  };

  const refreshFeishu = async () => {
    const result = await window.api.getFeishuStatus();
    if (result.ok) setFeishuStatus(result.data as FeishuStatus);
  };

  const saveFeishu = async () => {
    setBusyAction('feishu-save');
    const result = await window.api.saveFeishuToken(feishuToken);
    setBusyAction(null);
    if (!result.ok) {
      showError(result.error, () => void saveFeishu());
      return;
    }
    setFeishuToken('');
    setFeishuTokenVisible(false);
    await refreshFeishu();
    showSuccess('飞书令牌已安全保存');
  };

  const testFeishu = async () => {
    setBusyAction('feishu-test');
    const result = await window.api.testFeishu();
    setBusyAction(null);
    if (result.ok) showSuccess(result.data);
    else showError(result.error, () => void testFeishu());
  };

  const syncFeishu = async () => {
    setBusyAction('feishu-sync');
    const result = await window.api.syncFeishu();
    setBusyAction(null);
    if (result.ok) {
      showSuccess('同步完成：新增 ' + result.data.created + ' 条，更新 ' + result.data.updated + ' 条');
      await refreshFeishu();
    } else showError(result.error, () => void syncFeishu());
  };

  const exportData = async (kind: 'csv' | 'markdown') => {
    setBusyAction('export-' + kind);
    const result = kind === 'csv' ? await window.api.exportCsv() : await window.api.exportMarkdown();
    setBusyAction(null);
    if (result.ok) showSuccess(kind === 'csv' ? 'CSV 已导出' : 'Markdown 已导出');
    else showError(result.error, () => void exportData(kind));
  };

  if (loading) return <p className="loading-state section-loading">正在读取设置</p>;
  if (initialError) return <AsyncFeedback tone="error" message={initialError} onRetry={() => void load()} />;

  return (
    <div className="settings-view">
      <div className="standalone-heading"><div><span className="eyebrow">设置</span><h1>按你的工作方式调整</h1><p>主题与辅助功能自动跟随 Windows。</p></div></div>
      <nav className="settings-tabs" role="tablist" aria-label="设置分区">
        {SETTINGS_SECTIONS.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} data-settings-section={item.id} role="tab" aria-selected={section === item.id} className={section === item.id ? 'active' : ''} onClick={() => { setSection(item.id); setFeedback(null); }}><Icon aria-hidden="true" size={18} /><span>{item.label}</span></button>;
        })}
      </nav>

      {feedback && <AsyncFeedback tone={feedback.tone} message={feedback.message} onRetry={feedback.retry} />}

      {section === 'common' && (
        <div className="settings-section" role="tabpanel">
          <div className="section-heading"><div><span className="eyebrow">常用</span><h2>提醒与启动</h2></div></div>
          <div className="setting-group">
            <div className="setting-copy"><strong>新任务的默认提醒</strong><span>仅在任务设置了截止时间时生效，可多选。</span></div>
            <div className="segmented-control reminder-segments">{OFFSET_CHOICES.map((choice) => <button key={choice.value} type="button" className={choice.value === 0 ? defaultOffsets.length === 0 ? 'active' : '' : defaultOffsets.includes(choice.value) ? 'active' : ''} aria-pressed={choice.value === 0 ? defaultOffsets.length === 0 : defaultOffsets.includes(choice.value)} onClick={() => void toggleDefault(choice.value)}>{choice.label}</button>)}</div>
          </div>
          <div className="setting-list">
            <div><span className="setting-copy"><strong>登录后自动启动</strong><small>让采办岛在 Windows 登录后进入顶部待命。</small></span><Switch checked={autostart} label="登录后自动启动" onChange={(next) => { const previous = autostart; setAutostart(next); void saveSetting('autostart', next ? '1' : '0', '启动设置已更新').then((ok) => { if (!ok) setAutostart(previous); }); }} /></div>
            <div><span className="setting-copy"><strong>磨砂背景</strong><small>系统不支持或高对比度开启时自动使用纯色。</small></span><Switch checked={acrylic} label="磨砂背景" onChange={(next) => { const previous = acrylic; setAcrylic(next); void saveSetting('acrylic_disabled', next ? '0' : '1', '背景效果已更新').then((ok) => { if (!ok) setAcrylic(previous); }); }} /></div>
            <div><span className="setting-copy"><strong>暂时隐藏顶部岛</strong><small>暂停后仍可从托盘恢复，退出也在托盘中完成。</small></span><Button icon={paused ? Play : Pause} onClick={() => void window.api.togglePause().then((value) => setPaused(value))}>{paused ? '恢复' : '暂停'}</Button></div>
          </div>
        </div>
      )}

      {section === 'ai' && (
        <div className="settings-section" role="tabpanel">
          <div className="section-heading"><div><span className="eyebrow">AI 与 Qoder</span><h2>原生 Agent 与兼容通道</h2></div></div>
          <div className="connection-block">
            <div className="connection-head"><span><strong>Pi Agent · DeepSeek</strong><small>默认原生 Agent。只连接 DeepSeek 官方 API，正式修改必须逐次确认。</small></span><span className={'connection-status ' + (deepSeekStatus?.configured ? 'configured' : '')}>{deepSeekStatus?.configured ? '已配置' : '未配置'}</span></div>
            <div className="settings-form-grid">
              <label className="ui-field"><span className="ui-field-label">官方服务地址</span><input value="https://api.deepseek.com" disabled aria-label="DeepSeek 官方服务地址" /></label>
              <label className="ui-field"><span className="ui-field-label">模型</span><select value={deepSeekModel} onChange={(event) => setDeepSeekModel(event.target.value as DeepSeekModel)}><option value="deepseek-v4-flash">DeepSeek V4 Flash（默认）</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></select></label>
              <Field label="DeepSeek API Key" type={deepSeekKeyVisible ? 'text' : 'password'} value={deepSeekKey} placeholder="留空表示不修改" onChange={(event) => setDeepSeekKey(event.target.value)} trailing={<IconButton icon={deepSeekKeyVisible ? EyeOff : Eye} label={deepSeekKeyVisible ? '隐藏 DeepSeek API Key' : '显示 DeepSeek API Key'} onClick={() => setDeepSeekKeyVisible((value) => !value)} />} />
            </div>
            <div className="settings-actions"><Button icon={Save} variant="primary" disabled={busyAction === 'deepseek-save'} onClick={() => void saveDeepSeek()}>{busyAction === 'deepseek-save' ? '正在保存' : '保存配置'}</Button><Button disabled={busyAction === 'deepseek-test' || !deepSeekStatus?.configured} onClick={() => void testDeepSeek()}>{busyAction === 'deepseek-test' ? '正在测试' : '测试连接'}</Button></div>
          </div>
          <div className="connection-block">
            <div className="connection-head"><span><strong>Qoder 连接</strong><small>兼容通道。Qoder 只能创建待审核草稿。</small></span><span className="connection-status configured">已就绪</span></div>
            <div className="credential-box">
              <span>连接地址与会话凭据</span>
              <code>{mcpVisible && mcpConfig ? mcpConfig.url : '••••••••••••••••••••••••'}</code>
              <div><Button icon={mcpVisible ? EyeOff : Eye} variant="ghost" onClick={() => setMcpVisible((value) => !value)}>{mcpVisible ? '隐藏' : '显示'}</Button><Button icon={Copy} variant="ghost" disabled={!mcpConfig} onClick={() => mcpConfig && void copyText(mcpConfig.url, '连接地址')}>复制地址</Button></div>
            </div>
            <details className="advanced-details"><summary>高级：手动连接 Qoder</summary><p>在 Qoder 的个人设置中添加 MCP 服务。优先使用 SSE 地址；若需要 STDIO，再明确复制备用命令。</p>{mcpVisible && mcpConfig && <code>{mcpConfig.stdioCommand}</code>}<div className="advanced-actions"><Button icon={Copy} variant="ghost" disabled={!mcpConfig} onClick={() => mcpConfig && void copyText(mcpConfig.stdioCommand, '备用命令')}>复制备用命令</Button><Button icon={RefreshCw} variant="danger" onClick={() => setResetMcpOpen(true)}>重置会话凭据</Button></div></details>
          </div>
          <div className="connection-block">
            <div className="connection-head"><span><strong>内置 AI</strong><small>作为 Qoder 不可用时的备用草稿通道。</small></span><span className={'connection-status ' + (aiStatus?.configured ? 'configured' : '')}>{aiStatus?.configured ? '已配置' : '未配置'}</span></div>
            <div className="settings-form-grid">
              <Field label="服务地址" value={aiBase} placeholder="https://api.example.com/v1" onChange={(event) => setAiBase(event.target.value)} />
              <Field label="模型名称" value={aiModel} placeholder="model-name" onChange={(event) => setAiModel(event.target.value)} />
              <Field label="访问密钥" type={aiKeyVisible ? 'text' : 'password'} value={aiKey} placeholder="留空表示不修改" onChange={(event) => setAiKey(event.target.value)} trailing={<IconButton icon={aiKeyVisible ? EyeOff : Eye} label={aiKeyVisible ? '隐藏访问密钥' : '显示访问密钥'} onClick={() => setAiKeyVisible((value) => !value)} />} />
            </div>
            <div className="settings-actions"><Button icon={Save} variant="primary" disabled={busyAction === 'ai-save'} onClick={() => void saveAi()}>{busyAction === 'ai-save' ? '正在保存' : '保存配置'}</Button><Button disabled={busyAction === 'ai-test'} onClick={() => void testAi()}>{busyAction === 'ai-test' ? '正在测试' : '测试连接'}</Button></div>
          </div>
          <Dialog open={resetMcpOpen} title="重置 Qoder 会话凭据？" description="已有连接将立即失效，需要使用新地址重新连接。" onClose={() => setResetMcpOpen(false)} actions={<><Button variant="ghost" onClick={() => setResetMcpOpen(false)}>取消</Button><Button icon={RefreshCw} variant="danger" disabled={busyAction === 'mcp-reset'} onClick={() => void resetMcp()}>{busyAction === 'mcp-reset' ? '正在重置' : '确认重置'}</Button></>}><p>正式任务和草稿不会受到影响。</p></Dialog>
        </div>
      )}

      {section === 'feishu' && (
        <div className="settings-section" role="tabpanel">
          <div className="section-heading"><div><span className="eyebrow">飞书同步</span><h2>单向导出采购任务</h2></div></div>
          <div className="connection-block">
            <div className="connection-head"><span><strong>飞书多维表格</strong><small>以采办岛数据为准，不会从表格回写任务。</small></span><span className={'connection-status ' + (feishuStatus?.configured ? 'configured' : '')}>{feishuStatus?.configured ? '已配置' : '未配置'}</span></div>
            {feishuStatus?.lastSync && <p className={'sync-readout ' + (feishuStatus.lastSync.ok ? 'success' : 'error')}>最近同步 {feishuStatus.lastSync.at.slice(5, 16).replace('T', ' ')}：{feishuStatus.lastSync.ok ? '新增 ' + feishuStatus.lastSync.created + ' 条，更新 ' + feishuStatus.lastSync.updated + ' 条' : feishuStatus.lastSync.error ?? '失败'}</p>}
            <Field label="个人访问令牌" type={feishuTokenVisible ? 'text' : 'password'} value={feishuToken} placeholder="粘贴新令牌，保存后输入框会清空" onChange={(event) => setFeishuToken(event.target.value)} trailing={<IconButton icon={feishuTokenVisible ? EyeOff : Eye} label={feishuTokenVisible ? '隐藏飞书令牌' : '显示飞书令牌'} onClick={() => setFeishuTokenVisible((value) => !value)} />} />
            <div className="settings-actions"><Button icon={Save} variant="primary" disabled={busyAction === 'feishu-save' || feishuToken.trim().length === 0} onClick={() => void saveFeishu()}>{busyAction === 'feishu-save' ? '正在保存' : '保存令牌'}</Button><Button disabled={busyAction === 'feishu-test'} onClick={() => void testFeishu()}>{busyAction === 'feishu-test' ? '正在测试' : '测试连接'}</Button><Button icon={Cloud} disabled={busyAction === 'feishu-sync'} onClick={() => void syncFeishu()}>{busyAction === 'feishu-sync' ? '正在同步' : '立即同步'}</Button></div>
          </div>
          <div className="setting-list"><div><span className="setting-copy"><strong>任务变更后自动同步</strong><small>短时间内的连续变更会合并后发送。</small></span><Switch checked={feishuStatus?.autoSync ?? false} label="任务变更后自动同步" onChange={(next) => void window.api.setFeishuAutoSync(next).then((result) => { if (result.ok) { setFeishuStatus((current) => current ? { ...current, autoSync: next } : current); showSuccess('自动同步设置已更新'); } else showError(result.error); })} /></div></div>
        </div>
      )}

      {section === 'data' && (
        <div className="settings-section" role="tabpanel">
          <div className="section-heading"><div><span className="eyebrow">数据与高级</span><h2>本机数据与导出</h2></div></div>
          <div className="setting-list">
            <div><span className="setting-copy"><strong>打开本机数据目录</strong><small>任务数据库、归档快照与备份都保存在这里。</small></span><Button icon={FolderOpen} onClick={() => void window.api.openDataDir().then((result) => result.ok ? showSuccess('数据目录已打开') : showError(result.error))}>打开目录</Button></div>
            <div><span className="setting-copy"><strong>导出全部活跃任务</strong><small>用于离线备份或导入其他工具。</small></span><span className="settings-actions"><Button icon={Download} disabled={busyAction === 'export-csv'} onClick={() => void exportData('csv')}>导出 CSV</Button><Button icon={Download} disabled={busyAction === 'export-markdown'} onClick={() => void exportData('markdown')}>导出 Markdown</Button></span></div>
          </div>
          <details className="advanced-details"><summary>高级说明</summary><p>应用使用本机 SQLite 数据库，并通过版本化迁移更新结构。界面无法访问数据库或文件系统，所有操作都由受限的应用通道完成。</p><p>关闭磨砂或系统不支持 Acrylic 时，窗口会自动切换到确定性的纯色背景。</p></details>
        </div>
      )}
    </div>
  );
}
