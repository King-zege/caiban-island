import { create } from 'zustand';
import type {
  AgentApprovalDecision,
  AgentApprovalRequest,
  AgentAttentionEvent,
  AgentPermissionMode,
  AgentPermissionSettings,
  AgentRunEvent,
  AgentRunPhase,
  AgentRunSnapshot,
  AgentRunState,
  AgentSessionDetail,
  AgentSessionSummary,
  AgentProposal,
  MemoryProposal
} from '../../../shared/types';
import { useTaskStore } from './useStore';

const RUNNING_STATES: AgentRunState[] = ['running', 'cancelling'];
const EMPTY_PERMISSIONS: AgentPermissionSettings = { mode: 'confirm_all', bypassWarningAccepted: false, authorizedDirectories: [] };

interface AgentStoreState {
  sessions: AgentSessionSummary[];
  detail: AgentSessionDetail | null;
  runState: AgentRunState;
  runPhase: AgentRunPhase;
  runningSessionId: string | null;
  streaming: string;
  activeToolName: string | null;
  error: string | null;
  errorCategory: string | null;
  lastSequence: number;
  lastActivityAt: string | null;
  pendingApproval: AgentApprovalRequest | null;
  permissions: AgentPermissionSettings;
  proposals: AgentProposal[];
  memoryProposals: MemoryProposal[];
  attention: AgentAttentionEvent | null;
  bootstrapped: boolean;
  bootstrap: () => Promise<void>;
  syncRunSnapshot: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
  setPermissionMode: (mode: AgentPermissionMode, bypassWarningAccepted?: boolean) => Promise<string | null>;
  chooseAuthorizedDirectory: () => Promise<string | null>;
  removeAuthorizedDirectory: (id: string) => Promise<string | null>;
  resolveApproval: (id: string, decision: AgentApprovalDecision) => Promise<string | null>;
  openSession: (id: string) => Promise<void>;
  newConversation: () => void;
  send: (content: string) => Promise<string | null>;
  cancel: () => Promise<void>;
  handleEvent: (event: AgentRunEvent) => void;
  handleAttention: (event: AgentAttentionEvent) => Promise<void>;
  refreshProposals: (sessionId?: string | null) => Promise<void>;
  approveProposal: (id: string) => Promise<string | null>;
  discardProposal: (id: string) => Promise<string | null>;
  confirmMemoryProposal: (id: string) => Promise<string | null>;
  discardMemoryProposal: (id: string) => Promise<string | null>;
  deleteCurrentSession: () => Promise<string | null>;
  clearSessions: () => Promise<number | string>;
}

function snapshotState(snapshot: AgentRunSnapshot): Partial<AgentStoreState> {
  return {
    runState: snapshot.state,
    runPhase: snapshot.phase,
    runningSessionId: RUNNING_STATES.includes(snapshot.state) ? snapshot.sessionId : null,
    streaming: snapshot.partialText,
    activeToolName: snapshot.activeTool?.toolName ?? null,
    error: snapshot.error?.message ?? null,
    errorCategory: snapshot.error?.category ?? null,
    lastSequence: snapshot.sequence,
    lastActivityAt: snapshot.lastActivityAt,
    pendingApproval: snapshot.pendingApproval
  };
}

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  sessions: [], detail: null, runState: 'idle', runPhase: 'idle', runningSessionId: null,
  streaming: '', activeToolName: null, error: null, errorCategory: null, lastSequence: 0,
  lastActivityAt: null, pendingApproval: null, permissions: EMPTY_PERMISSIONS,
  proposals: [], memoryProposals: [], attention: null, bootstrapped: false,

  bootstrap: async () => {
    if (get().bootstrapped) return;
    set({ bootstrapped: true });
    if (typeof window.api.listAgentSessions !== 'function') return;
    const [sessionsResult] = await Promise.all([
      window.api.listAgentSessions(), get().syncRunSnapshot(), get().refreshPermissions()
    ]);
    if (!sessionsResult.ok) { set({ error: sessionsResult.error }); return; }
    set({ sessions: sessionsResult.data });
    const targetId = get().runningSessionId ?? sessionsResult.data[0]?.id;
    if (targetId) await get().openSession(targetId);
    await get().syncRunSnapshot();
  },

  syncRunSnapshot: async () => {
    if (typeof window.api.getAgentRunSnapshot !== 'function') return;
    const result = await window.api.getAgentRunSnapshot();
    if (!result.ok) { set({ error: result.error }); return; }
    if (result.data.sequence < get().lastSequence) return;
    set(snapshotState(result.data));
  },

  refreshSessions: async () => {
    const result = await window.api.listAgentSessions();
    if (!result.ok) { set({ error: result.error }); return; }
    set({ sessions: result.data });
  },

  refreshPermissions: async () => {
    if (typeof window.api.getAgentPermissions !== 'function') return;
    const result = await window.api.getAgentPermissions();
    if (!result.ok) { set({ error: result.error }); return; }
    set({ permissions: result.data });
  },

  setPermissionMode: async (mode, bypassWarningAccepted = false) => {
    const result = await window.api.setAgentPermissionMode(mode, bypassWarningAccepted);
    if (!result.ok) { set({ error: result.error }); return result.error; }
    set({ permissions: result.data, error: null });
    return null;
  },

  chooseAuthorizedDirectory: async () => {
    const result = await window.api.chooseAgentAuthorizedDirectory();
    if (!result.ok) { set({ error: result.error }); return result.error; }
    set({ permissions: result.data, error: null });
    return null;
  },

  removeAuthorizedDirectory: async (id) => {
    const result = await window.api.removeAgentAuthorizedDirectory(id);
    if (!result.ok) { set({ error: result.error }); return result.error; }
    set({ permissions: result.data, error: null });
    return null;
  },

  resolveApproval: async (id, decision) => {
    const result = await window.api.resolveAgentApproval(id, decision);
    if (!result.ok) { set({ error: result.error }); return result.error; }
    if (!result.data) return '该确认已处理或已过期';
    return null;
  },

  openSession: async (id) => {
    const result = await window.api.getAgentSession(id);
    if (!result.ok) { set({ error: result.error }); return; }
    set({ detail: result.data, error: null, attention: null });
    await Promise.all([get().refreshProposals(id), get().syncRunSnapshot()]);
  },

  newConversation: () => {
    if (RUNNING_STATES.includes(get().runState)) return;
    set({ detail: null, streaming: '', activeToolName: null, error: null, errorCategory: null, proposals: [], memoryProposals: [], attention: null, runState: 'idle', runPhase: 'idle' });
  },

  send: async (rawContent) => {
    const content = rawContent.trim();
    if (!content) return '请输入要处理的内容';
    if (RUNNING_STATES.includes(get().runState)) return '已有 Agent 任务正在运行';
    const current = get().detail;
    set({ error: null, errorCategory: null, streaming: '', activeToolName: null, runState: 'running', runPhase: 'connecting', runningSessionId: current?.session.id ?? null });
    const result = current
      ? await window.api.agentSend({ sessionId: current.session.id, input: content })
      : await window.api.agentStart({ input: content });
    if (!result.ok) { set({ runState: 'error', runPhase: 'error', runningSessionId: null, error: result.error }); return result.error; }
    set({ detail: result.data, runningSessionId: result.data.session.id });
    await Promise.all([get().refreshSessions(), get().syncRunSnapshot()]);
    return null;
  },

  cancel: async () => {
    const result = await window.api.agentCancel();
    if (!result.ok) set({ error: result.error });
    await get().syncRunSnapshot();
  },

  handleEvent: (event) => {
    if (event.sequence <= get().lastSequence) return;
    if (get().lastSequence > 0 && event.sequence > get().lastSequence + 1) void get().syncRunSnapshot();
    set({ lastSequence: event.sequence, lastActivityAt: event.at });
    if (event.type === 'state') {
      const running = RUNNING_STATES.includes(event.state);
      set({ runState: event.state, runPhase: event.phase, runningSessionId: running ? event.sessionId : null });
      if (!running) {
        set({ activeToolName: null, pendingApproval: null });
        void Promise.all([get().refreshSessions(), get().syncRunSnapshot(), useTaskStore.getState().load()]);
        if (get().detail?.session.id === event.sessionId) void get().openSession(event.sessionId);
      }
      return;
    }
    if (event.type === 'text_delta') {
      set({ runPhase: 'streaming' });
      if (get().detail?.session.id === event.sessionId) set((state) => ({ streaming: state.streaming + event.delta }));
      return;
    }
    if (event.type === 'tool_start') {
      set({ runPhase: 'tool' });
      if (get().detail?.session.id === event.sessionId) set({ activeToolName: event.toolName });
      return;
    }
    if (event.type === 'approval_required') { set({ pendingApproval: event.request, runPhase: 'awaiting_approval' }); return; }
    if (event.type === 'approval_resolved') { set({ pendingApproval: null, runPhase: event.decision === 'approve' ? 'applying' : 'tool' }); return; }
    if (event.type === 'message') {
      set((state) => state.detail?.session.id === event.sessionId ? {
        detail: { ...state.detail, messages: state.detail.messages.some((message) => message.id === event.message.id) ? state.detail.messages : [...state.detail.messages, event.message] },
        streaming: event.message.role === 'assistant' ? '' : state.streaming
      } : {});
      return;
    }
    if (event.type === 'tool_end') {
      set({ activeToolName: null, runPhase: event.isError ? 'tool' : 'applying' });
      if (!event.isError && (event.proposalId || event.memoryProposalId)) {
        set({ attention: { sessionId: event.sessionId, proposalId: event.proposalId, memoryProposalId: event.memoryProposalId } });
        if (get().detail?.session.id === event.sessionId) void get().refreshProposals(event.sessionId);
      }
      return;
    }
    if (event.type === 'error') set({ error: event.message, errorCategory: event.category, activeToolName: null, runPhase: 'error' });
  },

  handleAttention: async (event) => {
    if (get().detail?.session.id !== event.sessionId) await get().openSession(event.sessionId);
    set({ attention: event });
    await Promise.all([get().refreshProposals(event.sessionId), get().syncRunSnapshot()]);
  },

  refreshProposals: async (sessionId = get().detail?.session.id) => {
    const [proposalResult, memoryResult] = await Promise.all([window.api.listAgentProposals(sessionId ?? undefined), window.api.listMemoryProposals()]);
    if (!proposalResult.ok) set({ error: proposalResult.error });
    if (!memoryResult.ok) set({ error: memoryResult.error });
    set({
      proposals: proposalResult.ok ? proposalResult.data.filter((proposal) => proposal.sessionId === null || proposal.sessionId === sessionId) : get().proposals,
      memoryProposals: memoryResult.ok && sessionId ? memoryResult.data.filter((proposal) => proposal.sourceSessionId === sessionId && proposal.state === 'pending') : []
    });
  },

  approveProposal: async (id) => {
    const result = await window.api.approveAgentProposal(id);
    if (!result.ok) { set({ error: result.error }); return result.error; }
    await Promise.all([get().refreshProposals(), useTaskStore.getState().load()]);
    return null;
  },
  discardProposal: async (id) => {
    const result = await window.api.discardAgentProposal(id);
    if (!result.ok) { set({ error: result.error }); return result.error; }
    await get().refreshProposals(); return null;
  },
  confirmMemoryProposal: async (id) => {
    const result = await window.api.confirmMemoryProposal(id);
    if (!result.ok) { set({ error: result.error }); return result.error; }
    await get().refreshProposals(); return null;
  },
  discardMemoryProposal: async (id) => {
    const result = await window.api.discardMemoryProposal(id);
    if (!result.ok) { set({ error: result.error }); return result.error; }
    await get().refreshProposals(); return null;
  },
  deleteCurrentSession: async () => {
    const current = get().detail;
    if (!current) return null;
    const result = await window.api.deleteAgentSession(current.session.id);
    if (!result.ok) { set({ error: result.error }); return result.error; }
    set({ detail: null, proposals: [], memoryProposals: [], attention: null });
    await get().refreshSessions();
    const first = get().sessions[0];
    if (first) await get().openSession(first.id);
    return null;
  },
  clearSessions: async () => {
    const result = await window.api.clearAgentSessions();
    if (!result.ok) { set({ error: result.error }); return result.error; }
    set({ sessions: [], detail: null, proposals: [], memoryProposals: [], attention: null });
    return result.data;
  }
}));

export function isAgentRunning(state: AgentRunState): boolean { return RUNNING_STATES.includes(state); }
