import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type {
  AgentProposal,
  AgentProposalApprovalResult,
  AgentProposalCreateRequest,
  AgentApprovalDecision,
  AgentPermissionMode,
  AgentPermissionSettings,
  AgentRunEvent,
  AgentRunRequest,
  AgentRunSnapshot,
  AgentAttentionEvent,
  AgentSessionDetail,
  AgentSessionSummary,
  AgentProviderConfigInput,
  AgentProviderStatus,
  PengModelDiscoveryResult,
  DeepSeekModel,
  DeepSeekStatus,
  FeishuBotConfigInput,
  FeishuBotStatus,
  FeishuDiagnosticExportResult,
  FeishuPairingCode,
  MemoryProposal,
  MemoryRecord,
  LocalCommandConfig,
  ArchivedItem,
  ArchivedDetail,
  IslandLevel,
  L2TrackDescriptor,
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
  TaskNamesUpdateRequest,
  TaskNode,
  TaskUrgencyUpdateRequest,
  TransitionRequestResult,
  UiPreferences
} from '../shared/types';
import type { KnowledgeMatch, KnowledgeScanSummary, KnowledgeSourceExcerpt, KnowledgeWorkspaceStatus, WorkspaceTreeEntry } from '../shared/knowledgeContracts';
import type { AgentAutomation, AutomationCreateRequest, AutomationEnabledRequest, AutomationRun, AutomationUpdateRequest } from '../shared/automationContracts';
import type { ProcurementPlanApplyRequest, ProcurementProjectCreateRequest, ProcurementProjectCreateResult, ProcurementWorkflowTemplate } from '../shared/procurementContracts';
import type { Contract, ContractAction, ContractActionInput, ContractActionReminder, ContractActionReminderRequest, ContractActionStatusRequest, ContractActionUpdateRequest, ContractCard, ContractCreateRequest, ContractDetail, ContractLink, ContractLinkInput, ContractStatusRequest, ContractUpdateRequest } from '../shared/contractContracts';

const api = {
  getState: (): Promise<IslandState> => ipcRenderer.invoke('app:getState'),
  getUiPreferences: (): Promise<UiPreferences> => ipcRenderer.invoke('ui:getPreferences'),
  setLevel: (level: IslandLevel): Promise<TransitionRequestResult> => ipcRenderer.invoke('window:setLevel', level),
  interacting: (v: boolean): Promise<boolean> => ipcRenderer.invoke('ui:interacting', v),
  togglePause: (): Promise<boolean> => ipcRenderer.invoke('island:togglePause'),
  setL2Detail: (v: boolean): Promise<TransitionRequestResult> => ipcRenderer.invoke('window:setL2Detail', v),
  setL2ContentMode: (tracks: L2TrackDescriptor): Promise<TransitionRequestResult> => ipcRenderer.invoke('window:setL2ContentMode', tracks),
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
  setTaskNames: (request: TaskNamesUpdateRequest): Promise<IpcResult<Task>> => ipcRenderer.invoke('tasks:setNames', request),
  setTaskUrgency: (request: TaskUrgencyUpdateRequest): Promise<IpcResult<Task>> => ipcRenderer.invoke('tasks:setUrgency', request),
  completeTask: (id: string): Promise<IpcResult<Task>> => ipcRenderer.invoke('tasks:complete', id),
  cancelTask: (id: string): Promise<IpcResult<Task>> => ipcRenderer.invoke('tasks:cancel', id),
  deleteTask: (id: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('tasks:delete', id),
  listProcurementTemplates: (): Promise<IpcResult<readonly ProcurementWorkflowTemplate[]>> => ipcRenderer.invoke('procurements:templates'),
  createProcurementProject: (input: ProcurementProjectCreateRequest): Promise<IpcResult<ProcurementProjectCreateResult>> => ipcRenderer.invoke('procurements:create', input),
  applyProcurementPlan: (input: ProcurementPlanApplyRequest): Promise<IpcResult<TaskDetail>> => ipcRenderer.invoke('procurements:applyPlan', input),
  listContracts: (): Promise<IpcResult<ContractCard[]>> => ipcRenderer.invoke('contracts:list'),
  contractDetail: (id: string): Promise<IpcResult<ContractDetail>> => ipcRenderer.invoke('contracts:detail', id),
  createContract: (input: ContractCreateRequest): Promise<IpcResult<Contract>> => ipcRenderer.invoke('contracts:create', input),
  updateContract: (input: ContractUpdateRequest): Promise<IpcResult<Contract>> => ipcRenderer.invoke('contracts:update', input),
  setContractStatus: (input: ContractStatusRequest): Promise<IpcResult<Contract>> => ipcRenderer.invoke('contracts:setStatus', input),
  restoreContract: (id: string): Promise<IpcResult<Contract>> => ipcRenderer.invoke('contracts:restore', id),
  addContractAction: (contractId: string, input: ContractActionInput): Promise<IpcResult<ContractAction>> => ipcRenderer.invoke('contractActions:add', contractId, input),
  updateContractAction: (input: ContractActionUpdateRequest): Promise<IpcResult<ContractAction>> => ipcRenderer.invoke('contractActions:update', input),
  setContractActionStatus: (input: ContractActionStatusRequest): Promise<IpcResult<ContractAction>> => ipcRenderer.invoke('contractActions:setStatus', input),
  removeContractAction: (id: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('contractActions:remove', id),
  setContractActionReminder: (input: ContractActionReminderRequest): Promise<IpcResult<ContractActionReminder | null>> => ipcRenderer.invoke('contractActions:setReminder', input),
  addContractLink: (contractId: string, input: ContractLinkInput): Promise<IpcResult<ContractLink>> => ipcRenderer.invoke('contractLinks:add', contractId, input),
  removeContractLink: (id: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('contractLinks:remove', id),
  saveContractNote: (contractId: string, body: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('contractNotes:save', contractId, body),

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
  getFeishuAgentStatus: (): Promise<IpcResult<FeishuBotStatus>> => ipcRenderer.invoke('feishuAgent:status'),
  saveFeishuAgentConfig: (input: FeishuBotConfigInput): Promise<IpcResult<FeishuBotStatus>> => ipcRenderer.invoke('feishuAgent:saveConfig', input),
  testFeishuAgent: (): Promise<IpcResult<string>> => ipcRenderer.invoke('feishuAgent:test'),
  generateFeishuPairingCode: (): Promise<IpcResult<FeishuPairingCode>> => ipcRenderer.invoke('feishuAgent:generatePairingCode'),
  revokeFeishuPairedUser: (openId: string): Promise<IpcResult<FeishuBotStatus>> => ipcRenderer.invoke('feishuAgent:revokeUser', openId),
  reconnectFeishuAgent: (): Promise<IpcResult<FeishuBotStatus>> => ipcRenderer.invoke('feishuAgent:reconnect'),
  setFeishuAgentDiagnosticsEnabled: (enabled: boolean): Promise<IpcResult<FeishuBotStatus>> => ipcRenderer.invoke('feishuAgent:setDiagnosticsEnabled', enabled),
  exportFeishuAgentDiagnostics: (): Promise<IpcResult<FeishuDiagnosticExportResult>> => ipcRenderer.invoke('feishuAgent:exportDiagnostics'),
  onFeishuAgentChanged: (cb: (status: FeishuBotStatus) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, value: FeishuBotStatus) => cb(value);
    ipcRenderer.on('feishuAgent:changed', listener);
    return () => ipcRenderer.removeListener('feishuAgent:changed', listener);
  },
  exportCsv: (): Promise<IpcResult<string>> => ipcRenderer.invoke('feishu:exportCsv'),
  exportTaskCsv: (taskId: string): Promise<IpcResult<string>> => ipcRenderer.invoke('feishu:exportTaskCsv', taskId),
  exportArchivedCsv: (): Promise<IpcResult<string>> => ipcRenderer.invoke('feishu:exportArchivedCsv'),
  exportMarkdown: (): Promise<IpcResult<string>> => ipcRenderer.invoke('feishu:exportMarkdown'),

  openUrl: (url: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('system:openUrl', url),
  openPath: (p: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('system:openPath', p),
  showInFolder: (p: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('system:showInFolder', p),

  listAgentProposals: (sessionId?: string): Promise<IpcResult<AgentProposal[]>> => ipcRenderer.invoke('proposals:list', sessionId),
  createAgentProposal: (request: AgentProposalCreateRequest): Promise<IpcResult<AgentProposal>> => ipcRenderer.invoke('proposals:create', request),
  discardAgentProposal: (id: string): Promise<IpcResult<AgentProposal>> => ipcRenderer.invoke('proposals:discard', id),
  approveAgentProposal: (id: string): Promise<IpcResult<AgentProposalApprovalResult>> => ipcRenderer.invoke('proposals:approve', id),

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
  getKnowledgeStatus: (): Promise<IpcResult<KnowledgeWorkspaceStatus>> => ipcRenderer.invoke('knowledge:status'),
  choosePrimaryWorkspaceDirectory: (): Promise<IpcResult<KnowledgeWorkspaceStatus>> => ipcRenderer.invoke('knowledge:choosePrimary'),
  getWorkspaceTree: (): Promise<IpcResult<WorkspaceTreeEntry[]>> => ipcRenderer.invoke('knowledge:tree'),
  searchWorkspace: (query: string, limit?: number): Promise<IpcResult<KnowledgeMatch[]>> => ipcRenderer.invoke('knowledge:search', query, limit),
  getKnowledgeSourceExcerpt: (sourceId: string, locator?: string): Promise<IpcResult<KnowledgeSourceExcerpt>> => ipcRenderer.invoke('knowledge:sourceExcerpt', sourceId, locator),
  refreshWorkspaceIndex: (): Promise<IpcResult<KnowledgeScanSummary>> => ipcRenderer.invoke('knowledge:refresh'),
  cancelWorkspaceScan: (): Promise<IpcResult<boolean>> => ipcRenderer.invoke('knowledge:cancelScan'),
  listAutomations: (): Promise<IpcResult<{ enabled: boolean; automations: AgentAutomation[]; runs: AutomationRun[] }>> => ipcRenderer.invoke('automations:list'),
  createAutomation: (input: AutomationCreateRequest): Promise<IpcResult<AgentAutomation>> => ipcRenderer.invoke('automations:create', input),
  updateAutomation: (input: AutomationUpdateRequest): Promise<IpcResult<AgentAutomation>> => ipcRenderer.invoke('automations:update', input),
  setAutomationEnabled: (input: AutomationEnabledRequest): Promise<IpcResult<AgentAutomation>> => ipcRenderer.invoke('automations:setEnabled', input),
  deleteAutomation: (id: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke('automations:delete', id),
  setAutomationsGlobalEnabled: (enabled: boolean): Promise<IpcResult<boolean>> => ipcRenderer.invoke('automations:setGlobalEnabled', enabled),
  approveAutomationRun: (id: string): Promise<IpcResult<AutomationRun>> => ipcRenderer.invoke('automations:approveRun', id),
  onAutomationEvent: (cb: (run: AutomationRun) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, value: AutomationRun) => cb(value);
    ipcRenderer.on('automation:event', listener);
    return () => ipcRenderer.removeListener('automation:event', listener);
  },
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
  getAgentProviderStatus: (): Promise<IpcResult<AgentProviderStatus>> => ipcRenderer.invoke('agentProvider:status'),
  saveAgentProviderConfig: (input: AgentProviderConfigInput): Promise<IpcResult<boolean>> => ipcRenderer.invoke('agentProvider:saveConfig', input),
  discoverPengModels: (apiKey: string): Promise<IpcResult<PengModelDiscoveryResult>> => ipcRenderer.invoke('agentProvider:discoverPengModels', apiKey),
  testAgentProvider: (): Promise<IpcResult<string>> => ipcRenderer.invoke('agentProvider:test'),
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
