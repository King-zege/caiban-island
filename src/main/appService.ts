import type { DatabaseSync } from 'node:sqlite';
import { ArchiveService } from './archiveService';
import { ReminderService } from './reminderService';
import { SettingsService } from './settingsService';
import { TaskService } from './taskService';
import { AgentProposalService } from './agentProposalService';
import { ContractService } from './contractService';
import type {
  LinkInput,
  LegacyMiscDeadlineActionRequest,
  MiscReminderUpdateRequest,
  NodeInput,
  NodeStatus,
  NodeTimeUpdateRequest,
  NodeTitleUpdateRequest,
  Task,
  TaskDetail,
  TaskCreateRequest,
  TaskInput,
  TaskNameUpdateRequest,
  TaskNamesUpdateRequest,
  TaskUrgencyUpdateRequest,
  TaskLink,
  TaskNode
} from '../shared/taskContracts';
import { getProcurementTemplate, instantiateProcurementTemplate } from '../shared/procurementContracts';
import type { ProcurementPlanApplyRequest, ProcurementProjectCreateRequest, ProcurementProjectCreateResult } from '../shared/procurementContracts';
import type { Contract, ContractAction, ContractActionInput, ContractActionReminder, ContractActionReminderRequest, ContractActionStatusRequest, ContractActionUpdateRequest, ContractCreateRequest, ContractLink, ContractLinkInput, ContractStatusRequest, ContractUpdateRequest } from '../shared/contractContracts';

// 组合根：任务/归档/提醒/设置的跨服务事务编排
export class AppService {
  readonly tasks: TaskService;
  readonly archive: ArchiveService;
  readonly reminders: ReminderService;
  readonly settings: SettingsService;
  readonly proposals: AgentProposalService;
  readonly contracts: ContractService;

  private listeners: Array<() => void> = [];

  // 任务数据变化通知（P6 自动同步钩子）
  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private emitChanged(): void {
    for (const fn of this.listeners) fn();
  }

  constructor(
    private readonly db: DatabaseSync,
    private readonly dataDir: string
  ) {
    this.tasks = new TaskService(db);
    this.archive = new ArchiveService(db, this.dataDir);
    this.reminders = new ReminderService(db);
    this.settings = new SettingsService(db);
    this.proposals = new AgentProposalService(db);
    this.contracts = new ContractService(db);
    this.reminders.reconcileFutureNodeReminders();
    this.reminders.reconcileFutureMiscReminders();
  }

  createTask(input: TaskCreateRequest | TaskInput): Task {
    const t = this.withTransaction(() => {
      const created = this.tasks.createTask(input);
      if (input.kind === 'misc') {
        const note = 'note' in input ? input.note : input.description;
        if (note.trim()) this.tasks.saveNote(created.id, note.trim());
        this.reminders.syncMiscReminder(created.id);
      } else {
        const defaults = this.settings.getJson<number[]>('reminder_default_offsets', []);
        if (created.deadlineUtc && defaults.length > 0) this.reminders.setOffsets(created.id, defaults);
      }
      return created;
    });
    this.emitChanged();
    return t;
  }

  createProcurementProject(input: ProcurementProjectCreateRequest): ProcurementProjectCreateResult {
    const result = this.withTransaction(() => {
      const project = this.tasks.createTask({
        kind: 'procurement', name: input.shortName, fullName: input.fullName, shortName: input.shortName,
        description: input.description, urgency: input.urgency, deadlineUtc: input.deadlineUtc, tzId: input.tzId
      });
      const template = input.templateId ? getProcurementTemplate(input.templateId) : null;
      const nodes = input.nodes ?? (template ? instantiateProcurementTemplate(template.id, input.deadlineUtc) : []);
      this.tasks.setProcurementWorkflow(project.id, template?.id ?? null, template?.version ?? null, input.procurementMethod);
      for (const node of nodes) this.tasks.addNode(project.id, node);
      if (project.deadlineUtc) {
        const defaults = this.settings.getJson<number[]>('reminder_default_offsets', []);
        if (defaults.length > 0) this.reminders.setOffsets(project.id, defaults);
      }
      this.reminders.syncTaskNodeReminders(project.id);
      return { project: this.tasks.getTask(project.id) as ProcurementProjectCreateResult['project'], nodeCount: nodes.length };
    });
    this.emitChanged();
    return result;
  }

  applyProcurementPlan(request: ProcurementPlanApplyRequest): TaskDetail {
    const detail = this.withTransaction(() => {
      const updated = this.tasks.applyProcurementPlan(request);
      this.reminders.syncTaskNodeReminders(request.taskId);
      return updated;
    });
    this.emitChanged();
    return detail;
  }

  createContract(input: ContractCreateRequest): Contract { const value = this.withTransaction(() => this.contracts.create(input)); this.emitChanged(); return value; }
  updateContract(input: ContractUpdateRequest): Contract { const value = this.withTransaction(() => this.contracts.update(input)); this.emitChanged(); return value; }
  setContractStatus(input: ContractStatusRequest): Contract { const value = this.withTransaction(() => this.contracts.setStatus(input)); this.emitChanged(); return value; }
  restoreContract(id: string): Contract { const value = this.withTransaction(() => this.contracts.restoreArchived(id)); this.emitChanged(); return value; }
  addContractAction(contractId: string, input: ContractActionInput): ContractAction { const value = this.withTransaction(() => this.contracts.addAction(contractId, input)); this.emitChanged(); return value; }
  updateContractAction(input: ContractActionUpdateRequest): ContractAction { const value = this.withTransaction(() => this.contracts.updateAction(input)); this.emitChanged(); return value; }
  setContractActionStatus(input: ContractActionStatusRequest): ContractAction { const value = this.withTransaction(() => this.contracts.setActionStatus(input)); this.emitChanged(); return value; }
  removeContractAction(id: string): boolean { this.withTransaction(() => this.contracts.removeAction(id)); this.emitChanged(); return true; }
  setContractActionReminder(input: ContractActionReminderRequest): ContractActionReminder | null { const value = this.withTransaction(() => this.contracts.setActionReminder(input)); this.emitChanged(); return value; }
  addContractLink(contractId: string, input: ContractLinkInput): ContractLink { const value = this.withTransaction(() => this.contracts.addLink(contractId, input)); this.emitChanged(); return value; }
  removeContractLink(id: string): boolean { this.withTransaction(() => this.contracts.removeLink(id)); this.emitChanged(); return true; }
  saveContractNote(contractId: string, body: string): boolean { this.withTransaction(() => this.contracts.saveNote(contractId, body)); this.emitChanged(); return true; }

  updateTask(id: string, input: TaskInput): Task {
    const t = this.tasks.updateTask(id, input);
    this.reminders.recomputeForTask(id);
    this.emitChanged();
    return t;
  }

  setTaskName(request: TaskNameUpdateRequest): Task {
    const task = this.withTransaction(() => this.tasks.setName(request));
    if (task.name !== request.expectedName) this.emitChanged();
    return task;
  }

  setTaskNames(request: TaskNamesUpdateRequest): Task {
    const task = this.withTransaction(() => this.tasks.setNames(request));
    this.emitChanged();
    return task;
  }

  setTaskUrgency(request: TaskUrgencyUpdateRequest): Task {
    const changed = request.urgency !== request.expectedUrgency;
    const task = this.withTransaction(() => this.tasks.setUrgency(request));
    if (changed) this.emitChanged();
    return task;
  }

  completeTask(id: string): Task {
    const t = this.withTransaction(() => {
      const task = this.tasks.setArchived(id, 'completed');
      this.reminders.disableForTask(id);
      return task;
    });
    this.archive.exportSnapshot(this.tasks.getTaskDetail(id));
    this.emitChanged();
    return t;
  }

  cancelTask(id: string): Task {
    const t = this.withTransaction(() => {
      const task = this.tasks.setArchived(id, 'cancelled');
      this.reminders.disableForTask(id);
      return task;
    });
    this.archive.exportSnapshot(this.tasks.getTaskDetail(id));
    this.emitChanged();
    return t;
  }

  deleteTask(id: string): boolean {
    this.tasks.deleteTask(id);
    this.emitChanged();
    return true;
  }

  restoreTask(id: string): Task {
    this.withTransaction(() => {
      this.archive.restoreTask(id);
      this.reminders.recomputeForTask(id);
      this.reminders.syncTaskNodeReminders(id);
      this.reminders.syncMiscReminder(id, new Date(), true);
    });
    this.emitChanged();
    return this.tasks.getTask(id) as Task;
  }

  setReminders(taskId: string, offsets: number[]): void {
    this.reminders.setOffsets(taskId, offsets);
    this.emitChanged();
  }

  setMiscReminder(request: MiscReminderUpdateRequest): Task {
    const changed = request.remindAtUtc !== request.expectedRemindAtUtc;
    const task = this.withTransaction(() => {
      const updated = this.tasks.setMiscReminder(request);
      this.reminders.syncMiscReminder(updated.id);
      return updated;
    });
    if (changed) this.emitChanged();
    return task;
  }

  resolveLegacyMiscDeadline(request: LegacyMiscDeadlineActionRequest): Task {
    const task = this.withTransaction(() => {
      const updated = this.tasks.resolveLegacyMiscDeadline(request);
      this.reminders.syncMiscReminder(updated.id);
      return updated;
    });
    this.emitChanged();
    return task;
  }

  addNode(taskId: string, input: NodeInput): TaskNode {
    const node = this.withTransaction(() => {
      const created = this.tasks.addNode(taskId, input);
      this.reminders.syncNodeReminder(created.id);
      return created;
    });
    this.emitChanged();
    return node;
  }

  updateNode(nodeId: string, input: NodeInput): TaskNode {
    const node = this.withTransaction(() => {
      const updated = this.tasks.updateNode(nodeId, input);
      this.reminders.syncNodeReminder(updated.id);
      return updated;
    });
    this.emitChanged();
    return node;
  }

  setNodeTitle(request: NodeTitleUpdateRequest): TaskNode {
    const node = this.withTransaction(() => this.tasks.setNodeTitle(request));
    if (node.title !== request.expectedTitle) this.emitChanged();
    return node;
  }

  setNodeStartTime(request: NodeTimeUpdateRequest): TaskNode {
    const node = this.withTransaction(() => {
      const updated = this.tasks.setNodeStartTime(request);
      this.reminders.syncNodeReminder(updated.id);
      return updated;
    });
    this.emitChanged();
    return node;
  }

  removeNode(nodeId: string): void {
    this.tasks.removeNode(nodeId);
    this.emitChanged();
  }

  setNodeStatus(nodeId: string, status: NodeStatus): TaskNode {
    const node = this.withTransaction(() => {
      const updated = this.tasks.setNodeStatus(nodeId, status);
      this.reminders.syncNodeReminder(updated.id);
      return updated;
    });
    this.emitChanged();
    return node;
  }

  reorderNodes(taskId: string, orderedIds: string[]): void {
    this.tasks.reorderNodes(taskId, orderedIds);
    this.emitChanged();
  }

  addLink(taskId: string, input: LinkInput): TaskLink {
    const link = this.tasks.addLink(taskId, input);
    this.emitChanged();
    return link;
  }

  removeLink(linkId: string): void {
    this.tasks.removeLink(linkId);
    this.emitChanged();
  }

  saveNote(taskId: string, body: string): void {
    this.tasks.saveNote(taskId, body);
    this.emitChanged();
  }

  private withTransaction<T>(action: () => T): T {
    const ownsTransaction = !this.db.isTransaction;
    if (ownsTransaction) this.db.exec('BEGIN');
    try {
      const result = action();
      if (ownsTransaction) this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (ownsTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
