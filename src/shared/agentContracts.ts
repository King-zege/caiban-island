export const DEEPSEEK_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const;
export type DeepSeekModel = (typeof DEEPSEEK_MODELS)[number];

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
  model: DeepSeekModel;
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

export interface DeepSeekStatus {
  configured: boolean;
  baseUrl: 'https://api.deepseek.com';
  model: DeepSeekModel;
}

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
