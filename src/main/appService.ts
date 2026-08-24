import type { DatabaseSync } from 'node:sqlite';
import { ArchiveService } from './archiveService';
import { DraftService } from './draftService';
import { LlmService } from './llmService';
import { ReminderService } from './reminderService';
import { SettingsService } from './settingsService';
import { TaskService } from './taskService';
import type {
  LinkInput,
  NodeInput,
  NodeStatus,
  NodeTimeUpdateRequest,
  Task,
  TaskInput,
  TaskUrgencyUpdateRequest,
  TaskLink,
  TaskNode
} from '../shared/taskContracts';

// 组合根：任务/归档/提醒/设置/AI 的跨服务事务编排
export class AppService {
  readonly tasks: TaskService;
  readonly archive: ArchiveService;
  readonly reminders: ReminderService;
  readonly settings: SettingsService;
  readonly drafts: DraftService;
  readonly llm: LlmService;

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
    this.drafts = new DraftService(db, this.reminders);
    this.llm = new LlmService(this, this.settings);
    this.reminders.reconcileFutureNodeReminders();
  }

  createTask(input: TaskInput): Task {
    const t = this.tasks.createTask(input);
    // FR-060：设置中配置了全局默认提前量时自动添加提醒
    const defaults = this.settings.getJson<number[]>('reminder_default_offsets', []);
    if (t.deadlineUtc && defaults.length > 0) this.reminders.setOffsets(t.id, defaults);
    this.emitChanged();
    return t;
  }

  updateTask(id: string, input: TaskInput): Task {
    const t = this.tasks.updateTask(id, input);
    this.reminders.recomputeForTask(id);
    this.emitChanged();
    return t;
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
    });
    this.emitChanged();
    return this.tasks.getTask(id) as Task;
  }

  setReminders(taskId: string, offsets: number[]): void {
    this.reminders.setOffsets(taskId, offsets);
    this.emitChanged();
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

  confirmDraft(id: string): { type: 'task' | 'nodes' | 'action'; taskId: string } {
    const result = this.drafts.confirm(id);
    if (result.type === 'task') {
      const task = this.tasks.getTask(result.taskId);
      const defaults = this.settings.getJson<number[]>('reminder_default_offsets', []);
      if (task?.deadlineUtc && defaults.length > 0) this.reminders.setOffsets(result.taskId, defaults);
    }
    this.emitChanged();
    return result;
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
