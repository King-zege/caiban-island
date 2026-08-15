import { app, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { IslandWindowController } from './windowController';
import type { TaskService } from './taskService';
import type { IslandLevel, TaskInput } from '../shared/types';

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
  ipcMain.handle('window:setL2Detail', (_e: IpcMainInvokeEvent, v: boolean) => {
    c.setL2Detail(v);
    return true;
  });
  ipcMain.handle('window:activate', () => {
    // 仅当窗口未聚焦时才激活；已聚焦时调用 focus() 会重置 DOM 焦点
    if (!c.win.isFocused()) c.win.focus();
    return true;
  });
  // 调试通道（仅 ISLAND_DEBUG）：向渲染层注入键盘事件，用于隔离输入问题
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
  ipcMain.handle('island:togglePause', () => c.togglePause());
  ipcMain.handle('app:quit', () => {
    app.quit();
    return true;
  });

  // —— P2 任务通道（统一 {ok, data|error} 返回）——
  ipcMain.handle('tasks:list', () => wrap(() => tasks.listActive()));
  ipcMain.handle('tasks:create', (_e: IpcMainInvokeEvent, input: TaskInput) =>
    wrap(() => tasks.createTask(input))
  );
  ipcMain.handle('tasks:update', (_e: IpcMainInvokeEvent, id: string, input: TaskInput) =>
    wrap(() => tasks.updateTask(id, input))
  );
  ipcMain.handle('tasks:complete', (_e: IpcMainInvokeEvent, id: string) =>
    wrap(() => tasks.setArchived(id, 'completed'))
  );
  ipcMain.handle('tasks:cancel', (_e: IpcMainInvokeEvent, id: string) =>
    wrap(() => tasks.setArchived(id, 'cancelled'))
  );
}

function wrap<T>(fn: () => T): { ok: true; data: T } | { ok: false; error: string } {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
