export const DEEPSEEK_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const;
export type DeepSeekModel = (typeof DEEPSEEK_MODELS)[number];
export const GLM_MODELS = ['glm-5.2', 'glm-5.1', 'glm-5-turbo', 'glm-4.7', 'glm-4.7-flash', 'glm-4.7-flashx'] as const;
export type GlmModel = (typeof GLM_MODELS)[number];
export const PENG_PROVIDER_IDS = ['peng_deepseek', 'peng_openai', 'peng_anthropic'] as const;
export type PengProviderId = (typeof PENG_PROVIDER_IDS)[number];
export const AGENT_PROVIDER_IDS = ['deepseek', 'glm', ...PENG_PROVIDER_IDS] as const;
export type AgentProviderId = (typeof AGENT_PROVIDER_IDS)[number];
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com' as const;
export const GLM_BASE_URLS = ['https://open.bigmodel.cn/api/paas/v4', 'https://open.bigmodel.cn/api/coding/paas/v4'] as const;
export const PENG_ROOT_URL = 'https://api.peng-us.com' as const;
export const PENG_OPENAI_BASE_URL = `${PENG_ROOT_URL}/v1` as const;
export const PENG_MODELS_URL = `${PENG_OPENAI_BASE_URL}/models` as const;
export type AgentProviderProtocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages';

export interface AgentProviderConfigInput {
  provider: AgentProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface AgentProviderStatus {
  provider: AgentProviderId;
  protocol: AgentProviderProtocol;
  configured: boolean;
  configuredProviders: AgentProviderId[];
  baseUrl: string;
  model: string;
  profiles: Record<AgentProviderId, { configured: boolean; baseUrl: string; model: string; protocol: AgentProviderProtocol }>;
  pengKeyConfigured: boolean;
  pengMigrationRequired: boolean;
}

export interface PengModelDiscoveryInput {
  apiKey: string;
}

export interface PengModelDiscoveryResult {
  models: string[];
  fetchedAt: string;
}

export interface AgentProviderRuntimeConfig {
  provider: AgentProviderId;
  protocol: AgentProviderProtocol;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface AgentRunRequest {
  sessionId?: string;
  input: string;
}

export type AgentRunState = 'idle' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'error' | 'limit_reached';

export type AgentPermissionMode = 'confirm_all' | 'auto_reversible' | 'bypass';
export type AgentRunPhase = 'idle' | 'connecting' | 'streaming' | 'tool' | 'awaiting_approval' | 'applying' | 'completed' | 'cancelled' | 'error';
export type AgentToolRisk = 'read' | 'reversible' | 'high';
export type AgentApprovalDecision = 'approve' | 'deny' | 'cancel';

export interface AgentApprovalChange {
  label: string;
  before: string;
  after: string;
}

export interface AgentApprovalRequest {
  id: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  summary: string;
  risk: AgentToolRisk;
  changes: AgentApprovalChange[];
  createdAt: string;
}

export interface AuthorizedDirectory {
  id: string;
  label: string;
  path: string;
  createdAt: string;
  isPrimaryWorkspace?: boolean;
}

export interface AgentPermissionSettings {
  mode: AgentPermissionMode;
  bypassWarningAccepted: boolean;
  authorizedDirectories: AuthorizedDirectory[];
}

export interface LocalCommandConfig {
  url: string;
  token: string;
  cliCommand: string;
}

export interface AgentRunSnapshot {
  sessionId: string | null;
  state: AgentRunState;
  startedAt: string | null;
  sequence: number;
  phase: AgentRunPhase;
  lastActivityAt: string | null;
  partialText: string;
  partialThinking: string;
  activeTool: { toolCallId: string; toolName: string } | null;
  pendingApproval: AgentApprovalRequest | null;
  error: { message: string; retryable: boolean; category: string } | null;
  latestMemoryProposalId?: string;
}

export interface AgentAttentionEvent {
  sessionId: string;
  proposalId?: string;
  memoryProposalId?: string;
}

type SequencedAgentEvent = { sequence: number; at: string };

export type AgentRunEvent = SequencedAgentEvent & (
  | { type: 'state'; sessionId: string; state: AgentRunState; phase: AgentRunPhase }
  | { type: 'text_delta'; sessionId: string; delta: string }
  | { type: 'thinking_delta'; sessionId: string; delta: string }
  | { type: 'tool_start'; sessionId: string; toolCallId: string; toolName: string }
  | { type: 'tool_end'; sessionId: string; toolCallId: string; toolName: string; isError: boolean; proposalId?: string; memoryProposalId?: string }
  | { type: 'approval_required'; sessionId: string; request: AgentApprovalRequest }
  | { type: 'approval_resolved'; sessionId: string; approvalId: string; decision: AgentApprovalDecision }
  | { type: 'message'; sessionId: string; message: AgentMessageDto }
  | { type: 'error'; sessionId: string; message: string; retryable: boolean; category: string }
);

export interface AgentSessionSummary {
  id: string;
  title: string;
  model: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  inputTokens: number;
  outputTokens: number;
}

export type AgentMessageRole = 'user' | 'assistant' | 'tool';

export interface AgentMessageDto {
  id: string;
  sessionId: string;
  role: AgentMessageRole;
  content: string;
  toolName: string | null;
  createdAt: string;
}

export interface AgentSessionDetail {
  session: AgentSessionSummary;
  messages: AgentMessageDto[];
}

/** @deprecated Use AgentProviderStatus. Kept for one renderer/API compatibility cycle. */
export type DeepSeekStatus = AgentProviderStatus;

export type MemoryCategory = 'profile' | 'work';
export type MemoryOperation = 'add' | 'replace' | 'remove';
export type MemoryProposalState = 'pending' | 'confirmed' | 'discarded';

export interface MemoryRecord {
  id: string;
  category: MemoryCategory;
  fact: string;
  sourceSessionId: string;
  sourceMessageId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryProposal {
  id: string;
  operation: MemoryOperation;
  category: MemoryCategory;
  fact: string;
  evidenceMessageId: string;
  sourceSessionId: string;
  targetMemoryId: string | null;
  state: MemoryProposalState;
  capacityWarning: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryProposalRequest {
  operation: MemoryOperation;
  category: MemoryCategory;
  fact: string;
  evidenceMessageId: string;
  targetMemoryId?: string;
}

export interface MemoryCapacity {
  category: MemoryCategory;
  used: number;
  limit: number;
  ratio: number;
  needsReview: boolean;
}

export interface SessionSearchMatch {
  sessionId: string;
  title: string;
  summary: string;
  firstExcerpt: string;
  lastExcerpt: string;
  matchExcerpt: string;
  context: Array<{ role: 'user' | 'assistant'; content: string }>;
}
