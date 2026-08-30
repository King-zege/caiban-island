import { useEffect, useMemo, useState } from 'react';
import { Archive, ArrowLeft, Bell, Bot, Brain, CircleDollarSign, ClipboardCheck, ClipboardList, FileSignature, Gauge, ListChecks, Paperclip, Pencil, Plus, ReceiptText, Search, Settings, StickyNote } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTaskStore } from '../state/useStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import type { TaskWorkspaceSection, WorkspaceSection } from '../state/useWorkspaceStore';
import TaskEditor from '../components/TaskEditor';
import ArchiveView from '../components/ArchiveView';
import SettingsView from '../components/SettingsView';
import NewTaskForm from '../components/NewTaskForm';
import VirtualTaskSwitcher from '../components/VirtualTaskSwitcher';
import { Button, IconButton } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import AgentPanel from '../components/AgentPanel';
import MemoryPanel from '../components/MemoryPanel';
import RenameDialog from '../components/RenameDialog';
import ProjectNamesDialog from '../components/ProjectNamesDialog';
import MiscEditor from '../components/MiscEditor';
import ContractEditor from '../components/ContractEditor';
import NewContractForm from '../components/NewContractForm';
import { useContractStore } from '../state/useContractStore';
import type { ContractWorkspaceSection } from '../../../shared/contractContracts';
import { CONTRACT_STATUS_LABELS } from '../../../shared/contractContracts';

const TASK_SECTIONS: Array<{ id: TaskWorkspaceSection; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: '概览', icon: Gauge },
  { id: 'nodes', label: '采购节点', icon: ListChecks },
  { id: 'materials', label: '资料', icon: Paperclip },
  { id: 'reminders', label: '提醒', icon: Bell },
  { id: 'notes', label: '备注', icon: StickyNote }
];

const CONTRACT_SECTIONS: Array<{ id: ContractWorkspaceSection; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: '概览', icon: Gauge },
  { id: 'performance', label: '履约', icon: ListChecks },
  { id: 'billing', label: '付款开票', icon: CircleDollarSign },
  { id: 'acceptance', label: '验收', icon: ClipboardCheck },
  { id: 'materials', label: '资料', icon: Paperclip },
  { id: 'notes', label: '备注', icon: StickyNote }
];

const WORKSPACE_NAV: Array<{ id: Exclude<WorkspaceSection, 'tasks'>; label: string; icon: LucideIcon }> = [
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'memory', label: '记忆', icon: Brain },
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
  const setTaskName = useTaskStore((state) => state.setTaskName);
  const setTaskNames = useTaskStore((state) => state.setTaskNames);
  const contracts = useContractStore((state) => state.contracts);
  const contractsLoading = useContractStore((state) => state.loading);
  const contractsError = useContractStore((state) => state.error);
  const ensureContractsLoaded = useContractStore((state) => state.ensureLoaded);
  const loadContracts = useContractStore((state) => state.load);
  const contractDetail = useContractStore((state) => state.detail);
  const contractDetailLoading = useContractStore((state) => state.detailLoading);
  const contractDetailError = useContractStore((state) => state.detailError);
  const openContractDetail = useContractStore((state) => state.openDetail);
  const section = useWorkspaceStore((state) => state.section);
  const taskSection = useWorkspaceStore((state) => state.taskSection);
  const selectedTaskId = useWorkspaceStore((state) => state.selectedTaskId);
  const selectedContractId = useWorkspaceStore((state) => state.selectedContractId);
  const contractSection = useWorkspaceStore((state) => state.contractSection);
  const openSection = useWorkspaceStore((state) => state.openSection);
  const setL2View = useWorkspaceStore((state) => state.setL2View);
  const openTask = useWorkspaceStore((state) => state.openTask);
  const openContract = useWorkspaceStore((state) => state.openContract);
  const clearTaskSelection = useWorkspaceStore((state) => state.clearTaskSelection);
  const setTaskSection = useWorkspaceStore((state) => state.setTaskSection);
  const setContractSection = useWorkspaceStore((state) => state.setContractSection);
  const notify = useWorkspaceStore((state) => state.notify);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showContractForm, setShowContractForm] = useState(false);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const [mountStage, setMountStage] = useState(0);
  const [renamingTask, setRenamingTask] = useState<{ id: string; kind: 'procurement' | 'misc'; name: string; fullName: string; shortName: string } | null>(null);
  const compact = (layoutWidth ?? windowWidth) <= 760;

  useEffect(() => { void ensureContractsLoaded(); }, [ensureContractsLoaded]);

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

  useEffect(() => {
    if (section !== 'contracts' || contractsLoading) return;
    const currentExists = selectedContractId ? contracts.some((card) => card.contract.id === selectedContractId) : false;
    const targetId = currentExists ? selectedContractId : contracts[0]?.contract.id ?? null;
    if (!targetId) return;
    if (!currentExists) openContract(targetId);
    if (contractDetail?.contract.id !== targetId && !contractDetailLoading) void openContractDetail(targetId);
  }, [contractDetail?.contract.id, contractDetailLoading, contracts, contractsLoading, openContract, openContractDetail, section, selectedContractId]);

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('zh-CN');
    if (!query) return tasks;
    return tasks.filter((card) => card.task.fullName.toLocaleLowerCase('zh-CN').includes(query)
      || card.task.shortName.toLocaleLowerCase('zh-CN').includes(query)
      || card.progress.nextTitle?.toLocaleLowerCase('zh-CN').includes(query));
  }, [search, tasks]);

  const filteredContracts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('zh-CN');
    if (!query) return contracts;
    return contracts.filter((card) => card.contract.fullName.toLocaleLowerCase('zh-CN').includes(query)
      || card.contract.shortName.toLocaleLowerCase('zh-CN').includes(query)
      || card.contract.contractNo.toLocaleLowerCase('zh-CN').includes(query)
      || card.contract.supplierName.toLocaleLowerCase('zh-CN').includes(query));
  }, [contracts, search]);

  const selectTask = (taskId: string) => {
    openTask(taskId);
    void openDetail(taskId);
  };

  const selectContract = (contractId: string) => {
    openContract(contractId);
    void openContractDetail(contractId);
  };

  const currentTask = tasks.find((card) => card.task.id === selectedTaskId);
  const currentContract = contracts.find((card) => card.contract.id === selectedContractId);

  return (
    <div className="panel l3-panel">
      <header className="l3-header">
        <div className="panel-brand">
          <span className="brand-mark" aria-hidden="true" />
          <span><strong>采办岛</strong><small>{section === 'tasks' ? '采购项目工作台' : section === 'contracts' ? '合同生命周期台账' : WORKSPACE_NAV.find((item) => item.id === section)?.label}</small></span>
        </div>
        <div className="l3-actions">
          <Button icon={Plus} variant="primary" onClick={() => setShowForm(true)}>新建任务</Button>
          <Button icon={FileSignature} variant="ghost" onClick={() => setShowContractForm(true)}>新建合同</Button>
          <Button icon={ArrowLeft} variant="ghost" onClick={() => { setL2View('overview'); void window.api.setLevel('l2'); }}>返回任务卡片</Button>
        </div>
      </header>

      {mountStage >= 1 && compact && <div className="l3-mobile-picker">
        <label className={section === 'tasks' || section === 'contracts' ? 'active' : ''}>
          <span className="sr-only">选择工作项</span>
          <select
            value={section === 'contracts' ? `contract:${selectedContractId ?? ''}` : `task:${selectedTaskId ?? ''}`}
            onChange={(event) => {
              const [kind, id] = event.target.value.split(':');
              if (!id) return;
              if (kind === 'contract') selectContract(id); else selectTask(id);
            }}
          >
            {tasks.length === 0 && contracts.length === 0 && <option value="task:">暂无活跃工作项</option>}
            {tasks.some((card) => card.task.kind !== 'misc') && <optgroup label="采购项目">{tasks.filter((card) => card.task.kind !== 'misc').map((card) => <option key={card.task.id} value={`task:${card.task.id}`}>{card.task.shortName}</option>)}</optgroup>}
            {contracts.length > 0 && <optgroup label="合同">{contracts.map((card) => <option key={card.contract.id} value={`contract:${card.contract.id}`}>{card.contract.shortName} · {card.contract.supplierName}</option>)}</optgroup>}
            {tasks.some((card) => card.task.kind === 'misc') && <optgroup label="杂事">{tasks.filter((card) => card.task.kind === 'misc').map((card) => <option key={card.task.id} value={`task:${card.task.id}`}>{card.task.name}</option>)}</optgroup>}
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
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索项目、合同或供应商" aria-label="搜索工作项" />
          </div>
          <div className="sidebar-label"><span>活跃工作</span><span>{tasks.length + contracts.length}</span></div>
          <VirtualTaskSwitcher
            tasks={filteredTasks}
            contracts={filteredContracts}
            selectedTaskId={selectedTaskId}
            selectedContractId={selectedContractId}
            active={section === 'tasks'}
            contractsActive={section === 'contracts'}
            onSelect={selectTask}
            onSelectContract={selectContract}
          />
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
                  <div className="workspace-task-title">
                    <span className="eyebrow">当前任务</span>
                    <div>
                      <h1 tabIndex={-1} data-transition-focus="l3">{currentTask?.task.fullName ?? detail?.task.fullName ?? '采购任务'}</h1>
                      {(currentTask?.task ?? detail?.task) && (
                        <IconButton
                          icon={Pencil}
                          label="编辑任务名称"
                          onClick={() => {
                            const task = currentTask?.task ?? detail?.task;
                            if (task) setRenamingTask({ id: task.id, kind: task.kind === 'misc' ? 'misc' : 'procurement', name: task.name, fullName: task.fullName, shortName: task.shortName });
                          }}
                        />
                      )}
                    </div>
                  </div>
                  {(currentTask?.task.kind ?? detail?.task.kind) !== 'misc' && <span className={'workspace-urgency urgency-' + (currentTask?.task.urgency ?? detail?.task.urgency ?? 'normal')}>
                    {currentTask?.overdue ? '已逾期' : currentTask?.task.urgency === 'critical' ? '紧急' : currentTask?.task.urgency === 'high' ? '高优先级' : currentTask?.task.urgency === 'low' ? '低优先级' : '普通'}
                  </span>}
                </div>
                {(currentTask?.task.kind ?? detail?.task.kind) !== 'misc' && <nav className="task-section-tabs" role="tablist" aria-label="当前任务分区">
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
                </nav>}
                <div className="workspace-scroll" role="tabpanel">
                  {detailLoading ? <p className="loading-state">正在打开任务</p> : detailError || !detail || detail.task.id !== selectedTaskId ? (
                    <EmptyState
                      icon={ClipboardList}
                      title="暂时无法打开任务"
                      description={detailError ?? '任务详情尚未准备好'}
                      action={selectedTaskId ? <Button variant="primary" onClick={() => void openDetail(selectedTaskId)}>重试</Button> : undefined}
                    />
                  ) : detail.task.kind === 'misc' ? <MiscEditor detail={detail} /> : <TaskEditor detail={detail} section={taskSection} />}
                </div>
              </>
            )
          )}
          {section === 'contracts' && (
            contractsLoading ? <p className="loading-state">正在加载合同台账</p> : contractsError ? (
              <EmptyState icon={FileSignature} title="暂时无法读取合同" description={contractsError} action={<Button variant="primary" onClick={() => void loadContracts()}>重试</Button>} />
            ) : contracts.length === 0 ? (
              <EmptyState icon={FileSignature} title="还没有活跃合同" description="录入合同后，付款、开票、交付与验收会进入统一履约提醒。" action={<Button icon={Plus} variant="primary" onClick={() => setShowContractForm(true)}>新建合同</Button>} />
            ) : (
              <>
                <div className="workspace-task-head contract-workspace-head">
                  <div className="workspace-task-title">
                    <span className="eyebrow">当前合同</span>
                    <div><h1 tabIndex={-1} data-transition-focus="l3">{currentContract?.contract.fullName ?? contractDetail?.contract.fullName ?? '合同台账'}</h1></div>
                    <p>{currentContract?.contract.contractNo || contractDetail?.contract.contractNo || '未编号'} · {currentContract?.contract.supplierName ?? contractDetail?.contract.supplierName}</p>
                  </div>
                  {(currentContract?.contract ?? contractDetail?.contract) && <span className={'workspace-urgency contract-status status-' + (currentContract?.contract.status ?? contractDetail?.contract.status)}>
                    {CONTRACT_STATUS_LABELS[currentContract?.contract.status ?? contractDetail!.contract.status]}
                    {currentContract?.risk === 'overdue' ? ' · 有逾期' : currentContract?.risk === 'due_soon' ? ' · 临近到期' : ''}
                  </span>}
                </div>
                <nav className="task-section-tabs contract-section-tabs" role="tablist" aria-label="当前合同分区">
                  {CONTRACT_SECTIONS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        data-contract-section={item.id}
                        role="tab"
                        aria-selected={contractSection === item.id}
                        className={contractSection === item.id ? 'active' : ''}
                        onClick={() => setContractSection(item.id)}
                      >
                        <Icon aria-hidden="true" size={17} /><span>{item.label}</span>
                      </button>
                    );
                  })}
                </nav>
                <div className="workspace-scroll contract-workspace" role="tabpanel">
                  {contractDetailLoading ? <p className="loading-state">正在打开合同</p> : contractDetailError || !contractDetail || contractDetail.contract.id !== selectedContractId ? (
                    <EmptyState
                      icon={ReceiptText}
                      title="暂时无法打开合同"
                      description={contractDetailError ?? '合同详情尚未准备好'}
                      action={selectedContractId ? <Button variant="primary" onClick={() => void openContractDetail(selectedContractId)}>重试</Button> : undefined}
                    />
                  ) : <ContractEditor detail={contractDetail} section={contractSection} />}
                </div>
              </>
            )
          )}
          {section === 'agent' && <div className="workspace-scroll standalone-section"><AgentPanel /></div>}
          {section === 'memory' && <div className="workspace-scroll standalone-section"><MemoryPanel /></div>}
          {section === 'archive' && <div className="workspace-scroll standalone-section"><ArchiveView /></div>}
          {section === 'settings' && <div className="workspace-scroll standalone-section"><SettingsView /></div>}
        </main>}
      </div>
      {showForm && <NewTaskForm onClose={() => setShowForm(false)} />}
      {showContractForm && <NewContractForm projects={tasks.filter((card) => card.task.kind !== 'misc')} onClose={() => setShowContractForm(false)} />}
      {renamingTask?.kind === 'misc' && (
        <RenameDialog
          kind="任务"
          currentName={renamingTask.name}
          onClose={() => setRenamingTask(null)}
          onSave={async (name) => {
            const error = await setTaskName({ taskId: renamingTask.id, name, expectedName: renamingTask.name });
            if (!error) notify('任务名称已更新', 'success');
            return error;
          }}
        />
      )}
      {renamingTask?.kind === 'procurement' && (
        <ProjectNamesDialog
          fullName={renamingTask.fullName}
          shortName={renamingTask.shortName}
          onClose={() => setRenamingTask(null)}
          onSave={async (fullName, shortName) => {
            const error = await setTaskNames({
              taskId: renamingTask.id,
              fullName,
              shortName,
              expectedFullName: renamingTask.fullName,
              expectedShortName: renamingTask.shortName
            });
            if (!error) notify('项目正式名称与简称已更新', 'success');
            return error;
          }}
        />
      )}
    </div>
  );
}
