import type { AppCommand, AppCommandName, AppCommandResult } from '../shared/appCommandContracts';
import type { AgentToolRisk } from '../shared/agentContracts';
import type { AppService } from './appService';

export interface AppCommandDefinition {
  name: AppCommandName;
  risk: AgentToolRisk;
  summary: string;
  undoable: boolean;
  inputFields: readonly string[];
  expectedOldValueFields: readonly string[];
}

const DEFINITIONS: readonly AppCommandDefinition[] = [
  { name: 'create_task', risk: 'high', summary: '创建任务卡片', undoable: true, inputFields: ['kind'], expectedOldValueFields: [] },
  { name: 'update_task', risk: 'reversible', summary: '修改任务说明和计划', undoable: true, inputFields: ['taskId', 'task'], expectedOldValueFields: [] },
  { name: 'set_task_name', risk: 'reversible', summary: '修改任务名称', undoable: true, inputFields: ['taskId', 'name', 'expectedName'], expectedOldValueFields: ['expectedName'] },
  { name: 'set_task_names', risk: 'reversible', summary: '修改项目正式名称与简称', undoable: true, inputFields: ['taskId', 'fullName', 'shortName', 'expectedFullName', 'expectedShortName'], expectedOldValueFields: ['expectedFullName', 'expectedShortName'] },
  { name: 'set_task_urgency', risk: 'reversible', summary: '修改任务紧急度', undoable: true, inputFields: ['taskId', 'urgency', 'expectedUrgency'], expectedOldValueFields: ['expectedUrgency'] },
  { name: 'complete_task', risk: 'high', summary: '完成并归档任务', undoable: true, inputFields: ['taskId'], expectedOldValueFields: [] },
  { name: 'cancel_task', risk: 'high', summary: '取消并归档任务', undoable: true, inputFields: ['taskId'], expectedOldValueFields: [] },
  { name: 'restore_task', risk: 'high', summary: '恢复归档任务', undoable: true, inputFields: ['taskId'], expectedOldValueFields: [] },
  { name: 'delete_task', risk: 'high', summary: '永久删除任务', undoable: false, inputFields: ['taskId'], expectedOldValueFields: [] },
  { name: 'set_reminders', risk: 'reversible', summary: '修改任务提醒', undoable: true, inputFields: ['taskId', 'offsets'], expectedOldValueFields: [] },
  { name: 'set_misc_reminder', risk: 'reversible', summary: '修改杂事提醒', undoable: true, inputFields: ['taskId', 'remindAtUtc', 'expectedRemindAtUtc'], expectedOldValueFields: ['expectedRemindAtUtc'] },
  { name: 'add_node', risk: 'reversible', summary: '新增任务节点', undoable: true, inputFields: ['taskId', 'node'], expectedOldValueFields: [] },
  { name: 'update_node', risk: 'reversible', summary: '修改任务节点', undoable: true, inputFields: ['nodeId', 'node'], expectedOldValueFields: [] },
  { name: 'set_node_title', risk: 'reversible', summary: '修改节点标题', undoable: true, inputFields: ['nodeId', 'title', 'expectedTitle'], expectedOldValueFields: ['expectedTitle'] },
  { name: 'set_node_start_time', risk: 'reversible', summary: '修改节点开始时间', undoable: true, inputFields: ['nodeId', 'startUtc', 'expectedStartUtc'], expectedOldValueFields: ['expectedStartUtc'] },
  { name: 'set_node_status', risk: 'reversible', summary: '修改节点状态', undoable: true, inputFields: ['nodeId', 'status'], expectedOldValueFields: [] },
  { name: 'reorder_nodes', risk: 'reversible', summary: '调整节点顺序', undoable: true, inputFields: ['taskId', 'orderedNodeIds'], expectedOldValueFields: [] },
  { name: 'remove_node', risk: 'high', summary: '删除任务节点', undoable: false, inputFields: ['nodeId'], expectedOldValueFields: [] },
  { name: 'add_link', risk: 'reversible', summary: '新增任务资料', undoable: true, inputFields: ['taskId', 'link'], expectedOldValueFields: [] },
  { name: 'remove_link', risk: 'high', summary: '删除任务资料', undoable: false, inputFields: ['linkId'], expectedOldValueFields: [] },
  { name: 'save_note', risk: 'reversible', summary: '修改任务备注', undoable: true, inputFields: ['taskId', 'body'], expectedOldValueFields: [] },
  { name: 'resolve_legacy_misc_deadline', risk: 'reversible', summary: '处理旧杂事截止时间', undoable: true, inputFields: ['taskId', 'action', 'expectedDeadlineUtc'], expectedOldValueFields: ['expectedDeadlineUtc'] },
  { name: 'confirm_legacy_draft', risk: 'high', summary: '确认遗留草稿', undoable: true, inputFields: ['draftId'], expectedOldValueFields: [] }
];

export const APP_COMMAND_REGISTRY = new Map<AppCommandName, AppCommandDefinition>(
  DEFINITIONS.map((definition) => [definition.name, definition])
);

export class AppCommandError extends Error {}

export class AppCommandService {
  constructor(private readonly appSvc: AppService) {}

  definition(name: AppCommandName): AppCommandDefinition {
    const definition = APP_COMMAND_REGISTRY.get(name);
    if (!definition) throw new AppCommandError('未注册的应用命令');
    return definition;
  }

  execute(command: AppCommand): AppCommandResult {
    const definition = this.definition(command.name);
    let entityId: string | undefined;
    let data: unknown;
    switch (command.name) {
      case 'create_task': { const value = this.appSvc.createTask(command.input); data = value; entityId = value.id; break; }
      case 'update_task': { const value = this.appSvc.updateTask(command.input.taskId, command.input.task); data = value; entityId = value.id; break; }
      case 'set_task_name': { const value = this.appSvc.setTaskName(command.input); data = value; entityId = value.id; break; }
      case 'set_task_names': { const value = this.appSvc.setTaskNames(command.input); data = value; entityId = value.id; break; }
      case 'set_task_urgency': { const value = this.appSvc.setTaskUrgency(command.input); data = value; entityId = value.id; break; }
      case 'complete_task': { const value = this.appSvc.completeTask(command.input.taskId); data = value; entityId = value.id; break; }
      case 'cancel_task': { const value = this.appSvc.cancelTask(command.input.taskId); data = value; entityId = value.id; break; }
      case 'restore_task': { const value = this.appSvc.restoreTask(command.input.taskId); data = value; entityId = value.id; break; }
      case 'delete_task': data = this.appSvc.deleteTask(command.input.taskId); entityId = command.input.taskId; break;
      case 'set_reminders': this.appSvc.setReminders(command.input.taskId, command.input.offsets); data = true; entityId = command.input.taskId; break;
      case 'set_misc_reminder': { const value = this.appSvc.setMiscReminder(command.input); data = value; entityId = value.id; break; }
      case 'add_node': { const value = this.appSvc.addNode(command.input.taskId, command.input.node); data = value; entityId = value.id; break; }
      case 'update_node': { const value = this.appSvc.updateNode(command.input.nodeId, command.input.node); data = value; entityId = value.id; break; }
      case 'set_node_title': { const value = this.appSvc.setNodeTitle(command.input); data = value; entityId = value.id; break; }
      case 'set_node_start_time': { const value = this.appSvc.setNodeStartTime(command.input); data = value; entityId = value.id; break; }
      case 'set_node_status': { const value = this.appSvc.setNodeStatus(command.input.nodeId, command.input.status); data = value; entityId = value.id; break; }
      case 'reorder_nodes': this.appSvc.reorderNodes(command.input.taskId, command.input.orderedNodeIds); data = true; entityId = command.input.taskId; break;
      case 'remove_node': this.appSvc.removeNode(command.input.nodeId); data = true; entityId = command.input.nodeId; break;
      case 'add_link': { const value = this.appSvc.addLink(command.input.taskId, command.input.link); data = value; entityId = value.id; break; }
      case 'remove_link': this.appSvc.removeLink(command.input.linkId); data = true; entityId = command.input.linkId; break;
      case 'save_note': this.appSvc.saveNote(command.input.taskId, command.input.body); data = true; entityId = command.input.taskId; break;
      case 'resolve_legacy_misc_deadline': { const value = this.appSvc.resolveLegacyMiscDeadline(command.input); data = value; entityId = value.id; break; }
      case 'confirm_legacy_draft': { const value = this.appSvc.confirmDraft(command.input.draftId); data = value; entityId = value.taskId; break; }
    }
    return { command: command.name, summary: definition.summary + '已完成', entityId, undoable: definition.undoable, data };
  }
}
