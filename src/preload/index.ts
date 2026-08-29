import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type {
  DraftPayload,
  DraftRecord,
  AgentApprovalDecision,
  AgentPermissionMode,
  AgentPermissionSettings,
  AgentRunEvent,
  AgentRunRequest,
  AgentRunSnapshot,
  AgentAttentionEvent,
  AgentSessionDetail,
  AgentSessionSummary,
  DeepSeekModel,
  DeepSeekStatus,
  MemoryProposal,
  MemoryRecord,
  LocalCommandConfig,
  ArchivedItem,
  ArchivedDetail,
  IslandLevel,
  L2ContentMode,
  IslandState,
  IslandTransitionState,
  IpcResult,
  LinkInput,
  LegacyMiscDeadlineActionRequest,
  MiscReminderUpdateRequest,
  NodeInput,
  NodeStatus,
  NodeTimeUpdateRequest,
  NodeTitleUpdateRequest,
  ReminderEvent,
  Task,
  TaskCard,
  TaskDetail,
  TaskCreateRequest,
  TaskInput,
  TaskNameUpdateRequest,
  TaskNode,
  TaskUrgencyUpdateRequest,
  TransitionRequestResult,
  UiPreferences
} from '../shared/types';

const api = {
  getState: (): Promise<IslandState> => ipcRenderer.invoke('app:getState'),
  getUiPreferences: (): Promise<UiPreferences> => ipcRenderer.invoke('ui:getPreferences'),
  setLevel: (level: IslandLevel): Promise<TransitionRequestResult> => ipcRenderer.invoke('window:setLevel', level),
  interacting: (v: boolean): Promise<boolean> => ipcRenderer.invoke('ui:interacting', v),
  togglePause: (): Promise<boolean> => ipcRenderer.invoke('island:togglePause'),
  setL2Detail: (v: boolean): Promise<TransitionRequestResult> => ipcRenderer.invoke('window:setL2Detail', v),
  setL2ContentMode: (mode: L2ContentMode): Promise<TransitionRequestResult> => ipcRenderer.invoke('window:setL2ContentMode', mode),
  transitionReady: (id: string): Promise<boolean> => ipcRenderer.invoke('window:transitionReady', id),
  transitionFinished: (id: string): Promise<boolean> => ipcRenderer.invoke('window:transitionFinished', id),
  activate: (): Promise<boolean> => ipcRenderer.invoke('window:activate'),
  quit: (): Promise<boolean> => ipcRenderer.invoke('app:quit'),
  onState: (cb: (s: IslandState) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, s: IslandState) => cb(s);
    ipcRenderer.on('window:state', listener);
    return () => ipcRenderer.removeListener('window:state', listener);
  },
  onTransition: (cb: (transition: IslandTransitionState | null) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, transition: IslandTransitionState | null) => cb(transition);
    ipcRenderer.on('window:transition', listener);
    return () => ipcRenderer.removeListener('window:transition', listener);
  },
  onUiPreferences: (cb: (preferences: UiPreferences) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, preferences: UiPreferences) => cb(preferences);
    ipcRenderer.on('ui:preferences', listener);
    return () => ipcRenderer.removeListener('ui:preferences', listener);
  },
  debugSendKey: (text: string): Promise<boolean> => ipcRenderer.invoke('debug:sendKey', text),
  debugSendTab: (): Promise<boolean> => ipcRenderer.invoke('debug:sendTab'),

  listTasks: (): Promise<IpcResult<TaskCard[]>> => ipcRenderer.invoke('tasks:list'),
  taskDetail: (id: string): Promise<IpcResult<TaskDetail>> => ipcRenderer.invoke('tasks:detail', id),
  createTask: (input: TaskCreateRequest): Promise<IpcResult<Task>> => ipcRenderer.invoke('tasks:create', input),
  updateTask: (id: string, input: TaskInput): Promise<IpcResult<Task>> => ipcRenderer.invoke('tasks:update', id, input),
  setTaskName: (request: TaskNameUpdateRequest): Promise<IpcResult<Task>> => ipcRenderer.invoke('tasks:setName', request),
  setTaskUrgency: (request: TaskUrgencyUpdateRequest): Promise<IpcResult<Task>> => ipcRenderer.invoke('tasks:setUrgency', request),
  completeTask: (id: string): Promise<IpcResult<Task>> => ipcRenderer.invoke('tasks:complete', id),
  cancelTask: (id: string): Promise<IpcResult<Task>> => ipcRenderer.invoke('tasks:cancel', id),
  deleteTask: (id: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('tasks:delete', id),

  addNode: (taskId: string, input: NodeInput): Promise<IpcResult<unknown>> => ipcRenderer.invoke('nodes:add', taskId, input),
  updateNode: (nodeId: string, input: NodeInput): Promise<IpcResult<unknown>> => ipcRenderer.invoke('nodes:update', nodeId, input),
  setNodeTitle: (request: NodeTitleUpdateRequest): Promise<IpcResult<TaskNode>> => ipcRenderer.invoke('nodes:setTitle', request),
  setNodeStartTime: (request: NodeTimeUpdateRequest): Promise<IpcResult<unknown>> => ipcRenderer.invoke('nodes:setStartTime', request),
  removeNode: (nodeId: string): Promise<IpcResult<unknown>> => ipcRenderer.invoke('nodes:remove', nodeId),
  setNodeStatus: (nodeId: string, status: NodeStatus): Promise<IpcResult<unknown>> => ipcRenderer.invoke('nodes:setStatus', nodeId, status),
  reorderNodes: (taskId: string, orderedIds: string[]): Promise<IpcResult<unknown>> => ipcRenderer.invoke('nodes:reorder', taskId, orderedIds),

  addLink: (taskId: string, input: LinkInput): Promise<IpcResult<unknown>> => ipcRenderer.invoke('links:add', taskId, input),
  removeLink: (linkId: string): Promise<IpcResult<unknown>> => ipcRenderer.invoke('links:remove', linkId),
  saveNote: (taskId: string, body: string): Promise<IpcResult<unknown>> => ipcRenderer.invoke('notes:save', taskId, body),

  listReminders: (taskId: string): Promise<IpcResult<number[]>> => ipcRenderer.invoke('reminders:list', taskId),
  setReminders: (taskId: string, offsets: number[]): Promise<IpcResult<boolean>> => ipcRenderer.invoke('reminders:set', taskId, offsets),
  setMiscReminder: (request: MiscReminderUpdateRequest): Promise<IpcResult<Task>> => ipcRenderer.invoke('misc:setReminder', request),
  resolveLegacyMiscDeadline: (request: LegacyMiscDeadlineActionRequest): Promise<IpcResult<Task>> => ipcRenderer.invoke('misc:resolveLegacyDeadline', request),
  onReminderEvent: (cb: (event: ReminderEvent) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, value: ReminderEvent) => cb(value);
    ipcRenderer.on('reminder:event', listener);
    return () => ipcRenderer.removeListener('reminder:event', listener);
  },

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

  listDrafts: (sessionId?: string): Promise<IpcResult<DraftRecord[]>> => ipcRenderer.invoke('drafts:list', sessionId),
  getDraft: (id: string): Promise<IpcResult<DraftRecord>> => ipcRenderer.invoke('drafts:get', id),
  updateDraft: (id: string, payload: DraftPayload): Promise<IpcResult<DraftRecord>> => ipcRenderer.invoke('drafts:update', id, payload),
  discardDraft: (id: string): Promise<IpcResult<unknown>> => ipcRenderer.invoke('drafts:discard', id),
  confirmDraft: (id: string): Promise<IpcResult<{ type: 'task' | 'nodes' | 'action'; taskId: string }>> => ipcRenderer.invoke('drafts:confirm', id),

  agentStart: (request: AgentRunRequest): Promise<IpcResult<AgentSessionDetail>> => ipcRenderer.invoke('agent:start', request),
  agentSend: (request: AgentRunRequest): Promise<IpcResult<AgentSessionDetail>> => ipcRenderer.invoke('agent:send', request),
  agentCancel: (): Promise<IpcResult<boolean>> => ipcRenderer.invoke('agent:cancel'),
  getAgentRunSnapshot: (): Promise<IpcResult<AgentRunSnapshot>> => ipcRenderer.invoke('agent:getRunSnapshot'),
  setAgentSurfaceVisible: (visible: boolean): Promise<IpcResult<boolean>> => ipcRenderer.invoke('agent:setSurfaceVisible', visible),
  listAgentSessions: (): Promise<IpcResult<AgentSessionSummary[]>> => ipcRenderer.invoke('agent:listSessions'),
  getAgentSession: (id: string): Promise<IpcResult<AgentSessionDetail>> => ipcRenderer.invoke('agent:getSession', id),
  deleteAgentSession: (id: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('agent:deleteSession', id),
  clearAgentSessions: (): Promise<IpcResult<number>> => ipcRenderer.invoke('agent:clearSessions'),
  exportAgentSession: (id: string, format: 'json' | 'markdown'): Promise<IpcResult<string>> => ipcRenderer.invoke('agent:exportSession', id, format),
  getAgentPermissions: (): Promise<IpcResult<AgentPermissionSettings>> => ipcRenderer.invoke('agent:getPermissions'),
  setAgentPermissionMode: (mode: AgentPermissionMode, bypassWarningAccepted = false): Promise<IpcResult<AgentPermissionSettings>> => ipcRenderer.invoke('agent:setPermissionMode', mode, bypassWarningAccepted),
  chooseAgentAuthorizedDirectory: (): Promise<IpcResult<AgentPermissionSettings>> => ipcRenderer.invoke('agent:chooseAuthorizedDirectory'),
  removeAgentAuthorizedDirectory: (id: string): Promise<IpcResult<AgentPermissionSettings>> => ipcRenderer.invoke('agent:removeAuthorizedDirectory', id),
  resolveAgentApproval: (id: string, decision: AgentApprovalDecision): Promise<IpcResult<boolean>> => ipcRenderer.invoke('agent:resolveApproval', id, decision),
  getLocalCommandConfig: (): Promise<IpcResult<LocalCommandConfig>> => ipcRenderer.invoke('localCommands:getConfig'),
  onAgentEvent: (cb: (event: AgentRunEvent) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, value: AgentRunEvent) => cb(value);
    ipcRenderer.on('agent:event', listener);
    return () => ipcRenderer.removeListener('agent:event', listener);
  },
  onAgentAttention: (cb: (event: AgentAttentionEvent) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, value: AgentAttentionEvent) => cb(value);
    ipcRenderer.on('agent:attention', listener);
    return () => ipcRenderer.removeListener('agent:attention', listener);
  },
  getDeepSeekStatus: (): Promise<IpcResult<DeepSeekStatus>> => ipcRenderer.invoke('deepseek:status'),
  saveDeepSeekConfig: (model: DeepSeekModel, key: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('deepseek:saveConfig', model, key),
  testDeepSeek: (): Promise<IpcResult<string>> => ipcRenderer.invoke('deepseek:test'),
  listMemories: (): Promise<IpcResult<MemoryRecord[]>> => ipcRenderer.invoke('memory:list'),
  listMemoryProposals: (): Promise<IpcResult<MemoryProposal[]>> => ipcRenderer.invoke('memory:listProposals'),
  confirmMemoryProposal: (id: string, editedFact?: string): Promise<IpcResult<MemoryRecord | null>> =>
    ipcRenderer.invoke('memory:confirmProposal', id, editedFact),
  discardMemoryProposal: (id: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('memory:discardProposal', id),
  updateMemory: (id: string, fact: string): Promise<IpcResult<MemoryRecord>> => ipcRenderer.invoke('memory:update', id, fact),
  deleteMemory: (id: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('memory:delete', id),
  clearMemories: (): Promise<IpcResult<number>> => ipcRenderer.invoke('memory:clear')
};

contextBridge.exposeInMainWorld('api', api);

export type IslandApi = typeof api;
