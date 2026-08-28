import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowDownUp, Bot, ClipboardList, LayoutGrid, Maximize2, MoreHorizontal, Plus, Settings } from 'lucide-react';
import { useTaskStore } from '../state/useStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import TaskCard from '../components/TaskCard';
import MiscSticker from '../components/MiscSticker';
import type { TaskCardAction } from '../components/TaskCard';
import Carousel from '../components/Carousel';
import NewTaskForm from '../components/NewTaskForm';
import WelcomeView from '../components/WelcomeView';
import { Button, IconButton } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Dialog } from '../components/ui/Dialog';
import NodeTimeDialog from '../components/NodeTimeDialog';
import RenameDialog from '../components/RenameDialog';
import { ExternalTargetDialog } from '../components/ui/ExternalTargetDialog';
import type { ExternalTarget } from '../components/ui/ExternalTargetDialog';
import { compareTasks } from '../../../shared/sorting';
import type { TaskCardNode, TaskUrgencyUpdateRequest } from '../../../shared/types';
import AgentConversation from '../components/AgentConversation';

type SortMode = 'deadline' | 'urgency' | 'updated';

interface PendingTaskAction {
  action: TaskCardAction;
  taskId: string;
  taskName: string;
}

interface PendingNodeTime {
  taskId: string;
  deadlineUtc: string | null;
  tzId: string;
  node: TaskCardNode;
}

type PendingRename =
  | { kind: 'task'; taskId: string; name: string }
  | { kind: 'node'; taskId: string; node: TaskCardNode };

export default function L2Panel({ reducedMotion }: { reducedMotion: boolean }): React.JSX.Element {
  const tasks = useTaskStore((state) => state.tasks);
  const loading = useTaskStore((state) => state.loading);
  const loadError = useTaskStore((state) => state.loadError);
  const load = useTaskStore((state) => state.load);
  const onboarded = useTaskStore((state) => state.onboarded);
  const setOnboarded = useTaskStore((state) => state.setOnboarded);
  const prefetchDetail = useTaskStore((state) => state.prefetchDetail);
  const loadTaskLinks = useTaskStore((state) => state.loadTaskLinks);
  const completeTask = useTaskStore((state) => state.complete);
  const cancelTask = useTaskStore((state) => state.cancel);
  const deleteTask = useTaskStore((state) => state.deleteTask);
  const setTaskUrgency = useTaskStore((state) => state.setTaskUrgency);
  const setTaskName = useTaskStore((state) => state.setTaskName);
  const setNodeStatus = useTaskStore((state) => state.setNodeStatus);
  const setNodeTitle = useTaskStore((state) => state.setNodeTitle);
  const setNodeStartTime = useTaskStore((state) => state.setNodeStartTime);
  const openTask = useWorkspaceStore((state) => state.openTask);
  const openSection = useWorkspaceStore((state) => state.openSection);
  const l2View = useWorkspaceStore((state) => state.l2View);
  const setL2View = useWorkspaceStore((state) => state.setL2View);
  const pendingUndo = useWorkspaceStore((state) => state.pendingUndo);
  const scheduleUndo = useWorkspaceStore((state) => state.scheduleUndo);
  const notify = useWorkspaceStore((state) => state.notify);
  const [showForm, setShowForm] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('urgency');
  const [pendingTaskAction, setPendingTaskAction] = useState<PendingTaskAction | null>(null);
  const [pendingNodeTime, setPendingNodeTime] = useState<PendingNodeTime | null>(null);
  const [pendingRename, setPendingRename] = useState<PendingRename | null>(null);
  const [externalTarget, setExternalTarget] = useState<ExternalTarget | null>(null);
  const [taskActionBusy, setTaskActionBusy] = useState(false);
  const [completingMiscId, setCompletingMiscId] = useState<string | null>(null);
  const [cardRenderLimit, setCardRenderLimit] = useState(2);

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      setCardRenderLimit(4);
      secondFrame = requestAnimationFrame(() => setCardRenderLimit(7));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, []);

  useEffect(() => {
    const editing = showForm || pendingTaskAction !== null || pendingNodeTime !== null || pendingRename !== null || externalTarget !== null;
    void window.api.setL2Detail(editing);
    void window.api.interacting(editing);
    return () => { void window.api.interacting(false); };
  }, [externalTarget, pendingNodeTime, pendingRename, pendingTaskAction, showForm]);

  const visibleTasks = useMemo(() => tasks.filter((card) => !(pendingUndo?.kind === 'task' && pendingUndo.id === card.task.id)), [pendingUndo, tasks]);
  const projectTasks = useMemo(() => visibleTasks.filter((card) => card.task.kind === 'task').sort((left, right) => {
    if (sortMode === 'urgency') return compareTasks(left.task, right.task);
    if (sortMode === 'updated') return right.task.updatedAtUtc.localeCompare(left.task.updatedAtUtc) || compareTasks(left.task, right.task);
    const leftDeadline = left.task.deadlineUtc ?? '9999';
    const rightDeadline = right.task.deadlineUtc ?? '9999';
    return leftDeadline.localeCompare(rightDeadline) || left.task.id.localeCompare(right.task.id);
  }), [sortMode, visibleTasks]);
  const miscTasks = useMemo(() => visibleTasks.filter((card) => card.task.kind === 'misc').sort((left, right) => {
    const rank = (card: typeof left): number => {
      if (card.task.remindAtUtc && Date.parse(card.task.remindAtUtc) <= Date.now()) return 0;
      if (card.task.remindAtUtc) return 1;
      return 2;
    };
    const rankDiff = rank(left) - rank(right);
    if (rankDiff !== 0) return rankDiff;
    if (left.task.remindAtUtc && right.task.remindAtUtc) return left.task.remindAtUtc.localeCompare(right.task.remindAtUtc) || left.task.id.localeCompare(right.task.id);
    return right.task.updatedAtUtc.localeCompare(left.task.updatedAtUtc) || left.task.id.localeCompare(right.task.id);
  }), [visibleTasks]);

  const overviewContentMode = projectTasks.length > 0 && miscTasks.length > 0
    ? 'mixed'
    : projectTasks.length > 0
      ? 'project'
      : miscTasks.length > 0
        ? 'misc'
        : 'empty';
  const contentMode = l2View === 'agent' ? 'agent' : overviewContentMode;

  useEffect(() => {
    const setContentMode = window.api.setL2ContentMode;
    if (typeof setContentMode === 'function') void setContentMode(contentMode);
  }, [contentMode]);

  useEffect(() => {
    if (projectTasks.length === 0) {
      setActiveIndex(0);
      setActiveTaskId(null);
      return;
    }
    if (activeTaskId) {
      const preservedIndex = projectTasks.findIndex((card) => card.task.id === activeTaskId);
      if (preservedIndex >= 0) {
        if (preservedIndex !== activeIndex) setActiveIndex(preservedIndex);
        return;
      }
    }
    const nextIndex = Math.min(activeIndex, projectTasks.length - 1);
    setActiveIndex(nextIndex);
    setActiveTaskId(projectTasks[nextIndex].task.id);
  }, [activeIndex, activeTaskId, projectTasks]);

  const [activeMiscIndex, setActiveMiscIndex] = useState(0);
  const [activeMiscId, setActiveMiscId] = useState<string | null>(null);
  useEffect(() => {
    if (miscTasks.length === 0) {
      setActiveMiscIndex(0);
      setActiveMiscId(null);
      return;
    }
    const preserved = activeMiscId ? miscTasks.findIndex((card) => card.task.id === activeMiscId) : -1;
    const nextIndex = preserved >= 0 ? preserved : Math.min(activeMiscIndex, miscTasks.length - 1);
    if (nextIndex !== activeMiscIndex) setActiveMiscIndex(nextIndex);
    setActiveMiscId(miscTasks[nextIndex].task.id);
  }, [activeMiscId, activeMiscIndex, miscTasks]);

  useEffect(() => {
    const taskId = projectTasks[activeIndex]?.task.id;
    if (taskId) void prefetchDetail(taskId);
  }, [activeIndex, prefetchDetail, projectTasks]);

  useEffect(() => {
    const taskId = miscTasks[activeMiscIndex]?.task.id;
    if (taskId) void prefetchDetail(taskId);
  }, [activeMiscIndex, miscTasks, prefetchDetail]);

  const enterWorkspace = (taskId?: string) => {
    if (taskId) {
      openTask(taskId);
      void prefetchDetail(taskId);
    }
    else openSection('tasks');
    void window.api.setLevel('l3');
  };

  const openSettings = () => {
    openSection('settings');
    void window.api.setLevel('l3');
  };

  const moveL2ViewFocus = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextView = event.key === 'ArrowLeft' || event.key === 'Home' ? 'agent' : 'overview';
    setL2View(nextView);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-l2-view="${nextView}"]`)?.focus();
  };

  const changeNodeStatus = async (taskId: string, nodeId: string, status: Parameters<typeof setNodeStatus>[2]) => {
    const error = await setNodeStatus(taskId, nodeId, status);
    notify(error ?? '节点状态已更新', error ? 'error' : 'success');
  };

  const changeTaskUrgency = async (request: TaskUrgencyUpdateRequest) => {
    const error = await setTaskUrgency(request);
    notify(error ?? '任务紧急程度已更新', error ? 'error' : 'success');
  };

  const quickCompleteMisc = async (taskId: string) => {
    if (completingMiscId) return;
    setCompletingMiscId(taskId);
    const error = await completeTask(taskId);
    setCompletingMiscId(null);
    notify(error ?? '杂事已完成并归档', error ? 'error' : 'success');
  };

  const saveRename = async (name: string): Promise<string | null> => {
    if (!pendingRename) return '名称编辑已关闭';
    const error = pendingRename.kind === 'task'
      ? await setTaskName({ taskId: pendingRename.taskId, name, expectedName: pendingRename.name })
      : await setNodeTitle(pendingRename.taskId, {
          nodeId: pendingRename.node.id,
          title: name,
          expectedTitle: pendingRename.node.title
        });
    if (!error) notify(pendingRename.kind === 'task' ? '任务名称已更新' : '节点名称已更新', 'success');
    return error;
  };

  const saveNodeTime = async (startUtc: string | null): Promise<string | null> => {
    if (!pendingNodeTime) return '节点时间编辑已关闭';
    const error = await setNodeStartTime(pendingNodeTime.taskId, {
      nodeId: pendingNodeTime.node.id,
      startUtc,
      expectedStartUtc: pendingNodeTime.node.startUtc
    });
    if (!error) notify(startUtc ? '节点提醒时间已更新' : '节点提醒已清除', 'success');
    return error;
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
        <div className="l2-view-switch" role="tablist" aria-label="L2 内容">
          <button type="button" role="tab" data-l2-view="agent" aria-selected={l2View === 'agent'} tabIndex={l2View === 'agent' ? 0 : -1} className={l2View === 'agent' ? 'active' : ''} onKeyDown={moveL2ViewFocus} onClick={() => setL2View('agent')}><Bot aria-hidden="true" size={16} />AI 对话</button>
          <button type="button" role="tab" data-l2-view="overview" aria-selected={l2View === 'overview'} tabIndex={l2View === 'overview' ? 0 : -1} className={l2View === 'overview' ? 'active' : ''} onKeyDown={moveL2ViewFocus} onClick={() => setL2View('overview')}><LayoutGrid aria-hidden="true" size={16} />任务速览</button>
        </div>
        <div className="l2-actions">
          {l2View === 'overview' && <Button icon={Plus} variant="primary" onClick={() => setShowForm(true)}>新建</Button>}
          <IconButton icon={Maximize2} label="展开工作台" onClick={() => {
            if (l2View === 'agent') {
              openSection('agent');
              void window.api.setLevel('l3');
              return;
            }
            enterWorkspace(projectTasks[activeIndex]?.task.id ?? miscTasks[activeMiscIndex]?.task.id);
          }} />
          <details className="more-menu">
            <summary aria-label="更多操作" title="更多操作"><MoreHorizontal aria-hidden="true" size={20} strokeWidth={1.75} /></summary>
            <div className="more-menu-popover">
              <span className="more-menu-label"><ArrowDownUp aria-hidden="true" size={15} />项目排序</span>
              <button className={sortMode === 'urgency' ? 'active' : ''} onClick={() => setSortMode('urgency')}>紧急程度（默认）</button>
              <button className={sortMode === 'deadline' ? 'active' : ''} onClick={() => setSortMode('deadline')}>截止时间</button>
              <button className={sortMode === 'updated' ? 'active' : ''} onClick={() => setSortMode('updated')}>最近更新</button>
              <span className="more-menu-rule" />
              <button onClick={openSettings}><Settings aria-hidden="true" size={16} />设置</button>
            </div>
          </details>
        </div>
      </header>
      <main className={'l2-body l2-body-' + contentMode}>
        {l2View === 'agent' ? (
          <AgentConversation
            compact
            onHide={() => void window.api.setLevel('l1')}
            onTaskConfirmed={(taskId) => {
              setActiveTaskId(taskId);
              setActiveMiscId(taskId);
              setL2View('overview');
              requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"]`)?.focus());
            }}
          />
        ) : loading || onboarded === null ? (
          <p className="loading-state">正在整理采购任务</p>
        ) : loadError ? (
          <EmptyState
            icon={ClipboardList}
            title="暂时无法读取任务"
            description={loadError}
            action={<Button variant="primary" onClick={() => void load()}>重试</Button>}
          />
        ) : !onboarded ? (
          <WelcomeView onDone={() => setOnboarded(true)} />
        ) : visibleTasks.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="开始第一项采购"
            description="创建任务后，这里会优先显示下一步要做的动作。"
            action={<Button icon={Plus} variant="primary" onClick={() => setShowForm(true)}>新建任务</Button>}
          />
        ) : <div className={'l2-lanes l2-lanes-' + contentMode}>
          {projectTasks.length > 0 && <section className="l2-lane project-lane" aria-label="采购项目">
            <Carousel
            itemWidth={248}
            gap={12}
            itemCount={projectTasks.length}
            activeIndex={activeIndex}
            onActiveIndexChange={(index) => {
              setActiveIndex(index);
              setActiveTaskId(projectTasks[index]?.task.id ?? null);
            }}
            reducedMotion={reducedMotion}
            renderLimit={cardRenderLimit}
            ariaLabel="采购项目"
            renderItem={(index) => {
              const card = projectTasks[index];
              return (
              <TaskCard
                key={card.task.id}
                card={card}
                tabIndex={index === activeIndex ? 0 : -1}
                onFocus={() => {
                  setActiveIndex(index);
                  setActiveTaskId(card.task.id);
                }}
                onOpen={() => enterWorkspace(card.task.id)}
                onUrgencyChange={changeTaskUrgency}
                onNodeStatus={changeNodeStatus}
                onNodeTime={(_taskId, node) => setPendingNodeTime({
                  taskId: card.task.id,
                  deadlineUtc: card.task.deadlineUtc,
                  tzId: card.task.tzId,
                  node
                })}
                onLoadMaterials={loadTaskLinks}
                onOpenMaterial={(link) => setExternalTarget({ kind: link.kind, target: link.target, title: link.title })}
                onRenameTask={() => setPendingRename({ kind: 'task', taskId: card.task.id, name: card.task.name })}
                onRenameNode={(node) => setPendingRename({ kind: 'node', taskId: card.task.id, node })}
                onTaskAction={(action) => setPendingTaskAction({ action, taskId: card.task.id, taskName: card.task.name })}
              />
              );
            }}
            />
          </section>}
          {miscTasks.length > 0 && <section className="l2-lane misc-lane" aria-label="杂事">
            <Carousel
              itemWidth={216}
              gap={10}
              itemCount={miscTasks.length}
              activeIndex={activeMiscIndex}
              onActiveIndexChange={(index) => {
                setActiveMiscIndex(index);
                setActiveMiscId(miscTasks[index]?.task.id ?? null);
              }}
              reducedMotion={reducedMotion}
              renderLimit={cardRenderLimit}
              ariaLabel="杂事"
              renderItem={(index) => {
                const card = miscTasks[index];
                return <MiscSticker
                  key={card.task.id}
                  card={card}
                  tabIndex={index === activeMiscIndex ? 0 : -1}
                  completing={completingMiscId === card.task.id}
                  onFocus={() => { setActiveMiscIndex(index); setActiveMiscId(card.task.id); }}
                  onOpen={() => enterWorkspace(card.task.id)}
                  onComplete={() => void quickCompleteMisc(card.task.id)}
                />;
              }}
            />
          </section>}
        </div>}
      </main>
      {showForm && <NewTaskForm onClose={() => setShowForm(false)} />}
      {pendingNodeTime && (
        <NodeTimeDialog
          open
          mode="quick"
          nodeTitle={pendingNodeTime.node.title}
          status={pendingNodeTime.node.status}
          startUtc={pendingNodeTime.node.startUtc}
          taskDeadlineUtc={pendingNodeTime.deadlineUtc}
          tzId={pendingNodeTime.tzId}
          resolveReturnFocus={() => [...document.querySelectorAll<HTMLElement>('[data-node-id]')]
            .find((element) => element.dataset.nodeId === pendingNodeTime.node.id) ?? null}
          onClose={() => setPendingNodeTime(null)}
          onSave={(startUtc) => saveNodeTime(startUtc)}
        />
      )}
      {pendingRename && (
        <RenameDialog
          kind={pendingRename.kind === 'task' ? '任务' : '节点'}
          currentName={pendingRename.kind === 'task' ? pendingRename.name : pendingRename.node.title}
          onClose={() => setPendingRename(null)}
          onSave={saveRename}
        />
      )}
      <ExternalTargetDialog target={externalTarget} onClose={() => setExternalTarget(null)} />
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
