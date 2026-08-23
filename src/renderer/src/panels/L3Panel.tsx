import { useEffect, useMemo, useState } from 'react';
import { Archive, ArrowLeft, Bell, Bot, Brain, ClipboardList, Gauge, ListChecks, Paperclip, Plus, Search, Settings, Sparkles, StickyNote } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTaskStore } from '../state/useStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import type { TaskWorkspaceSection, WorkspaceSection } from '../state/useWorkspaceStore';
import TaskEditor from '../components/TaskEditor';
import ArchiveView from '../components/ArchiveView';
import SettingsView from '../components/SettingsView';
import DraftsPanel from '../components/DraftsPanel';
import NewTaskForm from '../components/NewTaskForm';
import VirtualTaskSwitcher from '../components/VirtualTaskSwitcher';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import AgentPanel from '../components/AgentPanel';
import MemoryPanel from '../components/MemoryPanel';

const TASK_SECTIONS: Array<{ id: TaskWorkspaceSection; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: '概览', icon: Gauge },
  { id: 'nodes', label: '采购节点', icon: ListChecks },
  { id: 'materials', label: '资料', icon: Paperclip },
  { id: 'reminders', label: '提醒', icon: Bell },
  { id: 'notes', label: '备注', icon: StickyNote }
];

const WORKSPACE_NAV: Array<{ id: Exclude<WorkspaceSection, 'tasks'>; label: string; icon: LucideIcon }> = [
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'memory', label: '记忆', icon: Brain },
  { id: 'drafts', label: 'AI 草稿', icon: Sparkles },
  { id: 'archive', label: '归档', icon: Archive },
  { id: 'settings', label: '设置', icon: Settings }
];

export default function L3Panel({ layoutWidth }: { layoutWidth?: number }): React.JSX.Element {
  const tasks = useTaskStore((state) => state.tasks);
  const loading = useTaskStore((state) => state.loading);
  const loadError = useTaskStore((state) => state.loadError);
  const load = useTaskStore((state) => state.load);
  const detail = useTaskStore((state) => state.detail);
  const detailLoading = useTaskStore((state) => state.detailLoading);
  const detailError = useTaskStore((state) => state.detailError);
  const openDetail = useTaskStore((state) => state.openDetail);
  const section = useWorkspaceStore((state) => state.section);
  const taskSection = useWorkspaceStore((state) => state.taskSection);
  const selectedTaskId = useWorkspaceStore((state) => state.selectedTaskId);
  const openSection = useWorkspaceStore((state) => state.openSection);
  const openTask = useWorkspaceStore((state) => state.openTask);
  const clearTaskSelection = useWorkspaceStore((state) => state.clearTaskSelection);
  const setTaskSection = useWorkspaceStore((state) => state.setTaskSection);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const [mountStage, setMountStage] = useState(0);
  const compact = (layoutWidth ?? windowWidth) <= 760;

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      setMountStage(1);
      secondFrame = requestAnimationFrame(() => setMountStage(2));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, []);

  useEffect(() => {
    if (layoutWidth !== undefined) return;
    const update = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [layoutWidth]);

  useEffect(() => {
    void window.api.interacting(false);
    return () => { void window.api.interacting(false); };
  }, []);

  useEffect(() => {
    if (section !== 'tasks' || loading) return;
    const currentExists = selectedTaskId ? tasks.some((card) => card.task.id === selectedTaskId) : false;
    const targetId = currentExists ? selectedTaskId : tasks[0]?.task.id ?? null;
    if (!targetId) {
      if (selectedTaskId) clearTaskSelection();
      return;
    }
    if (!currentExists) openTask(targetId);
    if (detail?.task.id !== targetId && !detailLoading) void openDetail(targetId);
  }, [clearTaskSelection, detail?.task.id, detailLoading, loading, openDetail, openTask, section, selectedTaskId, tasks]);

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('zh-CN');
    if (!query) return tasks;
    return tasks.filter((card) => card.task.name.toLocaleLowerCase('zh-CN').includes(query) || card.progress.nextTitle?.toLocaleLowerCase('zh-CN').includes(query));
  }, [search, tasks]);

  const selectTask = (taskId: string) => {
    openTask(taskId);
    void openDetail(taskId);
  };

  const currentTask = tasks.find((card) => card.task.id === selectedTaskId);

  return (
    <div className="panel l3-panel">
      <header className="l3-header">
        <div className="panel-brand">
          <span className="brand-mark" aria-hidden="true" />
          <span><strong>采办岛</strong><small>{section === 'tasks' ? '当前任务工作台' : WORKSPACE_NAV.find((item) => item.id === section)?.label}</small></span>
        </div>
        <div className="l3-actions">
          <Button icon={Plus} variant="primary" onClick={() => setShowForm(true)}>新建任务</Button>
          <Button icon={ArrowLeft} variant="ghost" onClick={() => void window.api.setLevel('l2')}>返回速览</Button>
        </div>
      </header>

      {mountStage >= 1 && compact && <div className="l3-mobile-picker">
        <label className={section === 'tasks' ? 'active' : ''}>
          <span className="sr-only">选择任务</span>
          <select value={selectedTaskId ?? ''} onChange={(event) => selectTask(event.target.value)}>
            {tasks.length === 0 && <option value="">暂无活跃任务</option>}
            {tasks.map((card) => <option key={card.task.id} value={card.task.id}>{card.task.name}</option>)}
          </select>
        </label>
        <nav aria-label="移动工作区导航">
          {WORKSPACE_NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={section === item.id ? 'active' : ''}
                aria-current={section === item.id ? 'page' : undefined}
                aria-label={item.label}
                title={item.label}
                onClick={() => openSection(item.id)}
              >
                <Icon aria-hidden="true" size={18} />
              </button>
            );
          })}
        </nav>
      </div>}

      <div className="l3-shell">
        {mountStage === 0 && !compact && <div className="workspace-sidebar-placeholder" aria-hidden="true" />}
        {mountStage >= 1 && !compact && <aside className="workspace-sidebar" aria-label="任务与工作区导航">
          <div className="sidebar-search">
            <Search aria-hidden="true" size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索任务" aria-label="搜索任务" />
          </div>
          <div className="sidebar-label"><span>活跃任务</span><span>{tasks.length}</span></div>
          <VirtualTaskSwitcher tasks={filteredTasks} selectedTaskId={selectedTaskId} active={section === 'tasks'} onSelect={selectTask} />
          <nav className="workspace-nav" aria-label="其他工作区">
            {WORKSPACE_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} data-workspace-section={item.id} className={section === item.id ? 'active' : ''} aria-current={section === item.id ? 'page' : undefined} onClick={() => openSection(item.id)}>
                  <Icon aria-hidden="true" size={18} /><span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>}

        {mountStage < 2 ? <main className="workspace-main"><p className="loading-state">正在准备任务工作台</p></main> : <main className="workspace-main">
          {section === 'tasks' && (
            loading ? <p className="loading-state">正在加载任务</p> : loadError ? (
              <EmptyState icon={ClipboardList} title="暂时无法读取任务" description={loadError} action={<Button variant="primary" onClick={() => void load()}>重试</Button>} />
            ) : tasks.length === 0 ? (
              <EmptyState icon={ClipboardList} title="还没有活跃任务" description="创建一项采购任务，工作台会把下一步动作放在最前面。" action={<Button icon={Plus} variant="primary" onClick={() => setShowForm(true)}>新建任务</Button>} />
            ) : (
              <>
                <div className="workspace-task-head">
                  <div>
                    <span className="eyebrow">当前任务</span>
                    <h1 tabIndex={-1} data-transition-focus="l3">{currentTask?.task.name ?? detail?.task.name ?? '采购任务'}</h1>
                  </div>
                  <span className={'workspace-urgency urgency-' + (currentTask?.task.urgency ?? detail?.task.urgency ?? 'normal')}>
                    {currentTask?.overdue ? '已逾期' : currentTask?.task.urgency === 'critical' ? '紧急' : currentTask?.task.urgency === 'high' ? '高优先级' : currentTask?.task.urgency === 'low' ? '低优先级' : '普通'}
                  </span>
                </div>
                <nav className="task-section-tabs" role="tablist" aria-label="当前任务分区">
                  {TASK_SECTIONS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        data-task-section={item.id}
                        role="tab"
                        aria-selected={taskSection === item.id}
                        className={taskSection === item.id ? 'active' : ''}
                        onClick={() => setTaskSection(item.id)}
                      >
                        <Icon aria-hidden="true" size={17} /><span>{item.label}</span>
                      </button>
                    );
                  })}
                </nav>
                <div className="workspace-scroll" role="tabpanel">
                  {detailLoading ? <p className="loading-state">正在打开任务</p> : detailError || !detail || detail.task.id !== selectedTaskId ? (
                    <EmptyState
                      icon={ClipboardList}
                      title="暂时无法打开任务"
                      description={detailError ?? '任务详情尚未准备好'}
                      action={selectedTaskId ? <Button variant="primary" onClick={() => void openDetail(selectedTaskId)}>重试</Button> : undefined}
                    />
                  ) : <TaskEditor detail={detail} section={taskSection} />}
                </div>
              </>
            )
          )}
          {section === 'drafts' && <div className="workspace-scroll standalone-section"><DraftsPanel /></div>}
          {section === 'agent' && <div className="workspace-scroll standalone-section"><AgentPanel /></div>}
          {section === 'memory' && <div className="workspace-scroll standalone-section"><MemoryPanel /></div>}
          {section === 'archive' && <div className="workspace-scroll standalone-section"><ArchiveView /></div>}
          {section === 'settings' && <div className="workspace-scroll standalone-section"><SettingsView /></div>}
        </main>}
      </div>
      {showForm && <NewTaskForm onClose={() => setShowForm(false)} />}
    </div>
  );
}
