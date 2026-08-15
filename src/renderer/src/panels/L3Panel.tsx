import { useCallback, useEffect, useState } from 'react';
import { useTaskStore } from '../state/useStore';
import TaskEditor from '../components/TaskEditor';
import ArchiveView from '../components/ArchiveView';
import SettingsView from '../components/SettingsView';

type Tab = 'edit' | 'draft' | 'archive' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'edit', label: '任务编辑' },
  { id: 'draft', label: 'AI 草稿审核' },
  { id: 'archive', label: '归档' },
  { id: 'settings', label: '设置' }
];

export default function L3Panel(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('edit');
  const tasks = useTaskStore((s) => s.tasks);
  const load = useTaskStore((s) => s.load);
  const detail = useTaskStore((s) => s.detail);
  const openDetail = useTaskStore((s) => s.openDetail);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  // 从 L2 速览进入时选中 detail；否则默认第一个任务
  useEffect(() => {
    if (selectedId) return;
    const id = detail ? detail.task.id : tasks.length > 0 ? tasks[0].task.id : null;
    if (id) {
      setSelectedId(id);
      if (!detail) void openDetail(id);
    }
  }, [detail, tasks, selectedId, openDetail]);

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
        {tab === 'edit' && (
          <>
            {tasks.length === 0 ? (
              <span className="placeholder">暂无任务</span>
            ) : (
              <>
                <div className="task-picker">
                  {tasks.map((c) => (
                    <button
                      key={c.task.id}
                      className={'chip-btn' + (selectedId === c.task.id ? ' active' : '')}
                      onClick={() => {
                        setSelectedId(c.task.id);
                        void openDetail(c.task.id);
                      }}
                    >
                      {c.task.name}
                    </button>
                  ))}
                </div>
                {detail && detail.task.id === selectedId ? (
                  <div className="editor-scroll">
                    <TaskEditor detail={detail} />
                  </div>
                ) : (
                  <span className="placeholder">加载中…</span>
                )}
              </>
            )}
          </>
        )}
        {tab === 'draft' && <span className="placeholder">P5：AI 草稿审核</span>}
        {tab === 'archive' && (
          <div className="editor-scroll">
            <ArchiveView />
          </div>
        )}
        {tab === 'settings' && (
          <div className="editor-scroll">
            <SettingsView />
          </div>
        )}
      </div>
    </div>
  );
}
