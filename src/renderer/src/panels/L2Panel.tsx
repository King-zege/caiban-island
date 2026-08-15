import { useCallback } from 'react';

export default function L2Panel(): React.JSX.Element {
  const press = useCallback((v: boolean) => () => void window.api.interacting(v), []);

  return (
    <div className="panel l2-panel" onMouseEnter={press(true)} onMouseLeave={press(false)}>
      <header className="l2-header">
        <span className="l2-title">采办岛</span>
        <div className="l2-actions">
          <button className="btn" disabled title="P2 实现">
            新建
          </button>
          <button className="btn" onPointerDown={press(true)} onPointerUp={press(false)} onPointerLeave={press(false)} onClick={() => void window.api.setLevel('l3')}>
            设置
          </button>
        </div>
      </header>
      <div className="l2-body">
        <span className="placeholder">P2：任务卡片区（按紧急度排序）</span>
      </div>
    </div>
  );
}
