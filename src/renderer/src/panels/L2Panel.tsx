import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, ClipboardList, Maximize2, MoreHorizontal, Plus, Settings } from 'lucide-react';
import { useTaskStore } from '../state/useStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import TaskCard from '../components/TaskCard';
import Carousel from '../components/Carousel';
import NewTaskForm from '../components/NewTaskForm';
import WelcomeView from '../components/WelcomeView';
import { Button, IconButton } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';

type SortMode = 'deadline' | 'urgency' | 'updated';
const URGENCY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 } as const;

export default function L2Panel({ reducedMotion }: { reducedMotion: boolean }): React.JSX.Element {
  const tasks = useTaskStore((state) => state.tasks);
  const loading = useTaskStore((state) => state.loading);
  const load = useTaskStore((state) => state.load);
  const openTask = useWorkspaceStore((state) => state.openTask);
  const openSection = useWorkspaceStore((state) => state.openSection);
  const [showForm, setShowForm] = useState(false);
  const [onboarded, setOnboarded] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [sortMode, setSortMode] = useState<SortMode>('deadline');

  useEffect(() => {
    void load();
    void window.api.getSettings().then((result) => {
      if (result.ok) setOnboarded((result.data as { onboarded: boolean }).onboarded === true);
    });
  }, [load]);

  useEffect(() => {
    void window.api.setL2Detail(showForm);
  }, [showForm]);

  const sortedTasks = useMemo(() => [...tasks].sort((left, right) => {
    if (sortMode === 'urgency') return URGENCY_ORDER[left.task.urgency] - URGENCY_ORDER[right.task.urgency];
    if (sortMode === 'updated') return right.task.updatedAtUtc.localeCompare(left.task.updatedAtUtc);
    const leftDeadline = left.task.deadlineUtc ?? '9999';
    const rightDeadline = right.task.deadlineUtc ?? '9999';
    return leftDeadline.localeCompare(rightDeadline) || left.task.id.localeCompare(right.task.id);
  }), [sortMode, tasks]);

  useEffect(() => {
    if (activeIndex >= sortedTasks.length) setActiveIndex(Math.max(0, sortedTasks.length - 1));
  }, [activeIndex, sortedTasks.length]);

  const press = (value: boolean) => () => void window.api.interacting(value);

  const enterWorkspace = (taskId?: string) => {
    if (taskId) openTask(taskId);
    else openSection('tasks');
    void window.api.setLevel('l3');
  };

  const openSettings = () => {
    openSection('settings');
    void window.api.setLevel('l3');
  };

  return (
    <div className="panel l2-panel" onMouseEnter={press(true)} onMouseLeave={press(false)}>
      <header className="l2-header">
        <div className="panel-brand">
          <span className="brand-mark" aria-hidden="true" />
          <span><strong>采办岛</strong><small>采购工作台</small></span>
        </div>
        <div className="l2-actions">
          <Button icon={Plus} variant="primary" onClick={() => setShowForm(true)}>新建</Button>
          <IconButton icon={Maximize2} label="展开工作台" onClick={() => enterWorkspace(sortedTasks[activeIndex]?.task.id)} />
          <details className="more-menu">
            <summary aria-label="更多操作" title="更多操作"><MoreHorizontal aria-hidden="true" size={20} strokeWidth={1.75} /></summary>
            <div className="more-menu-popover">
              <span className="more-menu-label"><ArrowDownUp aria-hidden="true" size={15} />排序方式</span>
              <button className={sortMode === 'deadline' ? 'active' : ''} onClick={() => setSortMode('deadline')}>截止时间</button>
              <button className={sortMode === 'urgency' ? 'active' : ''} onClick={() => setSortMode('urgency')}>紧急程度</button>
              <button className={sortMode === 'updated' ? 'active' : ''} onClick={() => setSortMode('updated')}>最近更新</button>
              <span className="more-menu-rule" />
              <button onClick={openSettings}><Settings aria-hidden="true" size={16} />设置</button>
            </div>
          </details>
        </div>
      </header>
      <main className="l2-body">
        {loading ? (
          <p className="loading-state">正在整理采购任务</p>
        ) : !onboarded ? (
          <WelcomeView onDone={() => setOnboarded(true)} />
        ) : sortedTasks.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="开始第一项采购"
            description="创建任务后，这里会优先显示下一步要做的动作。"
            action={<Button icon={Plus} variant="primary" onClick={() => setShowForm(true)}>新建任务</Button>}
          />
        ) : (
          <Carousel itemWidth={248} gap={12} activeIndex={activeIndex} onActiveIndexChange={setActiveIndex} reducedMotion={reducedMotion}>
            {sortedTasks.map((card, index) => (
              <TaskCard
                key={card.task.id}
                card={card}
                tabIndex={index === activeIndex ? 0 : -1}
                onFocus={() => setActiveIndex(index)}
                onOpen={() => enterWorkspace(card.task.id)}
              />
            ))}
          </Carousel>
        )}
      </main>
      {showForm && <NewTaskForm onClose={() => setShowForm(false)} />}
    </div>
  );
}
