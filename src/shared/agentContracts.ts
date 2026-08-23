import type { NodeInput, NodeStatus, TaskNode } from './taskContracts';

export const DEEPSEEK_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const;
export type DeepSeekModel = (typeof DEEPSEEK_MODELS)[number];

export interface AgentRunRequest {
  sessionId?: string;
  input: string;
}

export type AgentRunState = 'idle' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'error' | 'limit_reached';

export type AgentRunEvent =
  | { type: 'state'; sessionId: string; state: AgentRunState }
  | { type: 'text_delta'; sessionId: string; delta: string }
  | { type: 'tool_start'; sessionId: string; toolCallId: string; toolName: string }
  | { type: 'tool_end'; sessionId: string; toolCallId: string; toolName: string; isError: boolean; draftId?: string; memoryProposalId?: string }
  | { type: 'message'; sessionId: string; message: AgentMessageDto }
  | { type: 'error'; sessionId: string; message: string; retryable: boolean };

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

export type AgentTaskAction =
  | { kind: 'set_node_status'; nodeId: string; before: NodeStatus; after: NodeStatus }
  | { kind: 'set_reminders'; before: number[]; after: number[] }
  | { kind: 'add_node'; beforeNodeIds: string[]; input: NodeInput }
  | { kind: 'update_node'; nodeId: string; before: NodeInput; after: NodeInput }
  | { kind: 'delete_node'; before: TaskNode }
  | { kind: 'reorder_nodes'; before: string[]; after: string[] };

export interface AgentActionDraftPayload {
  type: 'action';
  taskId: string;
  sessionId: string;
  action: AgentTaskAction;
  summary: string;
  warnings: string[];
}

export interface AgentActionRequest {
  taskId: string;
  sessionId: string;
  kind: AgentTaskAction['kind'];
  nodeId?: string;
  status?: NodeStatus;
  offsets?: number[];
  node?: NodeInput;
  orderedNodeIds?: string[];
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
