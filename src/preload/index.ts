import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type {
  DraftPayload,
  DraftRecord,
  MCPConfig,
  AiStatus,
  ArchivedItem,
  ArchivedDetail,
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

  listReminders: (taskId: string): Promise<IpcResult<number[]>> => ipcRenderer.invoke('reminders:list', taskId),
  setReminders: (taskId: string, offsets: number[]): Promise<IpcResult<boolean>> => ipcRenderer.invoke('reminders:set', taskId, offsets),

  listArchive: (): Promise<IpcResult<ArchivedItem[]>> => ipcRenderer.invoke('archive:list'),
  searchArchive: (q: string, outcome?: string): Promise<IpcResult<ArchivedItem[]>> => ipcRenderer.invoke('archive:search', q, outcome),
  getArchived: (id: string): Promise<IpcResult<ArchivedDetail>> => ipcRenderer.invoke('archive:get', id),
  restoreTask: (id: string): Promise<IpcResult<Task>> => ipcRenderer.invoke('archive:restore', id),

  getSettings: (): Promise<IpcResult<Record<string, unknown>>> => ipcRenderer.invoke('settings:getAll'),
  setSetting: (key: string, value: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('settings:set', key, value),
  openDataDir: (): Promise<IpcResult<boolean>> => ipcRenderer.invoke('app:openDataDir'),

  getFeishuStatus: (): Promise<IpcResult<{ configured: boolean; autoSync: boolean; target: { appToken: string; tableId: string } | null }>> =>
    ipcRenderer.invoke('feishu:status'),
  saveFeishuToken: (token: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('feishu:saveToken', token),
  testFeishu: (): Promise<IpcResult<string>> => ipcRenderer.invoke('feishu:test'),
  syncFeishu: (): Promise<IpcResult<{ created: number; updated: number }>> => ipcRenderer.invoke('feishu:sync'),
  setFeishuAutoSync: (v: boolean): Promise<IpcResult<boolean>> => ipcRenderer.invoke('feishu:setAutoSync', v),
  exportCsv: (): Promise<IpcResult<string>> => ipcRenderer.invoke('feishu:exportCsv'),
  exportTaskCsv: (taskId: string): Promise<IpcResult<string>> => ipcRenderer.invoke('feishu:exportTaskCsv', taskId),
  exportArchivedCsv: (): Promise<IpcResult<string>> => ipcRenderer.invoke('feishu:exportArchivedCsv'),
  exportMarkdown: (): Promise<IpcResult<string>> => ipcRenderer.invoke('feishu:exportMarkdown'),

  openUrl: (url: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('system:openUrl', url),
  openPath: (p: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('system:openPath', p),
  showInFolder: (p: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('system:showInFolder', p),

  listDrafts: (): Promise<IpcResult<DraftRecord[]>> => ipcRenderer.invoke('drafts:list'),
  updateDraft: (id: string, payload: DraftPayload): Promise<IpcResult<DraftRecord>> => ipcRenderer.invoke('drafts:update', id, payload),
  discardDraft: (id: string): Promise<IpcResult<unknown>> => ipcRenderer.invoke('drafts:discard', id),
  confirmDraft: (id: string): Promise<IpcResult<unknown>> => ipcRenderer.invoke('drafts:confirm', id),

  getMcpConfig: (): Promise<IpcResult<MCPConfig>> => ipcRenderer.invoke('mcp:getConfig'),
  resetMcpToken: (): Promise<IpcResult<MCPConfig>> => ipcRenderer.invoke('mcp:resetToken'),

  getAiStatus: (): Promise<IpcResult<AiStatus>> => ipcRenderer.invoke('ai:status'),
  saveAiConfig: (baseUrl: string, model: string, key: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('ai:saveConfig', baseUrl, model, key),
  testAi: (): Promise<IpcResult<string>> => ipcRenderer.invoke('ai:test'),
  aiBreakdown: (description: string): Promise<IpcResult<DraftRecord>> => ipcRenderer.invoke('ai:breakdown', description)
};

contextBridge.exposeInMainWorld('api', api);

export type IslandApi = typeof api;
