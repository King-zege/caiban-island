import { useEffect, useState } from 'react';
import { useTaskStore } from '../state/useStore';
import TaskCard from '../components/TaskCard';
import Carousel from '../components/Carousel';
import NewTaskForm from '../components/NewTaskForm';
import TaskDetailView from '../components/TaskDetailView';

export default function L2Panel(): React.JSX.Element {
  const tasks = useTaskStore((s) => s.tasks);
  const loading = useTaskStore((s) => s.loading);
  const load = useTaskStore((s) => s.load);
  const detail = useTaskStore((s) => s.detail);
  const detailLoading = useTaskStore((s) => s.detailLoading);
  const openDetail = useTaskStore((s) => s.openDetail);
  const closeDetail = useTaskStore((s) => s.closeDetail);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  // 表单/速览打开时面板加高（速览态），关闭后还原
  useEffect(() => {
    void window.api.setL2Detail(showForm || detail !== null);
  }, [showForm, detail]);

  const press = (v: boolean) => () => void window.api.interacting(v);

  const onCardClick = (index: number) => {
    const card = tasks[index];
    if (card) void openDetail(card.task.id);
  };

  return (
    <div className="panel l2-panel" onMouseEnter={press(true)} onMouseLeave={press(false)}>
      <header className="l2-header">
        <span className="l2-title">采办岛</span>
        <div className="l2-actions">
          <button className="btn" onPointerDown={press(true)} onPointerUp={press(false)} onPointerLeave={press(false)} onClick={() => setShowForm(true)}>
            新建
          </button>
          <button className="btn" onPointerDown={press(true)} onPointerUp={press(false)} onPointerLeave={press(false)} onClick={() => void window.api.setLevel('l3')}>
            设置
          </button>
        </div>
      </header>
      <div className="l2-body">
        {detailLoading ? (
          <span className="placeholder">加载中…</span>
        ) : detail ? (
          <TaskDetailView detail={detail} onBack={closeDetail} />
        ) : loading ? (
          <span className="placeholder">加载中…</span>
        ) : tasks.length === 0 ? (
          <span className="placeholder">暂无任务，点「新建」开始</span>
        ) : (
          <Carousel itemWidth={224} gap={12} onCardClick={onCardClick}>
            {tasks.map((card) => (
              <TaskCard key={card.task.id} card={card} />
            ))}
          </Carousel>
        )}
      </div>
      {showForm && <NewTaskForm onClose={() => setShowForm(false)} />}
    </div>
  );
}
