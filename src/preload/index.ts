import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { IslandLevel, IslandState, IpcResult, Task, TaskCard, TaskInput } from '../shared/types';

const api = {
  getState: (): Promise<IslandState> => ipcRenderer.invoke('app:getState'),
  setLevel: (level: IslandLevel): Promise<boolean> => ipcRenderer.invoke('window:setLevel', level),
  interacting: (v: boolean): Promise<boolean> => ipcRenderer.invoke('ui:interacting', v),
  setL2Detail: (v: boolean): Promise<boolean> => ipcRenderer.invoke('window:setL2Detail', v),
  activate: (): Promise<boolean> => ipcRenderer.invoke('window:activate'),
  debugSendKey: (text: string): Promise<boolean> => ipcRenderer.invoke('debug:sendKey', text),
  debugSendTab: (): Promise<boolean> => ipcRenderer.invoke('debug:sendTab'),
  togglePause: (): Promise<boolean> => ipcRenderer.invoke('island:togglePause'),
  quit: (): Promise<boolean> => ipcRenderer.invoke('app:quit'),
  onState: (cb: (s: IslandState) => void): void => {
    ipcRenderer.on('window:state', (_e: IpcRendererEvent, s: IslandState) => cb(s));
  },

  listTasks: (): Promise<IpcResult<TaskCard[]>> => ipcRenderer.invoke('tasks:list'),
  createTask: (input: TaskInput): Promise<IpcResult<Task>> => ipcRenderer.invoke('tasks:create', input),
  updateTask: (id: string, input: TaskInput): Promise<IpcResult<Task>> => ipcRenderer.invoke('tasks:update', id, input),
  completeTask: (id: string): Promise<IpcResult<Task>> => ipcRenderer.invoke('tasks:complete', id),
  cancelTask: (id: string): Promise<IpcResult<Task>> => ipcRenderer.invoke('tasks:cancel', id)
};

contextBridge.exposeInMainWorld('api', api);

export type IslandApi = typeof api;
