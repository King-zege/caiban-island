import { create } from 'zustand';

export type WorkspaceSection = 'tasks' | 'agent' | 'memory' | 'drafts' | 'archive' | 'settings';
export type TaskWorkspaceSection = 'overview' | 'nodes' | 'materials' | 'reminders' | 'notes';
export type L2View = 'agent' | 'overview';

export interface PendingUndoAction {
  id: string;
  kind: 'node' | 'link' | 'task';
  label: string;
  commit: () => Promise<string | null>;
}

export interface WorkspaceToast {
  id: string;
  tone: 'info' | 'success' | 'error';
  message: string;
}

interface WorkspaceState {
  section: WorkspaceSection;
  l2View: L2View;
  taskSection: TaskWorkspaceSection;
  selectedTaskId: string | null;
  highlightedNodeId: string | null;
  pendingUndo: PendingUndoAction | null;
  toast: WorkspaceToast | null;
  openSection: (section: WorkspaceSection) => void;
  setL2View: (view: L2View) => void;
  openTask: (taskId: string, section?: TaskWorkspaceSection) => void;
  clearTaskSelection: () => void;
  setTaskSection: (section: TaskWorkspaceSection) => void;
  highlightNode: (nodeId: string) => void;
  scheduleUndo: (action: PendingUndoAction) => boolean;
  undoPending: () => void;
  notify: (message: string, tone?: WorkspaceToast['tone']) => void;
  clearToast: () => void;
}

export const UNDO_DELAY_MS = 5000;
let undoTimer: ReturnType<typeof setTimeout> | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let highlightTimer: ReturnType<typeof setTimeout> | null = null;

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  section: 'tasks',
  l2View: 'agent',
  taskSection: 'overview',
  selectedTaskId: null,
  highlightedNodeId: null,
  pendingUndo: null,
  toast: null,

  openSection: (section) => set({ section }),
  setL2View: (l2View) => set({ l2View }),
  openTask: (taskId, section = 'overview') => set({ section: 'tasks', selectedTaskId: taskId, taskSection: section, highlightedNodeId: null }),
  clearTaskSelection: () => set({ selectedTaskId: null, taskSection: 'overview', highlightedNodeId: null }),
  setTaskSection: (taskSection) => set({ taskSection }),
  highlightNode: (nodeId) => {
    if (highlightTimer) clearTimeout(highlightTimer);
    set({ highlightedNodeId: nodeId });
    highlightTimer = setTimeout(() => {
      highlightTimer = null;
      if (get().highlightedNodeId === nodeId) set({ highlightedNodeId: null });
    }, 4500);
  },

  scheduleUndo: (action) => {
    if (get().pendingUndo) {
      get().notify('请先撤销或等待上一项删除完成', 'info');
      return false;
    }
    set({ pendingUndo: action });
    undoTimer = setTimeout(() => {
      undoTimer = null;
      const active = get().pendingUndo;
      if (!active || active.id !== action.id || active.kind !== action.kind) return;
      set({ pendingUndo: null });
      void active.commit().then((error) => {
        if (error) get().notify(error, 'error');
        else get().notify(active.label + '已删除', 'success');
      });
    }, UNDO_DELAY_MS);
    return true;
  },

  undoPending: () => {
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = null;
    const active = get().pendingUndo;
    set({ pendingUndo: null });
    if (active) get().notify('已撤销删除', 'success');
  },

  notify: (message, tone = 'info') => {
    if (toastTimer) clearTimeout(toastTimer);
    const toast = { id: crypto.randomUUID(), tone, message } satisfies WorkspaceToast;
    set({ toast });
    toastTimer = setTimeout(() => {
      toastTimer = null;
      if (get().toast?.id === toast.id) set({ toast: null });
    }, 4200);
  },

  clearToast: () => {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    set({ toast: null });
  }
}));
