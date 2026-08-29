import type { AgentAttentionEvent, AgentRunEvent } from '../shared/agentContracts';

export interface AgentCompletionNotice {
  attention: AgentAttentionEvent;
  body: 'Agent 待确认操作已生成，点击查看' | 'Agent 已完成回复，点击查看' | 'Agent 处理需要查看，点击返回会话';
}

export class AgentNotificationTracker {
  private readonly attention = new Map<string, AgentAttentionEvent>();
  private readonly notifiedRuns = new Set<string>();

  handle(event: AgentRunEvent, surfaceVisible: boolean): AgentCompletionNotice | null {
    if (event.type === 'state' && event.state === 'running') {
      this.attention.delete(event.sessionId);
      this.notifiedRuns.delete(event.sessionId);
      return null;
    }
    if (event.type === 'tool_end' && !event.isError && (event.draftId || event.memoryProposalId)) {
      this.attention.set(event.sessionId, {
        sessionId: event.sessionId,
        draftId: event.draftId,
        memoryProposalId: event.memoryProposalId
      });
      return null;
    }
    if (event.type !== 'state' || !['completed', 'error', 'limit_reached'].includes(event.state)) return null;
    if (this.notifiedRuns.has(event.sessionId)) return null;
    this.notifiedRuns.add(event.sessionId);
    if (surfaceVisible) return null;
    const attention = this.attention.get(event.sessionId) ?? { sessionId: event.sessionId };
    return {
      attention,
      body: event.state === 'completed'
        ? attention.draftId || attention.memoryProposalId
          ? 'Agent 待确认操作已生成，点击查看'
          : 'Agent 已完成回复，点击查看'
        : 'Agent 处理需要查看，点击返回会话'
    };
  }
}
