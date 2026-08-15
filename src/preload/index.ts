import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { IslandLevel, IslandState } from '../shared/types';

const api = {
  getState: (): Promise<IslandState> => ipcRenderer.invoke('app:getState'),
  setLevel: (level: IslandLevel): Promise<boolean> => ipcRenderer.invoke('window:setLevel', level),
  interacting: (v: boolean): Promise<boolean> => ipcRenderer.invoke('ui:interacting', v),
  togglePause: (): Promise<boolean> => ipcRenderer.invoke('island:togglePause'),
  quit: (): Promise<boolean> => ipcRenderer.invoke('app:quit'),
  onState: (cb: (s: IslandState) => void): void => {
    ipcRenderer.on('window:state', (_e: IpcRendererEvent, s: IslandState) => cb(s));
  }
};

contextBridge.exposeInMainWorld('api', api);

export type IslandApi = typeof api;
