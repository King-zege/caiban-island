export interface AgentContextSnapshot {
  id: string;
  content: string;
}

export interface AgentContextProvider {
  snapshot(sessionId: string): AgentContextSnapshot;
}
