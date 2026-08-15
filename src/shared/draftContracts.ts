import type { TaskInput } from './taskContracts';

export type DraftSource = 'mcp' | 'api';
export type DraftState = 'pending' | 'confirmed' | 'discarded';

export interface DraftNodeProposal {
  title: string;
  description: string;
  startUtc: string | null;
  endUtc: string | null;
}

export interface TaskDraftPayload {
  type: 'task';
  taskInput: TaskInput;
  nodes: DraftNodeProposal[];
  warnings: string[];
}

export interface NodesDraftPayload {
  type: 'nodes';
  taskId: string;
  nodes: DraftNodeProposal[];
  warnings: string[];
}

export type DraftPayload = TaskDraftPayload | NodesDraftPayload;

export interface DraftRecord {
  id: string;
  source: DraftSource;
  payload: DraftPayload;
  state: DraftState;
  createdAt: string;
}

export interface MCPConfig {
  url: string;
  token: string;
  stdioCommand: string;
}

export interface AiStatus {
  configured: boolean;
  baseUrl: string;
  model: string;
}
