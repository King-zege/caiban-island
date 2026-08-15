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

  useEffect(() => {
    void window.api.getSettings().then((r) => {
      if (!r.ok) return;
      const s = r.data as { reminder_default_offsets: number[]; autostart: boolean; acrylic_disabled: boolean };
      setDefaultOffsets(s.reminder_default_offsets ?? []);
      setAutostart(s.autostart === true);
      setAcrylic(s.acrylic_disabled !== true);
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
        <h3 className="section-title">数据</h3>
        <p className="detail-empty">数据保存在 %APPDATA%\caiban-island（island.db + archive 快照）</p>
        <button className="btn small" onClick={() => void window.api.openDataDir()}>
          打开数据目录
        </button>
      </section>
    </div>
  );
}
