import { create } from 'zustand';
import type {
  AgentAttentionEvent,
  AgentRunEvent,
  AgentRunState,
  AgentSessionDetail,
  AgentSessionSummary,
  DraftRecord,
  MemoryProposal
} from '../../../shared/types';
import { useTaskStore } from './useStore';

const RUNNING_STATES: AgentRunState[] = ['running', 'cancelling'];

interface AgentStoreState {
  sessions: AgentSessionSummary[];
  detail: AgentSessionDetail | null;
  runState: AgentRunState;
  runningSessionId: string | null;
  streaming: string;
  activeToolName: string | null;
  error: string | null;
  drafts: DraftRecord[];
  memoryProposals: MemoryProposal[];
  attention: AgentAttentionEvent | null;
  bootstrapped: boolean;
  bootstrap: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  openSession: (id: string) => Promise<void>;
  newConversation: () => void;
  send: (content: string) => Promise<string | null>;
  cancel: () => Promise<void>;
  handleEvent: (event: AgentRunEvent) => void;
  handleAttention: (event: AgentAttentionEvent) => Promise<void>;
  refreshProposals: (sessionId?: string | null) => Promise<void>;
  confirmDraft: (id: string) => Promise<{ type: 'task' | 'nodes' | 'action'; taskId: string } | string>;
  discardDraft: (id: string) => Promise<string | null>;
  confirmMemoryProposal: (id: string) => Promise<string | null>;
  discardMemoryProposal: (id: string) => Promise<string | null>;
  deleteCurrentSession: () => Promise<string | null>;
  clearSessions: () => Promise<number | string>;
}

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  sessions: [],
  detail: null,
  runState: 'idle',
  runningSessionId: null,
  streaming: '',
  activeToolName: null,
  error: null,
  drafts: [],
  memoryProposals: [],
  attention: null,
  bootstrapped: false,

  bootstrap: async () => {
    if (get().bootstrapped) return;
    set({ bootstrapped: true });
    if (typeof window.api.listAgentSessions !== 'function') return;
    const runSnapshot = typeof window.api.getAgentRunSnapshot === 'function'
      ? window.api.getAgentRunSnapshot()
      : Promise.resolve({ ok: true as const, data: { sessionId: null, state: 'idle' as const, startedAt: null } });
    const [sessionsResult, runResult] = await Promise.all([
      window.api.listAgentSessions(),
      runSnapshot
    ]);
    if (!sessionsResult.ok) {
      set({ error: sessionsResult.error });
      return;
    }
    set({
      sessions: sessionsResult.data,
      runState: runResult.ok ? runResult.data.state : 'idle',
      runningSessionId: runResult.ok ? runResult.data.sessionId : null
    });
    const targetId = runResult.ok && runResult.data.sessionId
      ? runResult.data.sessionId
      : sessionsResult.data[0]?.id;
    if (targetId) await get().openSession(targetId);
  },

  refreshSessions: async () => {
    const result = await window.api.listAgentSessions();
    if (!result.ok) { set({ error: result.error }); return; }
    set({ sessions: result.data });
  },

  openSession: async (id) => {
    const result = await window.api.getAgentSession(id);
    if (!result.ok) { set({ error: result.error }); return; }
    set({ detail: result.data, streaming: '', activeToolName: null, error: null, attention: null });
    await get().refreshProposals(id);
  },

  newConversation: () => {
    if (RUNNING_STATES.includes(get().runState)) return;
    set({ detail: null, streaming: '', activeToolName: null, error: null, drafts: [], memoryProposals: [], attention: null, runState: 'idle' });
  },

  send: async (rawContent) => {
    const content = rawContent.trim();
    if (!content) return '请输入要处理的内容';
    if (RUNNING_STATES.includes(get().runState)) return '已有 Agent 任务正在运行';
    const current = get().detail;
    set({ error: null, streaming: '', activeToolName: null, runState: 'running', runningSessionId: current?.session.id ?? null });
    const result = current
      ? await window.api.agentSend({ sessionId: current.session.id, input: content })
      : await window.api.agentStart({ input: content });
    if (!result.ok) {
      set({ runState: 'error', runningSessionId: null, error: result.error });
      return result.error;
    }
    set({ detail: result.data, runningSessionId: result.data.session.id });
    await get().refreshSessions();
    return null;
  },

  cancel: async () => {
    const result = await window.api.agentCancel();
    if (!result.ok) set({ error: result.error });
  },

  handleEvent: (event) => {
    if (event.type === 'state') {
      const running = RUNNING_STATES.includes(event.state);
      set({ runState: event.state, runningSessionId: running ? event.sessionId : null });
      if (!running) {
        set({ streaming: '', activeToolName: null });
        void get().refreshSessions();
        if (get().detail?.session.id === event.sessionId) {
          void get().openSession(event.sessionId);
        }
      }
      return;
    }
    if (event.type === 'text_delta') {
      if (get().detail?.session.id === event.sessionId) set((state) => ({ streaming: state.streaming + event.delta }));
      return;
    }
    if (event.type === 'tool_start') {
      if (get().detail?.session.id === event.sessionId) set({ activeToolName: event.toolName });
      return;
    }
    if (event.type === 'message') {
      set((state) => state.detail?.session.id === event.sessionId
        ? {
            detail: {
              ...state.detail,
              messages: state.detail.messages.some((message) => message.id === event.message.id)
                ? state.detail.messages
                : [...state.detail.messages, event.message]
            },
            streaming: event.message.role === 'assistant' ? '' : state.streaming
          }
        : {});
      return;
    }
    if (event.type === 'tool_end') {
      if (get().detail?.session.id === event.sessionId) set({ activeToolName: null });
      if (!event.isError && (event.draftId || event.memoryProposalId)) {
        set({ attention: { sessionId: event.sessionId, draftId: event.draftId, memoryProposalId: event.memoryProposalId } });
        if (get().detail?.session.id === event.sessionId) void get().refreshProposals(event.sessionId);
      }
      return;
    }
    if (event.type === 'error') set({ error: event.message, activeToolName: null });
  },

  handleAttention: async (event) => {
    if (get().detail?.session.id !== event.sessionId) await get().openSession(event.sessionId);
    set({ attention: event });
    await get().refreshProposals(event.sessionId);
  },

  refreshProposals: async (sessionId = get().detail?.session.id) => {
    if (!sessionId) { set({ drafts: [], memoryProposals: [] }); return; }
    const [draftResult, memoryResult] = await Promise.all([
      window.api.listDrafts(sessionId),
      window.api.listMemoryProposals()
    ]);
    if (!draftResult.ok) set({ error: draftResult.error });
    if (!memoryResult.ok) set({ error: memoryResult.error });
    set({
      drafts: draftResult.ok ? draftResult.data : get().drafts,
      memoryProposals: memoryResult.ok
        ? memoryResult.data.filter((proposal) => proposal.sourceSessionId === sessionId && proposal.state === 'pending')
        : get().memoryProposals
    });
  },

  confirmDraft: async (id) => {
    const result = await window.api.confirmDraft(id);
    if (!result.ok) { set({ error: result.error }); return result.error; }
    await Promise.all([get().refreshProposals(), useTaskStore.getState().load()]);
    return result.data;
  },

  discardDraft: async (id) => {
    const result = await window.api.discardDraft(id);
    if (!result.ok) { set({ error: result.error }); return result.error; }
    await get().refreshProposals();
    return null;
  },

  confirmMemoryProposal: async (id) => {
    const result = await window.api.confirmMemoryProposal(id);
    if (!result.ok) { set({ error: result.error }); return result.error; }
    await get().refreshProposals();
    return null;
  },

  discardMemoryProposal: async (id) => {
    const result = await window.api.discardMemoryProposal(id);
    if (!result.ok) { set({ error: result.error }); return result.error; }
    await get().refreshProposals();
    return null;
  },

  deleteCurrentSession: async () => {
    const current = get().detail;
    if (!current) return null;
    const result = await window.api.deleteAgentSession(current.session.id);
    if (!result.ok) { set({ error: result.error }); return result.error; }
    set({ detail: null, drafts: [], memoryProposals: [], attention: null });
    await get().refreshSessions();
    const first = get().sessions[0];
    if (first) await get().openSession(first.id);
    return null;
  },

  clearSessions: async () => {
    const result = await window.api.clearAgentSessions();
    if (!result.ok) { set({ error: result.error }); return result.error; }
    set({ sessions: [], detail: null, drafts: [], memoryProposals: [], attention: null });
    return result.data;
  }
}));

export function isAgentRunning(state: AgentRunState): boolean {
  return RUNNING_STATES.includes(state);
}
