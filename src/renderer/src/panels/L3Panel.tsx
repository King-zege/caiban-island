import { useCallback, useState } from 'react';

type Tab = 'edit' | 'draft' | 'archive' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'edit', label: '任务编辑' },
  { id: 'draft', label: 'AI 草稿审核' },
  { id: 'archive', label: '归档' },
  { id: 'settings', label: '设置' }
];

export default function L3Panel(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('edit');
  const press = useCallback((v: boolean) => () => void window.api.interacting(v), []);

  return (
    <div className="panel l3-panel" onMouseEnter={press(true)} onMouseLeave={press(false)}>
      <header className="l3-header">
        <span className="l3-title">采办岛 · 详细</span>
        <div className="l3-actions">
          <button className="btn" onPointerDown={press(true)} onPointerUp={press(false)} onPointerLeave={press(false)} onClick={() => void window.api.setLevel('l2')}>
            返回
          </button>
          <button className="btn" onPointerDown={press(true)} onPointerUp={press(false)} onPointerLeave={press(false)} onClick={() => void window.api.quit()}>
            退出
          </button>
        </div>
      </header>
      <nav className="l3-nav" aria-label="分区">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={'nav-tab' + (tab === t.id ? ' active' : '')}
            onPointerDown={press(true)}
            onPointerUp={press(false)}
            onPointerLeave={press(false)}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="l3-content">
        <span className="placeholder">P2+：{TABS.find((t) => t.id === tab)?.label} 内容</span>
      </div>
    </div>
  );
}
