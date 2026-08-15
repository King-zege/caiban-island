import { app, ipcMain, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { IslandWindowController } from './windowController';
import type { TaskService } from './taskService';
import type { IslandLevel, LinkInput, NodeInput, NodeStatus, TaskInput } from '../shared/types';

export function registerIpc(c: IslandWindowController, tasks: TaskService): void {
  ipcMain.handle('window:setLevel', (_e: IpcMainInvokeEvent, level: IslandLevel) => {
    c.setLevel(level);
    return true;
  });
  ipcMain.handle('app:getState', () => c.state());
  ipcMain.handle('ui:interacting', (_e: IpcMainInvokeEvent, v: boolean) => {
    c.setInteracting(v);
    return true;
  });
  ipcMain.handle('island:togglePause', () => c.togglePause());
  ipcMain.handle('window:setL2Detail', (_e: IpcMainInvokeEvent, v: boolean) => {
    c.setL2Detail(v);
    return true;
  });
  ipcMain.handle('window:activate', () => {
    // 仅当窗口未聚焦时才激活；已聚焦时调用 focus() 会重置 DOM 焦点
    if (!c.win.isFocused()) c.win.focus();
    return true;
  });
  ipcMain.handle('app:quit', () => {
    app.quit();
    return true;
  });
  // 调试通道（仅 ISLAND_DEBUG）：向渲染层注入键盘事件，用于自动化验证
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

  // —— 任务通道（统一 {ok, data|error} 返回）——
  ipcMain.handle('tasks:list', () => wrap(() => tasks.listActive()));
  ipcMain.handle('tasks:detail', (_e: IpcMainInvokeEvent, id: string) => wrap(() => tasks.getTaskDetail(id)));
  ipcMain.handle('tasks:create', (_e: IpcMainInvokeEvent, input: TaskInput) => wrap(() => tasks.createTask(input)));
  ipcMain.handle('tasks:update', (_e: IpcMainInvokeEvent, id: string, input: TaskInput) => wrap(() => tasks.updateTask(id, input)));
  ipcMain.handle('tasks:complete', (_e: IpcMainInvokeEvent, id: string) => wrap(() => tasks.setArchived(id, 'completed')));
  ipcMain.handle('tasks:cancel', (_e: IpcMainInvokeEvent, id: string) => wrap(() => tasks.setArchived(id, 'cancelled')));

  // —— 节点 ——
  ipcMain.handle('nodes:add', (_e: IpcMainInvokeEvent, taskId: string, input: NodeInput) => wrap(() => tasks.addNode(taskId, input)));
  ipcMain.handle('nodes:update', (_e: IpcMainInvokeEvent, nodeId: string, input: NodeInput) => wrap(() => tasks.updateNode(nodeId, input)));
  ipcMain.handle('nodes:remove', (_e: IpcMainInvokeEvent, nodeId: string) => wrap(() => tasks.removeNode(nodeId)));
  ipcMain.handle('nodes:setStatus', (_e: IpcMainInvokeEvent, nodeId: string, status: NodeStatus) => wrap(() => tasks.setNodeStatus(nodeId, status)));
  ipcMain.handle('nodes:reorder', (_e: IpcMainInvokeEvent, taskId: string, orderedIds: string[]) => wrap(() => tasks.reorderNodes(taskId, orderedIds)));

  // —— 链接 ——
  ipcMain.handle('links:add', (_e: IpcMainInvokeEvent, taskId: string, input: LinkInput) => wrap(() => tasks.addLink(taskId, input)));
  ipcMain.handle('links:remove', (_e: IpcMainInvokeEvent, linkId: string) => wrap(() => tasks.removeLink(linkId)));

  // —— 备注 ——
  ipcMain.handle('notes:save', (_e: IpcMainInvokeEvent, taskId: string, body: string) => wrap(() => tasks.saveNote(taskId, body)));

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
