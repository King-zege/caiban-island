import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type {
  IslandLevel,
  IslandState,
  IpcResult,
  LinkInput,
  NodeInput,
  NodeStatus,
  Task,
  TaskCard,
  TaskDetail,
  TaskInput
} from '../shared/types';

const api = {
  getState: (): Promise<IslandState> => ipcRenderer.invoke('app:getState'),
  setLevel: (level: IslandLevel): Promise<boolean> => ipcRenderer.invoke('window:setLevel', level),
  interacting: (v: boolean): Promise<boolean> => ipcRenderer.invoke('ui:interacting', v),
  togglePause: (): Promise<boolean> => ipcRenderer.invoke('island:togglePause'),
  setL2Detail: (v: boolean): Promise<boolean> => ipcRenderer.invoke('window:setL2Detail', v),
  activate: (): Promise<boolean> => ipcRenderer.invoke('window:activate'),
  quit: (): Promise<boolean> => ipcRenderer.invoke('app:quit'),
  onState: (cb: (s: IslandState) => void): void => {
    ipcRenderer.on('window:state', (_e: IpcRendererEvent, s: IslandState) => cb(s));
  },
  debugSendKey: (text: string): Promise<boolean> => ipcRenderer.invoke('debug:sendKey', text),
  debugSendTab: (): Promise<boolean> => ipcRenderer.invoke('debug:sendTab'),

  listTasks: (): Promise<IpcResult<TaskCard[]>> => ipcRenderer.invoke('tasks:list'),
  taskDetail: (id: string): Promise<IpcResult<TaskDetail>> => ipcRenderer.invoke('tasks:detail', id),
  createTask: (input: TaskInput): Promise<IpcResult<Task>> => ipcRenderer.invoke('tasks:create', input),
  updateTask: (id: string, input: TaskInput): Promise<IpcResult<Task>> => ipcRenderer.invoke('tasks:update', id, input),
  completeTask: (id: string): Promise<IpcResult<Task>> => ipcRenderer.invoke('tasks:complete', id),
  cancelTask: (id: string): Promise<IpcResult<Task>> => ipcRenderer.invoke('tasks:cancel', id),

  addNode: (taskId: string, input: NodeInput): Promise<IpcResult<unknown>> => ipcRenderer.invoke('nodes:add', taskId, input),
  updateNode: (nodeId: string, input: NodeInput): Promise<IpcResult<unknown>> => ipcRenderer.invoke('nodes:update', nodeId, input),
  removeNode: (nodeId: string): Promise<IpcResult<unknown>> => ipcRenderer.invoke('nodes:remove', nodeId),
  setNodeStatus: (nodeId: string, status: NodeStatus): Promise<IpcResult<unknown>> => ipcRenderer.invoke('nodes:setStatus', nodeId, status),
  reorderNodes: (taskId: string, orderedIds: string[]): Promise<IpcResult<unknown>> => ipcRenderer.invoke('nodes:reorder', taskId, orderedIds),

  addLink: (taskId: string, input: LinkInput): Promise<IpcResult<unknown>> => ipcRenderer.invoke('links:add', taskId, input),
  removeLink: (linkId: string): Promise<IpcResult<unknown>> => ipcRenderer.invoke('links:remove', linkId),
  saveNote: (taskId: string, body: string): Promise<IpcResult<unknown>> => ipcRenderer.invoke('notes:save', taskId, body),

  openUrl: (url: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('system:openUrl', url),
  openPath: (p: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('system:openPath', p),
  showInFolder: (p: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('system:showInFolder', p)
};

contextBridge.exposeInMainWorld('api', api);

export type IslandApi = typeof api;
