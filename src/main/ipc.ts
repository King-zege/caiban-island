import path from 'node:path';
import { app, ipcMain, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { IslandWindowController } from './windowController';
import { mkdirSync } from 'node:fs';
import type { AppService } from './appService';
import type { FeishuService } from './feishuService';
import type { McpTokenVault } from './mcpTokenVault';
import type { AgentService } from './agentService';
import type { DeepSeekConfigService } from './deepSeekConfigService';
import type { MemoryService } from './memoryService';
import type { DraftPayload } from '../shared/draftContracts';
import type { IslandLevel, LinkInput, NodeInput, NodeStatus, NodeTimeUpdateRequest, TaskInput, TaskUrgencyUpdateRequest } from '../shared/types';
import type { AgentRunRequest, DeepSeekModel } from '../shared/agentContracts';

export function registerIpc(
  c: IslandWindowController,
  appSvc: AppService,
  feishu: FeishuService,
  tokenVault: McpTokenVault,
  agent: AgentService,
  deepSeek: DeepSeekConfigService,
  memories: MemoryService
): void {
  const mcpConfig = () => {
    const port = Number(appSvc.settings.get('mcp_port') ?? 0);
    const token = tokenVault.current();
    const bridge = path.join(app.getAppPath(), 'scripts', 'caiban-stdio.mjs');
    return {
      url: 'http://127.0.0.1:' + port + '/mcp?token=' + token,
      token,
      port,
      stdioCommand: 'node "' + bridge + '"'
    };
  };
  ipcMain.handle('window:setLevel', (_e: IpcMainInvokeEvent, level: IslandLevel) => {
    return c.setLevel(level);
  });
  ipcMain.handle('window:transitionReady', (_e: IpcMainInvokeEvent, id: string) => c.transitionReady(id));
  ipcMain.handle('window:transitionFinished', (_e: IpcMainInvokeEvent, id: string) => c.transitionFinished(id));
  ipcMain.handle('app:getState', () => c.state());
  ipcMain.handle('ui:getPreferences', () => c.uiPreferences());
  ipcMain.handle('ui:interacting', (_e: IpcMainInvokeEvent, v: boolean) => {
    c.setInteracting(v);
    return true;
  });
  ipcMain.handle('island:togglePause', () => c.togglePause());
  ipcMain.handle('window:setL2Detail', (_e: IpcMainInvokeEvent, v: boolean) => {
    return c.setL2Detail(v);
  });
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
  ipcMain.handle('tasks:create', (_e: IpcMainInvokeEvent, input: TaskInput) => wrap(() => appSvc.createTask(input)));
  ipcMain.handle('tasks:update', (_e: IpcMainInvokeEvent, id: string, input: TaskInput) => wrap(() => appSvc.updateTask(id, input)));
  ipcMain.handle('tasks:setUrgency', (_e: IpcMainInvokeEvent, request: TaskUrgencyUpdateRequest) => wrap(() => appSvc.setTaskUrgency(request)));
  ipcMain.handle('tasks:complete', (_e: IpcMainInvokeEvent, id: string) => wrap(() => appSvc.completeTask(id)));
  ipcMain.handle('tasks:cancel', (_e: IpcMainInvokeEvent, id: string) => wrap(() => appSvc.cancelTask(id)));
  ipcMain.handle('tasks:delete', (_e: IpcMainInvokeEvent, id: string) => wrap(() => appSvc.deleteTask(id)));

  ipcMain.handle('nodes:add', (_e: IpcMainInvokeEvent, taskId: string, input: NodeInput) => wrap(() => appSvc.addNode(taskId, input)));
  ipcMain.handle('nodes:update', (_e: IpcMainInvokeEvent, nodeId: string, input: NodeInput) => wrap(() => appSvc.updateNode(nodeId, input)));
  ipcMain.handle('nodes:setStartTime', (_e: IpcMainInvokeEvent, request: NodeTimeUpdateRequest) => wrap(() => appSvc.setNodeStartTime(request)));
  ipcMain.handle('nodes:remove', (_e: IpcMainInvokeEvent, nodeId: string) => wrap(() => appSvc.removeNode(nodeId)));
  ipcMain.handle('nodes:setStatus', (_e: IpcMainInvokeEvent, nodeId: string, status: NodeStatus) => wrap(() => appSvc.setNodeStatus(nodeId, status)));
  ipcMain.handle('nodes:reorder', (_e: IpcMainInvokeEvent, taskId: string, orderedIds: string[]) => wrap(() => appSvc.reorderNodes(taskId, orderedIds)));

  ipcMain.handle('links:add', (_e: IpcMainInvokeEvent, taskId: string, input: LinkInput) => wrap(() => appSvc.addLink(taskId, input)));
  ipcMain.handle('links:remove', (_e: IpcMainInvokeEvent, linkId: string) => wrap(() => appSvc.removeLink(linkId)));

  ipcMain.handle('notes:save', (_e: IpcMainInvokeEvent, taskId: string, body: string) => wrap(() => appSvc.saveNote(taskId, body)));

  // —— 提醒 ——
  ipcMain.handle('reminders:list', (_e: IpcMainInvokeEvent, taskId: string) => wrap(() => reminders.offsetsForTask(taskId)));
  ipcMain.handle('reminders:set', (_e: IpcMainInvokeEvent, taskId: string, offsets: number[]) => {
    try {
      appSvc.setReminders(taskId, offsets);
      return { ok: true, data: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // —— 归档 ——
  ipcMain.handle('archive:list', () => wrap(() => archive.listArchived()));
  ipcMain.handle('archive:search', (_e: IpcMainInvokeEvent, q: string, outcome?: string) => wrap(() => archive.searchArchived(q, outcome)));
  ipcMain.handle('archive:get', (_e: IpcMainInvokeEvent, id: string) => wrap(() => archive.getArchivedDetail(id)));
  ipcMain.handle('archive:restore', (_e: IpcMainInvokeEvent, id: string) => wrap(() => appSvc.restoreTask(id)));

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

  // —— AI 草稿 ——
  ipcMain.handle('drafts:list', () => wrap(() => appSvc.drafts.listPending()));
  ipcMain.handle('drafts:update', (_e: IpcMainInvokeEvent, id: string, payload: DraftPayload) => wrap(() => appSvc.drafts.updatePayload(id, payload)));
  ipcMain.handle('drafts:discard', (_e: IpcMainInvokeEvent, id: string) => wrap(() => appSvc.drafts.discard(id)));
  ipcMain.handle('drafts:confirm', (_e: IpcMainInvokeEvent, id: string) => wrap(() => appSvc.confirmDraft(id)));

  // —— MCP 配置 ——
  ipcMain.handle('mcp:getConfig', () => wrap(() => mcpConfig()));
  ipcMain.handle('mcp:resetToken', () => {
    tokenVault.reset();
    return { ok: true, data: mcpConfig() };
  });

  // —— 内置 AI ——
  ipcMain.handle('ai:status', () => wrap(() => appSvc.llm.status()));
  ipcMain.handle('ai:saveConfig', (_e: IpcMainInvokeEvent, baseUrl: string, model: string, key: string) => {
    try {
      appSvc.llm.saveConfig(baseUrl, model, key);
      return { ok: true, data: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('ai:test', async () => {
    try {
      const msg = await appSvc.llm.test();
      return { ok: true, data: msg };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('ai:breakdown', async (_e: IpcMainInvokeEvent, description: string) => {
    try {
      const draft = await appSvc.llm.breakdown(description);
      return { ok: true, data: draft };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // —— 原生 Pi Agent / DeepSeek ——
  ipcMain.handle('agent:start', (_e: IpcMainInvokeEvent, request: AgentRunRequest) => wrap(() => agent.start(request)));
  ipcMain.handle('agent:send', (_e: IpcMainInvokeEvent, request: AgentRunRequest) => wrap(() => agent.send(request)));
  ipcMain.handle('agent:cancel', () => wrap(() => agent.cancel()));
  ipcMain.handle('agent:listSessions', () => wrap(() => agent.listSessions()));
  ipcMain.handle('agent:getSession', (_e: IpcMainInvokeEvent, id: string) => wrap(() => agent.getSession(id)));
  ipcMain.handle('agent:deleteSession', (_e: IpcMainInvokeEvent, id: string) => wrap(() => { agent.deleteSession(id); return true; }));
  ipcMain.handle('agent:clearSessions', () => wrap(() => agent.clearSessions()));
  ipcMain.handle('agent:exportSession', (_e: IpcMainInvokeEvent, id: string, format: 'json' | 'markdown') =>
    wrap(() => agent.exportSession(id, format)));
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
