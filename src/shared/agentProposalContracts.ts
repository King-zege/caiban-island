import type { AppCommand, AppCommandResult } from './appCommandContracts';

export type AgentProposalState = 'pending' | 'approved' | 'discarded';
export type AgentProposalKind = 'command_batch' | 'legacy_draft';

export interface AgentProposalPayload {
  commands: AppCommand[];
  warnings: string[];
}

export interface AgentProposal {
  id: string;
  sessionId: string | null;
  kind: AgentProposalKind;
  title: string;
  summary: string;
  payload: AgentProposalPayload;
  state: AgentProposalState;
  createdAt: string;
  updatedAt: string;
}

export interface AgentProposalCreateRequest {
  sessionId?: string;
  title: string;
  summary?: string;
  commands: AppCommand[];
  warnings?: string[];
}

export interface AgentProposalApprovalResult {
  proposal: AgentProposal;
  results: AppCommandResult[];
}
