import type { DatabaseSync } from 'node:sqlite';
import { ArchiveService } from './archiveService';
import { DraftService } from './draftService';
import { LlmService } from './llmService';
import { ReminderService } from './reminderService';
import { SettingsService } from './settingsService';
import { TaskService } from './taskService';
import type { Task, TaskInput } from '../shared/taskContracts';

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
    db: DatabaseSync,
    private readonly dataDir: string
  ) {
    this.tasks = new TaskService(db);
    this.archive = new ArchiveService(db, this.dataDir);
    this.reminders = new ReminderService(db);
    this.settings = new SettingsService(db);
    this.drafts = new DraftService(db);
    this.llm = new LlmService(this, this.settings);
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

  completeTask(id: string): Task {
    const t = this.tasks.setArchived(id, 'completed');
    this.archive.exportSnapshot(this.tasks.getTaskDetail(id));
    this.reminders.disableForTask(id);
    this.emitChanged();
    return t;
  }

  cancelTask(id: string): Task {
    const t = this.tasks.setArchived(id, 'cancelled');
    this.archive.exportSnapshot(this.tasks.getTaskDetail(id));
    this.reminders.disableForTask(id);
    this.emitChanged();
    return t;
  }

  deleteTask(id: string): boolean {
    this.tasks.deleteTask(id);
    this.emitChanged();
    return true;
  }

  restoreTask(id: string): Task {
    this.archive.restoreTask(id);
    this.reminders.recomputeForTask(id);
    this.emitChanged();
    return this.tasks.getTask(id) as Task;
  }

  setReminders(taskId: string, offsets: number[]): void {
    this.reminders.setOffsets(taskId, offsets);
  }
}
