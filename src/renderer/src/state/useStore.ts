import { create } from 'zustand';
import type { LinkInput, NodeInput, NodeStatus, TaskCard, TaskDetail, TaskInput } from '../../../shared/types';

interface TaskState {
  tasks: TaskCard[];
  loading: boolean;
  detail: TaskDetail | null;
  detailLoading: boolean;
  load: () => Promise<void>;
  create: (input: TaskInput) => Promise<string | null>;
  complete: (id: string) => Promise<string | null>;
  cancel: (id: string) => Promise<string | null>;
  openDetail: (id: string) => Promise<void>;
  closeDetail: () => void;
  addNode: (taskId: string, input: NodeInput) => Promise<string | null>;
  removeNode: (nodeId: string) => Promise<string | null>;
  setNodeStatus: (nodeId: string, status: NodeStatus) => Promise<string | null>;
  moveNode: (taskId: string, nodeId: string, dir: -1 | 1) => Promise<string | null>;
  addLink: (taskId: string, input: LinkInput) => Promise<string | null>;
  removeLink: (linkId: string) => Promise<string | null>;
  saveNote: (taskId: string, body: string) => Promise<string | null>;
  refreshDetail: (id: string) => Promise<void>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  loading: false,
  detail: null,
  detailLoading: false,

  load: async () => {
    set({ loading: true });
    const r = await window.api.listTasks();
    set({ tasks: r.ok ? r.data : [], loading: false });
  },

  create: async (input) => {
    const r = await window.api.createTask(input);
    if (r.ok) {
      await get().load();
      return null;
    }
    return r.error;
  },

  complete: async (id) => {
    const r = await window.api.completeTask(id);
    if (r.ok) {
      set({ detail: null });
      await get().load();
      return null;
    }
    return r.error;
  },

  cancel: async (id) => {
    const r = await window.api.cancelTask(id);
    if (r.ok) {
      set({ detail: null });
      await get().load();
      return null;
    }
    return r.error;
  },

  openDetail: async (id) => {
    set({ detailLoading: true });
    const r = await window.api.taskDetail(id);
    set({ detail: r.ok ? r.data : null, detailLoading: false });
  },

  closeDetail: () => set({ detail: null }),

  refreshDetail: async (id) => {
    const r = await window.api.taskDetail(id);
    if (r.ok) set({ detail: r.data });
    await get().load();
  },

  addNode: async (taskId, input) => {
    const r = await window.api.addNode(taskId, input);
    if (r.ok) {
      await get().refreshDetail(taskId);
      return null;
    }
    return r.error;
  },

  removeNode: async (nodeId) => {
    const d = get().detail;
    if (!d) return '详情未打开';
    const r = await window.api.removeNode(nodeId);
    if (r.ok) {
      await get().refreshDetail(d.task.id);
      return null;
    }
    return r.error;
  },

  setNodeStatus: async (nodeId, status) => {
    const d = get().detail;
    if (!d) return '详情未打开';
    const r = await window.api.setNodeStatus(nodeId, status);
    if (r.ok) {
      await get().refreshDetail(d.task.id);
      return null;
    }
    return r.error;
  },

  moveNode: async (taskId, nodeId, dir) => {
    const d = get().detail;
    if (!d) return '详情未打开';
    const ordered = d.nodes.map((n) => n.id);
    const idx = ordered.indexOf(nodeId);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= ordered.length) return null;
    [ordered[idx], ordered[target]] = [ordered[target], ordered[idx]];
    const r = await window.api.reorderNodes(taskId, ordered);
    if (r.ok) {
      await get().refreshDetail(taskId);
      return null;
    }
    return r.error;
  },

  addLink: async (taskId, input) => {
    const r = await window.api.addLink(taskId, input);
    if (r.ok) {
      await get().refreshDetail(taskId);
      return null;
    }
    return r.error;
  },

  removeLink: async (linkId) => {
    const d = get().detail;
    if (!d) return '详情未打开';
    const r = await window.api.removeLink(linkId);
    if (r.ok) {
      await get().refreshDetail(d.task.id);
      return null;
    }
    return r.error;
  },

  saveNote: async (taskId, body) => {
    const r = await window.api.saveNote(taskId, body);
    if (r.ok) {
      await get().refreshDetail(taskId);
      return null;
    }
    return r.error;
  }
}));
