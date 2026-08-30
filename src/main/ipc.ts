import path from 'node:path';
import { app, dialog, ipcMain, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { IslandWindowController } from './windowController';
import { mkdirSync } from 'node:fs';
import type { AppService } from './appService';
import type { FeishuService } from './feishuService';
import type { AgentService } from './agentService';
import type { DeepSeekConfigService } from './deepSeekConfigService';
import type { MemoryService } from './memoryService';
import type { AgentPermissionService } from './agentPermissionService';
import type { LocalCommandRuntime } from './localCommandServer';
import type { AppCommandService } from './appCommandService';
import type { DraftPayload } from '../shared/draftContracts';
import type { IslandLevel, L2ContentMode, LegacyMiscDeadlineActionRequest, LinkInput, MiscReminderUpdateRequest, NodeInput, NodeStatus, NodeTimeUpdateRequest, NodeTitleUpdateRequest, TaskCreateRequest, TaskInput, TaskNameUpdateRequest, TaskNamesUpdateRequest, TaskUrgencyUpdateRequest } from '../shared/types';
import type { AgentApprovalDecision, AgentPermissionMode, AgentRunRequest, DeepSeekModel } from '../shared/agentContracts';
import type { AgentProposalCreateRequest } from '../shared/agentProposalContracts';
import { PROCUREMENT_WORKFLOW_TEMPLATES } from '../shared/procurementContracts';
import type { ProcurementPlanApplyRequest, ProcurementProjectCreateRequest } from '../shared/procurementContracts';
import type { ContractActionInput, ContractActionReminderRequest, ContractActionStatusRequest, ContractActionUpdateRequest, ContractCreateRequest, ContractLinkInput, ContractStatusRequest, ContractUpdateRequest } from '../shared/contractContracts';

export function registerIpc(
  c: IslandWindowController,
  appSvc: AppService,
  feishu: FeishuService,
  agent: AgentService,
  deepSeek: DeepSeekConfigService,
  memories: MemoryService,
  permissions: AgentPermissionService,
  localCommands: LocalCommandRuntime,
  commands: AppCommandService
): void {
  const holdIsolatedTestLevel = !app.isPackaged && Boolean(process.env['CAIBAN_TEST_USER_DATA_DIR']) && process.env['CAIBAN_TEST_HOLD_LEVEL'] === '1';
  ipcMain.handle('window:setLevel', (_e: IpcMainInvokeEvent, level: IslandLevel) => {
    return c.setLevel(level);
  });
  ipcMain.handle('window:transitionReady', (_e: IpcMainInvokeEvent, id: string) => c.transitionReady(id));
  ipcMain.handle('window:transitionFinished', (_e: IpcMainInvokeEvent, id: string) => c.transitionFinished(id));
  ipcMain.handle('app:getState', () => c.state());
  ipcMain.handle('ui:getPreferences', () => c.uiPreferences());
  ipcMain.handle('ui:interacting', (_e: IpcMainInvokeEvent, v: boolean) => {
    if (!(holdIsolatedTestLevel && !v)) c.setInteracting(v);
    return true;
  });
  ipcMain.handle('island:togglePause', () => c.togglePause());
  ipcMain.handle('window:setL2Detail', (_e: IpcMainInvokeEvent, v: boolean) => {
    return c.setL2Detail(v);
  });
  ipcMain.handle('window:setL2ContentMode', (_e: IpcMainInvokeEvent, mode: L2ContentMode) => c.setL2ContentMode(mode));
  ipcMain.handle('window:activate', () => {
    if (!c.win.isFocused()) c.win.focus();
    return true;
  });
  ipcMain.handle('app:quit', () => {
    app.quit();
    return true;
  });
  if (process.env.ISLAND_DEBUG === '1') {
    ipcMain.handle('debug:sendKey', (_e: IpcMainInvokeEvent, text: string) => {
      c.win.webContents.sendInputEvent({ type: 'char', keyCode: text });
      return true;
    });
    ipcMain.handle('debug:sendTab', () => {
      c.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
      c.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
      return true;
    });
  }

  const { tasks, archive, reminders, settings } = appSvc;

  ipcMain.handle('tasks:list', () => wrap(() => tasks.listActive()));
  ipcMain.handle('tasks:detail', (_e: IpcMainInvokeEvent, id: string) => wrap(() => tasks.getTaskDetail(id)));
  ipcMain.handle('tasks:create', (_e: IpcMainInvokeEvent, input: TaskCreateRequest) => wrap(() => commands.execute({ name: 'create_task', input }).data));
  ipcMain.handle('tasks:update', (_e: IpcMainInvokeEvent, id: string, input: TaskInput) => wrap(() => commands.execute({ name: 'update_task', input: { taskId: id, task: input } }).data));
  ipcMain.handle('tasks:setName', (_e: IpcMainInvokeEvent, request: TaskNameUpdateRequest) => wrap(() => commands.execute({ name: 'set_task_name', input: request }).data));
  ipcMain.handle('tasks:setNames', (_e: IpcMainInvokeEvent, request: TaskNamesUpdateRequest) => wrap(() => commands.execute({ name: 'set_task_names', input: request }).data));
  ipcMain.handle('tasks:setUrgency', (_e: IpcMainInvokeEvent, request: TaskUrgencyUpdateRequest) => wrap(() => commands.execute({ name: 'set_task_urgency', input: request }).data));
  ipcMain.handle('tasks:complete', (_e: IpcMainInvokeEvent, id: string) => wrap(() => commands.execute({ name: 'complete_task', input: { taskId: id } }).data));
  ipcMain.handle('tasks:cancel', (_e: IpcMainInvokeEvent, id: string) => wrap(() => commands.execute({ name: 'cancel_task', input: { taskId: id } }).data));
  ipcMain.handle('tasks:delete', (_e: IpcMainInvokeEvent, id: string) => wrap(() => commands.execute({ name: 'delete_task', input: { taskId: id } }).data));

  ipcMain.handle('procurements:templates', () => wrap(() => PROCUREMENT_WORKFLOW_TEMPLATES));
  ipcMain.handle('procurements:create', (_e: IpcMainInvokeEvent, input: ProcurementProjectCreateRequest) =>
    wrap(() => commands.execute({ name: 'create_procurement_project', input }).data));
  ipcMain.handle('procurements:applyPlan', (_e: IpcMainInvokeEvent, input: ProcurementPlanApplyRequest) =>
    wrap(() => commands.execute({ name: 'apply_procurement_plan', input }).data));

  ipcMain.handle('contracts:list', () => wrap(() => appSvc.contracts.listCards()));
  ipcMain.handle('contracts:detail', (_e: IpcMainInvokeEvent, id: string) => wrap(() => appSvc.contracts.detail(id)));
  ipcMain.handle('contracts:create', (_e: IpcMainInvokeEvent, input: ContractCreateRequest) => wrap(() => commands.execute({ name: 'create_contract', input }).data));
  ipcMain.handle('contracts:update', (_e: IpcMainInvokeEvent, input: ContractUpdateRequest) => wrap(() => commands.execute({ name: 'update_contract', input }).data));
  ipcMain.handle('contracts:setStatus', (_e: IpcMainInvokeEvent, input: ContractStatusRequest) => wrap(() => commands.execute({ name: 'set_contract_status', input }).data));
  ipcMain.handle('contracts:restore', (_e: IpcMainInvokeEvent, id: string) => wrap(() => commands.execute({ name: 'restore_contract', input: { contractId: id } }).data));
  ipcMain.handle('contractActions:add', (_e: IpcMainInvokeEvent, contractId: string, action: ContractActionInput) => wrap(() => commands.execute({ name: 'add_contract_action', input: { contractId, action } }).data));
  ipcMain.handle('contractActions:update', (_e: IpcMainInvokeEvent, input: ContractActionUpdateRequest) => wrap(() => commands.execute({ name: 'update_contract_action', input }).data));
  ipcMain.handle('contractActions:setStatus', (_e: IpcMainInvokeEvent, input: ContractActionStatusRequest) => wrap(() => commands.execute({ name: 'set_contract_action_status', input }).data));
  ipcMain.handle('contractActions:remove', (_e: IpcMainInvokeEvent, id: string) => wrap(() => commands.execute({ name: 'remove_contract_action', input: { actionId: id } }).data));
  ipcMain.handle('contractActions:setReminder', (_e: IpcMainInvokeEvent, input: ContractActionReminderRequest) => wrap(() => commands.execute({ name: 'set_contract_action_reminder', input }).data));
  ipcMain.handle('contractLinks:add', (_e: IpcMainInvokeEvent, contractId: string, link: ContractLinkInput) => wrap(() => commands.execute({ name: 'add_contract_link', input: { contractId, link } }).data));
  ipcMain.handle('contractLinks:remove', (_e: IpcMainInvokeEvent, id: string) => wrap(() => commands.execute({ name: 'remove_contract_link', input: { linkId: id } }).data));
  ipcMain.handle('contractNotes:save', (_e: IpcMainInvokeEvent, contractId: string, body: string) => wrap(() => commands.execute({ name: 'save_contract_note', input: { contractId, body } }).data));

  ipcMain.handle('nodes:add', (_e: IpcMainInvokeEvent, taskId: string, input: NodeInput) => wrap(() => commands.execute({ name: 'add_node', input: { taskId, node: input } }).data));
  ipcMain.handle('nodes:update', (_e: IpcMainInvokeEvent, nodeId: string, input: NodeInput) => wrap(() => commands.execute({ name: 'update_node', input: { nodeId, node: input } }).data));
  ipcMain.handle('nodes:setTitle', (_e: IpcMainInvokeEvent, request: NodeTitleUpdateRequest) => wrap(() => commands.execute({ name: 'set_node_title', input: request }).data));
  ipcMain.handle('nodes:setStartTime', (_e: IpcMainInvokeEvent, request: NodeTimeUpdateRequest) => wrap(() => commands.execute({ name: 'set_node_start_time', input: request }).data));
  ipcMain.handle('nodes:remove', (_e: IpcMainInvokeEvent, nodeId: string) => wrap(() => commands.execute({ name: 'remove_node', input: { nodeId } }).data));
  ipcMain.handle('nodes:setStatus', (_e: IpcMainInvokeEvent, nodeId: string, status: NodeStatus) => wrap(() => commands.execute({ name: 'set_node_status', input: { nodeId, status } }).data));
  ipcMain.handle('nodes:reorder', (_e: IpcMainInvokeEvent, taskId: string, orderedIds: string[]) => wrap(() => commands.execute({ name: 'reorder_nodes', input: { taskId, orderedNodeIds: orderedIds } }).data));

  ipcMain.handle('links:add', (_e: IpcMainInvokeEvent, taskId: string, input: LinkInput) => wrap(() => commands.execute({ name: 'add_link', input: { taskId, link: input } }).data));
  ipcMain.handle('links:remove', (_e: IpcMainInvokeEvent, linkId: string) => wrap(() => commands.execute({ name: 'remove_link', input: { linkId } }).data));

  ipcMain.handle('notes:save', (_e: IpcMainInvokeEvent, taskId: string, body: string) => wrap(() => commands.execute({ name: 'save_note', input: { taskId, body } }).data));

  // —— 提醒 ——
  ipcMain.handle('reminders:list', (_e: IpcMainInvokeEvent, taskId: string) => wrap(() => reminders.offsetsForTask(taskId)));
  ipcMain.handle('reminders:set', (_e: IpcMainInvokeEvent, taskId: string, offsets: number[]) => {
    try {
      commands.execute({ name: 'set_reminders', input: { taskId, offsets } });
      return { ok: true, data: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('misc:setReminder', (_e: IpcMainInvokeEvent, request: MiscReminderUpdateRequest) => wrap(() => commands.execute({ name: 'set_misc_reminder', input: request }).data));
  ipcMain.handle('misc:resolveLegacyDeadline', (_e: IpcMainInvokeEvent, request: LegacyMiscDeadlineActionRequest) => wrap(() => commands.execute({ name: 'resolve_legacy_misc_deadline', input: request }).data));

  // —— 归档 ——
  ipcMain.handle('archive:list', () => wrap(() => archive.listArchived()));
  ipcMain.handle('archive:search', (_e: IpcMainInvokeEvent, q: string, outcome?: string) => wrap(() => archive.searchArchived(q, outcome)));
  ipcMain.handle('archive:get', (_e: IpcMainInvokeEvent, id: string) => wrap(() => archive.getArchivedDetail(id)));
  ipcMain.handle('archive:restore', (_e: IpcMainInvokeEvent, id: string) => wrap(() => commands.execute({ name: 'restore_task', input: { taskId: id } }).data));

  // —— 设置 ——
  ipcMain.handle('settings:getAll', () =>
    wrap(() => ({
      reminder_default_offsets: settings.getJson<number[]>('reminder_default_offsets', []),
      autostart: settings.get('autostart') === '1',
      acrylic_disabled: settings.get('acrylic_disabled') === '1',
      onboarded: settings.get('onboarded') === '1'
    }))
  );
  ipcMain.handle('settings:set', (_e: IpcMainInvokeEvent, key: string, value: string) => {
    settings.set(key, value);
    if (key === 'acrylic_disabled') c.applyBackdrop();
    if (key === 'autostart') {
      app.setLoginItemSettings({ openAtLogin: value === '1' });
    }
    return { ok: true, data: true };
  });
  ipcMain.handle('app:openDataDir', async () => {
    const err = await shell.openPath(app.getPath('userData'));
    return err === '' ? { ok: true, data: true } : { ok: false, error: err };
  });

  // —— 遗留待确认草稿（只在 Agent 工作区呈现） ——
  ipcMain.handle('drafts:list', (_e: IpcMainInvokeEvent, sessionId?: string) => wrap(() => appSvc.drafts.listPending(sessionId)));
  ipcMain.handle('drafts:get', (_e: IpcMainInvokeEvent, id: string) => wrap(() => appSvc.drafts.get(id)));
  ipcMain.handle('drafts:update', (_e: IpcMainInvokeEvent, id: string, payload: DraftPayload) => wrap(() => appSvc.drafts.updatePayload(id, payload)));
  ipcMain.handle('drafts:discard', (_e: IpcMainInvokeEvent, id: string) => wrap(() => appSvc.drafts.discard(id)));
  ipcMain.handle('drafts:confirm', (_e: IpcMainInvokeEvent, id: string) => wrap(() => commands.execute({ name: 'confirm_legacy_draft', input: { draftId: id } }).data));

  // —— 通用 Agent 提案：命令批次在同一事务内批准或完整回滚 ——
  ipcMain.handle('proposals:list', (_e: IpcMainInvokeEvent, sessionId?: string) => wrap(() => appSvc.proposals.listPending(sessionId)));
  ipcMain.handle('proposals:create', (_e: IpcMainInvokeEvent, request: AgentProposalCreateRequest) => wrap(() => appSvc.proposals.create(request)));
  ipcMain.handle('proposals:discard', (_e: IpcMainInvokeEvent, id: string) => wrap(() => appSvc.proposals.discard(id)));
  ipcMain.handle('proposals:approve', (_e: IpcMainInvokeEvent, id: string) => wrap(() => appSvc.proposals.approve(id, (command) => commands.execute(command))));

  // —— 原生 Pi Agent / DeepSeek ——
  ipcMain.handle('agent:start', (_e: IpcMainInvokeEvent, request: AgentRunRequest) => wrap(() => agent.start(request)));
  ipcMain.handle('agent:send', (_e: IpcMainInvokeEvent, request: AgentRunRequest) => wrap(() => agent.send(request)));
  ipcMain.handle('agent:cancel', () => wrap(() => agent.cancel()));
  ipcMain.handle('agent:getRunSnapshot', () => wrap(() => agent.runSnapshot()));
  ipcMain.handle('agent:setSurfaceVisible', (_e: IpcMainInvokeEvent, visible: boolean) => wrap(() => {
    agent.setSurfaceVisible(visible);
    return true;
  }));
  ipcMain.handle('agent:listSessions', () => wrap(() => agent.listSessions()));
  ipcMain.handle('agent:getSession', (_e: IpcMainInvokeEvent, id: string) => wrap(() => agent.getSession(id)));
  ipcMain.handle('agent:deleteSession', (_e: IpcMainInvokeEvent, id: string) => wrap(() => { agent.deleteSession(id); return true; }));
  ipcMain.handle('agent:clearSessions', () => wrap(() => agent.clearSessions()));
  ipcMain.handle('agent:exportSession', (_e: IpcMainInvokeEvent, id: string, format: 'json' | 'markdown') =>
    wrap(() => agent.exportSession(id, format)));
  ipcMain.handle('agent:getPermissions', () => wrap(() => permissions.snapshot()));
  ipcMain.handle('agent:setPermissionMode', (_e: IpcMainInvokeEvent, mode: AgentPermissionMode, bypassWarningAccepted: boolean) =>
    wrap(() => permissions.setMode(mode, bypassWarningAccepted)));
  ipcMain.handle('agent:chooseAuthorizedDirectory', async () => {
    const selected = await dialog.showOpenDialog(c.win, { properties: ['openDirectory'], title: '授权 Agent 使用此目录' });
    if (selected.canceled || selected.filePaths.length === 0) return { ok: true as const, data: permissions.snapshot() };
    return wrap(() => permissions.addDirectory(selected.filePaths[0]));
  });
  ipcMain.handle('agent:removeAuthorizedDirectory', (_e: IpcMainInvokeEvent, id: string) => wrap(() => permissions.removeDirectory(id)));
  ipcMain.handle('agent:resolveApproval', (_e: IpcMainInvokeEvent, id: string, decision: AgentApprovalDecision) =>
    wrap(() => permissions.resolveApproval(id, decision)));
  ipcMain.handle('localCommands:getConfig', () => wrap(() => localCommands.config()));
  ipcMain.handle('deepseek:status', () => wrap(() => deepSeek.status()));
  ipcMain.handle('deepseek:saveConfig', (_e: IpcMainInvokeEvent, model: DeepSeekModel, key: string) =>
    wrap(() => { deepSeek.save(model, key); return true; }));
  ipcMain.handle('deepseek:test', async () => {
    try { return { ok: true as const, data: await deepSeek.test() }; }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : String(error) }; }
  });

  // —— 用户确认的长期记忆 ——
  ipcMain.handle('memory:list', () => wrap(() => memories.list()));
  ipcMain.handle('memory:listProposals', () => wrap(() => memories.listProposals()));
  ipcMain.handle('memory:confirmProposal', (_e: IpcMainInvokeEvent, id: string, editedFact?: string) =>
    wrap(() => memories.confirmProposal(id, editedFact)));
  ipcMain.handle('memory:discardProposal', (_e: IpcMainInvokeEvent, id: string) =>
    wrap(() => { memories.discardProposal(id); return true; }));
  ipcMain.handle('memory:update', (_e: IpcMainInvokeEvent, id: string, fact: string) => wrap(() => memories.update(id, fact)));
  ipcMain.handle('memory:delete', (_e: IpcMainInvokeEvent, id: string) => wrap(() => { memories.delete(id); return true; }));
  ipcMain.handle('memory:clear', () => wrap(() => memories.clear()));

  // —— 飞书同步（P6） ——
  const feishuStatus = () => ({
    configured: feishu.tokenConfigured(),
    autoSync: feishu.autoSyncEnabled(),
    target: feishu.getTarget(),
    lastSync: feishu.lastSyncStatus()
  });
  ipcMain.handle('feishu:status', () => wrap(() => feishuStatus()));
  ipcMain.handle('feishu:saveToken', (_e: IpcMainInvokeEvent, token: string) => {
    try {
      feishu.saveToken(token);
      return { ok: true, data: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('feishu:test', async () => {
    try {
      const msg = await feishu.testConnection();
      return { ok: true, data: msg };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('feishu:sync', async () => {
    try {
      const r = await feishu.sync();
      return { ok: true, data: r };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('feishu:setAutoSync', (_e: IpcMainInvokeEvent, v: boolean) => {
    appSvc.settings.set('feishu_auto_sync', v ? '1' : '0');
    return { ok: true, data: true };
  });
  // 快速导出（写入数据目录 export\，免对话框，便于自动化与随手导出）
  ipcMain.handle('feishu:exportCsv', () => {
    try {
      const dir = path.join(app.getPath('userData'), 'export');
      mkdirSync(dir, { recursive: true });
      const p = path.join(dir, 'caiban-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.csv');
      feishu.exportCsv(p);
      return { ok: true, data: p };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('feishu:exportTaskCsv', (_e: IpcMainInvokeEvent, taskId: string) => {
    try {
      const dir = path.join(app.getPath('userData'), 'export');
      mkdirSync(dir, { recursive: true });
      const p = path.join(dir, 'task-' + taskId.slice(0, 8) + '-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.csv');
      feishu.exportTaskCsv(p, taskId);
      return { ok: true, data: p };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('feishu:exportArchivedCsv', () => {
    try {
      const dir = path.join(app.getPath('userData'), 'export');
      mkdirSync(dir, { recursive: true });
      const p = path.join(dir, 'archive-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.csv');
      feishu.exportArchivedCsv(p);
      return { ok: true, data: p };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('feishu:exportMarkdown', () => {
    try {
      const dir = path.join(app.getPath('userData'), 'export');
      mkdirSync(dir, { recursive: true });
      const p = path.join(dir, 'caiban-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.md');
      feishu.exportMarkdown(p);
      return { ok: true, data: p };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // —— 系统打开动作 ——
  ipcMain.handle('system:openUrl', async (_e: IpcMainInvokeEvent, url: string) => {
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: '仅支持 http/https 网址' };
    await shell.openExternal(url);
    return { ok: true, data: true };
  });
  ipcMain.handle('system:openPath', async (_e: IpcMainInvokeEvent, p: string) => {
    const r = await shell.openPath(p);
    return r === '' ? { ok: true, data: true } : { ok: false, error: r };
  });
  ipcMain.handle('system:showInFolder', (_e: IpcMainInvokeEvent, p: string) => {
    shell.showItemInFolder(p);
    return { ok: true, data: true };
  });
}

function wrap<T>(fn: () => T): { ok: true; data: T } | { ok: false; error: string } {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
