import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, ClipboardList, Maximize2, MoreHorizontal, Plus, Settings } from 'lucide-react';
import { useTaskStore } from '../state/useStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import TaskCard from '../components/TaskCard';
import type { TaskCardAction } from '../components/TaskCard';
import Carousel from '../components/Carousel';
import NewTaskForm from '../components/NewTaskForm';
import WelcomeView from '../components/WelcomeView';
import { Button, IconButton } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Dialog } from '../components/ui/Dialog';

type SortMode = 'deadline' | 'urgency' | 'updated';
const URGENCY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 } as const;

interface PendingTaskAction {
  action: TaskCardAction;
  taskId: string;
  taskName: string;
}

export default function L2Panel({ reducedMotion }: { reducedMotion: boolean }): React.JSX.Element {
  const tasks = useTaskStore((state) => state.tasks);
  const loading = useTaskStore((state) => state.loading);
  const load = useTaskStore((state) => state.load);
  const completeTask = useTaskStore((state) => state.complete);
  const cancelTask = useTaskStore((state) => state.cancel);
  const deleteTask = useTaskStore((state) => state.deleteTask);
  const setNodeStatus = useTaskStore((state) => state.setNodeStatus);
  const openTask = useWorkspaceStore((state) => state.openTask);
  const openSection = useWorkspaceStore((state) => state.openSection);
  const pendingUndo = useWorkspaceStore((state) => state.pendingUndo);
  const scheduleUndo = useWorkspaceStore((state) => state.scheduleUndo);
  const notify = useWorkspaceStore((state) => state.notify);
  const [showForm, setShowForm] = useState(false);
  const [onboarded, setOnboarded] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [sortMode, setSortMode] = useState<SortMode>('deadline');
  const [pendingTaskAction, setPendingTaskAction] = useState<PendingTaskAction | null>(null);
  const [taskActionBusy, setTaskActionBusy] = useState(false);

  useEffect(() => {
    void load();
    void window.api.getSettings().then((result) => {
      if (result.ok) setOnboarded((result.data as { onboarded: boolean }).onboarded === true);
    });
  }, [load]);

  useEffect(() => {
    void window.api.setL2Detail(showForm);
    void window.api.interacting(showForm || pendingTaskAction !== null);
    return () => { void window.api.interacting(false); };
  }, [pendingTaskAction, showForm]);

  const sortedTasks = useMemo(() => [...tasks].filter((card) => !(pendingUndo?.kind === 'task' && pendingUndo.id === card.task.id)).sort((left, right) => {
    if (sortMode === 'urgency') return URGENCY_ORDER[left.task.urgency] - URGENCY_ORDER[right.task.urgency];
    if (sortMode === 'updated') return right.task.updatedAtUtc.localeCompare(left.task.updatedAtUtc);
    const leftDeadline = left.task.deadlineUtc ?? '9999';
    const rightDeadline = right.task.deadlineUtc ?? '9999';
    return leftDeadline.localeCompare(rightDeadline) || left.task.id.localeCompare(right.task.id);
  }), [pendingUndo, sortMode, tasks]);

  useEffect(() => {
    if (activeIndex >= sortedTasks.length) setActiveIndex(Math.max(0, sortedTasks.length - 1));
  }, [activeIndex, sortedTasks.length]);

  const enterWorkspace = (taskId?: string) => {
    if (taskId) openTask(taskId);
    else openSection('tasks');
    void window.api.setLevel('l3');
  };

  const openSettings = () => {
    openSection('settings');
    void window.api.setLevel('l3');
  };

  const changeNodeStatus = async (taskId: string, nodeId: string, status: Parameters<typeof setNodeStatus>[2]) => {
    const error = await setNodeStatus(taskId, nodeId, status);
    notify(error ?? '节点状态已更新', error ? 'error' : 'success');
  };

  const confirmTaskAction = async () => {
    if (!pendingTaskAction) return;
    const { action, taskId, taskName } = pendingTaskAction;
    if (action === 'delete') {
      const scheduled = scheduleUndo({ id: taskId, kind: 'task', label: '任务“' + taskName + '”', commit: () => deleteTask(taskId) });
      if (scheduled) setPendingTaskAction(null);
      return;
    }
    setTaskActionBusy(true);
    const error = action === 'complete' ? await completeTask(taskId) : await cancelTask(taskId);
    setTaskActionBusy(false);
    if (error) {
      notify(error, 'error');
      return;
    }
    setPendingTaskAction(null);
    notify(action === 'complete' ? '任务已完成并归档' : '任务已取消并归档', 'success');
  };

  const actionTitle = pendingTaskAction?.action === 'complete'
    ? '确认完成任务？'
    : pendingTaskAction?.action === 'cancel'
      ? '确认取消任务？'
      : '确认永久删除任务？';
  const actionDescription = pendingTaskAction?.action === 'delete'
    ? '删除后不会进入归档；确认后仍有 5 秒可以撤销。'
    : '任务将进入归档，之后可以从归档页恢复。';

  return (
    <div className="panel l2-panel">
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
                onNodeStatus={changeNodeStatus}
                onTaskAction={(action) => setPendingTaskAction({ action, taskId: card.task.id, taskName: card.task.name })}
              />
            ))}
          </Carousel>
        )}
      </main>
      {showForm && <NewTaskForm onClose={() => setShowForm(false)} />}
      <Dialog
        open={pendingTaskAction !== null}
        title={actionTitle}
        description={actionDescription}
        onClose={() => { if (!taskActionBusy) setPendingTaskAction(null); }}
        actions={
          <>
            <Button variant="ghost" disabled={taskActionBusy} onClick={() => setPendingTaskAction(null)}>返回</Button>
            <Button variant={pendingTaskAction?.action === 'delete' ? 'danger' : 'primary'} disabled={taskActionBusy} onClick={() => void confirmTaskAction()}>
              {taskActionBusy ? '正在处理' : pendingTaskAction?.action === 'complete' ? '确认完成' : pendingTaskAction?.action === 'cancel' ? '确认取消' : '确认删除'}
            </Button>
          </>
        }
      >
        {pendingTaskAction && <p>任务：{pendingTaskAction.taskName}</p>}
      </Dialog>
    </div>
  );
}
