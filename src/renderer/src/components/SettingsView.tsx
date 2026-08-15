import { useEffect, useState } from 'react';

const OFFSET_CHOICES = [
  { label: '无', value: 0 },
  { label: '提前 30 分钟', value: 30 },
  { label: '提前 1 小时', value: 60 },
  { label: '提前 1 天', value: 1440 }
];

export default function SettingsView(): React.JSX.Element {
  const [defaultOffsets, setDefaultOffsets] = useState<number[]>([]);
  const [autostart, setAutostart] = useState(false);
  const [acrylic, setAcrylic] = useState(true);
  const [paused, setPaused] = useState(false);
  const [mcpConfig, setMcpConfig] = useState<{ url: string; stdioCommand: string } | null>(null);
  const [aiStatus, setAiStatus] = useState<{ configured: boolean; baseUrl: string; model: string } | null>(null);
  const [aiBase, setAiBase] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [fsToken, setFsToken] = useState('');
  const [fsStatus, setFsStatus] = useState<{ configured: boolean; autoSync: boolean; target: { appToken: string; tableId: string } | null } | null>(null);
  const [fsMsg, setFsMsg] = useState<string | null>(null);
  const [fsErr, setFsErr] = useState<string | null>(null);
  const [fsBusy, setFsBusy] = useState(false);

  useEffect(() => {
    void window.api.getSettings().then((r) => {
      if (!r.ok) return;
      const s = r.data as { reminder_default_offsets: number[]; autostart: boolean; acrylic_disabled: boolean };
      setDefaultOffsets(s.reminder_default_offsets ?? []);
      setAutostart(s.autostart === true);
      setAcrylic(s.acrylic_disabled !== true);
    });
    void window.api.getMcpConfig().then((r) => r.ok && setMcpConfig(r.data as { url: string; stdioCommand: string }));
    void window.api.getFeishuStatus().then((r) => r.ok && setFsStatus(r.data as { configured: boolean; autoSync: boolean; target: { appToken: string; tableId: string } | null }));
    void window.api.getAiStatus().then((r) => {
      if (!r.ok) return;
      const s = r.data as { configured: boolean; baseUrl: string; model: string };
      setAiStatus(s);
      setAiBase(s.baseUrl);
      setAiModel(s.model);
    });
  }, []);

  const toggleDefault = (v: number) => {
    let next: number[];
    if (v === 0) next = [];
    else if (defaultOffsets.includes(v)) next = defaultOffsets.filter((o) => o !== v);
    else next = [...defaultOffsets, v].sort((a, b) => a - b);
    setDefaultOffsets(next);
    void window.api.setSetting('reminder_default_offsets', JSON.stringify(next));
  };

  const setAutostartV = (v: boolean) => {
    setAutostart(v);
    void window.api.setSetting('autostart', v ? '1' : '0');
  };

  const setAcrylicV = (v: boolean) => {
    setAcrylic(v);
    void window.api.setSetting('acrylic_disabled', v ? '0' : '1');
  };

  return (
    <div className="settings-view">
      <section className="editor-section">
        <h3 className="section-title">提醒</h3>
        <p className="detail-empty">新建任务（有截止时间）时默认添加的提醒提前量，可多选</p>
        <div className="chip-group">
          {OFFSET_CHOICES.map((c) => (
            <button
              key={c.value}
              className={'chip-btn' + (c.value === 0 ? (defaultOffsets.length === 0 ? ' active' : '') : defaultOffsets.includes(c.value) ? ' active' : '')}
              onClick={() => toggleDefault(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </section>

      <section className="editor-section">
        <h3 className="section-title">岛</h3>
        <label className="setting-row">
          <span>随 Windows 登录启动</span>
          <input type="checkbox" checked={autostart} onChange={(e) => setAutostartV(e.target.checked)} />
        </label>
        <label className="setting-row">
          <span>启用磨砂效果（关闭后使用纯色回退）</span>
          <input type="checkbox" checked={acrylic} onChange={(e) => setAcrylicV(e.target.checked)} />
        </label>
        <div className="setting-row">
          <span>灵动岛当前{paused ? '已暂停' : '运行中'}</span>
          <button className="btn small" onClick={() => void window.api.togglePause().then((p) => setPaused(p))}>
            {paused ? '恢复' : '暂停'}
          </button>
        </div>
      </section>

      <section className="editor-section">
        <h3 className="section-title">Qoder MCP（主通道）</h3>
        <p className="detail-empty">在 Qoder 中注册此地址（个人设置 → MCP 服务 → 类型 SSE）：</p>
        <code className="mcp-url">{mcpConfig ? mcpConfig.url : '加载中…'}</code>
        <div className="setting-row">
          <span>备用命令（类型 STDIO）：</span>
        </div>
        <code className="mcp-url">{mcpConfig ? mcpConfig.stdioCommand : ''}</code>
        <div className="setting-row">
          <button
            className="btn small"
            onClick={() => mcpConfig && void navigator.clipboard.writeText(mcpConfig.url)}
          >
            复制地址
          </button>
          <button
            className="btn small danger-outline"
            onClick={() => void window.api.resetMcpToken().then((r) => r.ok && setMcpConfig(r.data as { url: string; stdioCommand: string }))}
          >
            重置令牌
          </button>
        </div>
      </section>

      <section className="editor-section">
        <h3 className="section-title">内置 AI（兜底通道）</h3>
        <p className="detail-empty">{aiStatus?.configured ? '已配置（' + (aiStatus.model || '') + '）' : '未配置 — 配置后可在草稿页使用 AI 拆解'}</p>
        <input className="text-input" value={aiBase} placeholder="Base URL，如 https://api.deepseek.com/v1" onChange={(e) => setAiBase(e.target.value)} />
        <input className="text-input" value={aiModel} placeholder="模型名，如 deepseek-chat" onChange={(e) => setAiModel(e.target.value)} />
        <input className="text-input" type="password" value={aiKey} placeholder="API Key（留空表示不修改）" onChange={(e) => setAiKey(e.target.value)} />
        <div className="setting-row">
          <button
            className="btn small"
            onClick={() => {
              setAiErr(null);
              setAiMsg(null);
              void window.api.saveAiConfig(aiBase, aiModel, aiKey).then((r) => {
                if (r.ok) {
                  setAiMsg('已保存');
                  setAiKey('');
                  void window.api.getAiStatus().then((s) => s.ok && setAiStatus(s.data as { configured: boolean; baseUrl: string; model: string }));
                } else setAiErr(r.error);
              });
            }}
          >
            保存配置
          </button>
          <button
            className="btn small"
            onClick={() => {
              setAiErr(null);
              setAiMsg(null);
              void window.api.testAi().then((r) => {
                if (r.ok) setAiMsg(r.data as string);
                else setAiErr(r.error);
              });
            }}
          >
            测试连接
          </button>
        </div>
        {aiMsg && <p className="note-saved">{aiMsg}</p>}
        {aiErr && <p className="form-error">{aiErr}</p>}
      </section>

      <section className="editor-section">
        <h3 className="section-title">飞书多维表格同步</h3>
        <p className="detail-empty">
          {fsStatus?.configured ? '已配置令牌' : '未配置'} · 目标：{fsStatus?.target ? fsStatus.target.appToken.slice(0, 8) + '…' : '（首次同步自动创建）'}
        </p>
        <input
          className="text-input"
          type="password"
          value={fsToken}
          placeholder="飞书多维表格个人令牌 PersonalBaseToken（加密保存）"
          onChange={(e) => setFsToken(e.target.value)}
        />
        <div className="setting-row">
          <button
            className="btn small"
            onClick={() => {
              setFsErr(null);
              setFsMsg(null);
              void window.api.saveFeishuToken(fsToken).then((r) => {
                if (r.ok) {
                  setFsToken('');
                  setFsMsg('令牌已保存');
                  void window.api.getFeishuStatus().then((s) => s.ok && setFsStatus(s.data as { configured: boolean; autoSync: boolean; target: { appToken: string; tableId: string } | null }));
                } else setFsErr(r.error);
              });
            }}
            disabled={fsToken.trim().length === 0}
          >
            保存令牌
          </button>
          <button
            className="btn small"
            onClick={() => {
              setFsErr(null);
              setFsMsg(null);
              void window.api.testFeishu().then((r) => {
                if (r.ok) setFsMsg(r.data as string);
                else setFsErr(r.error);
              });
            }}
          >
            测试连接
          </button>
          <button
            className="btn small primary"
            disabled={fsBusy}
            onClick={() => {
              setFsErr(null);
              setFsMsg(null);
              setFsBusy(true);
              void window.api.syncFeishu().then((r) => {
                setFsBusy(false);
                if (r.ok) setFsMsg('同步完成：新增 ' + r.data.created + ' 条，更新 ' + r.data.updated + ' 条');
                else setFsErr(r.error);
              });
            }}
          >
            {fsBusy ? '同步中…' : '同步到飞书'}
          </button>
        </div>
        <label className="setting-row">
          <span>任务变更后自动同步（防抖 3 秒）</span>
          <input
            type="checkbox"
            checked={fsStatus?.autoSync ?? false}
            onChange={(e) =>
              void window.api.setFeishuAutoSync(e.target.checked).then(() =>
                window.api.getFeishuStatus().then((r) => r.ok && setFsStatus(r.data as { configured: boolean; autoSync: boolean; target: { appToken: string; tableId: string } | null }))
              )
            }
          />
        </label>
        <div className="setting-row">
          <span>导出兜底（CSV / Markdown，可导入多维表格）</span>
          <div className="l2-actions">
            <button
              className="btn small"
              onClick={() => void window.api.exportCsv().then((r) => (r.ok ? setFsMsg('已导出：' + r.data) : setFsErr(r.error)))}
            >
              导出 CSV
            </button>
            <button
              className="btn small"
              onClick={() => void window.api.exportMarkdown().then((r) => (r.ok ? setFsMsg('已导出：' + r.data) : setFsErr(r.error)))}
            >
              导出 Markdown
            </button>
          </div>
        </div>
        {fsMsg && <p className="note-saved fs-msg">{fsMsg}</p>}
        {fsErr && <p className="form-error">{fsErr}</p>}
      </section>

      <section className="editor-section">
        <h3 className="section-title">数据</h3>
        <p className="detail-empty">数据保存在 %APPDATA%\caiban-island（island.db + archive 快照）</p>
        <button className="btn small" onClick={() => void window.api.openDataDir()}>
          打开数据目录
        </button>
      </section>
    </div>
  );
}
