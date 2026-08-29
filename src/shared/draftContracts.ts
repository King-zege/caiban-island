import type { TaskCreateRequest } from './taskContracts';
import type { AgentActionDraftPayload } from './agentContracts';

export type DraftSource = 'mcp' | 'api' | 'pi';
export type DraftState = 'pending' | 'confirmed' | 'discarded' | 'superseded';

export interface DraftNodeProposal {
  title: string;
  description: string;
  startUtc: string | null;
  endUtc: string | null;
}

export interface TaskDraftPayload {
  type: 'task';
  taskInput: TaskCreateRequest;
  nodes: DraftNodeProposal[];
  warnings: string[];
}

export interface NodesDraftPayload {
  type: 'nodes';
  taskId: string;
  nodes: DraftNodeProposal[];
  warnings: string[];
}

export type DraftPayload = TaskDraftPayload | NodesDraftPayload | AgentActionDraftPayload;

export interface DraftRecord {
  id: string;
  source: DraftSource;
  sessionId: string | null;
  payload: DraftPayload;
  state: DraftState;
  createdAt: string;
}
