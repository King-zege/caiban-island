import { app, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { IslandWindowController } from './windowController';
import type { IslandLevel } from '../shared/types';

export function registerIpc(c: IslandWindowController): void {
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
  ipcMain.handle('app:quit', () => {
    app.quit();
    return true;
  });
}
