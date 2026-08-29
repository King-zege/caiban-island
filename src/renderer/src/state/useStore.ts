import { create } from 'zustand';
import type { LegacyMiscDeadlineActionRequest, LinkInput, MiscReminderUpdateRequest, NodeInput, NodeStatus, NodeTimeUpdateRequest, NodeTitleUpdateRequest, TaskCard, TaskCreateRequest, TaskDetail, TaskLink, TaskNameUpdateRequest, TaskNamesUpdateRequest, TaskUrgencyUpdateRequest } from '../../../shared/types';

interface TaskState {
  tasks: TaskCard[];
  loading: boolean;
  loaded: boolean;
  loadError: string | null;
  detail: TaskDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  detailCache: Record<string, TaskDetail>;
  onboarded: boolean | null;
  ensureLoaded: () => Promise<void>;
  ensureOnboarded: () => Promise<void>;
  setOnboarded: (value: boolean) => void;
  load: () => Promise<void>;
  create: (input: TaskCreateRequest) => Promise<string | null>;
  complete: (id: string) => Promise<string | null>;
  cancel: (id: string) => Promise<string | null>;
  deleteTask: (id: string) => Promise<string | null>;
  setTaskName: (request: TaskNameUpdateRequest) => Promise<string | null>;
  setTaskNames: (request: TaskNamesUpdateRequest) => Promise<string | null>;
  setTaskUrgency: (request: TaskUrgencyUpdateRequest) => Promise<string | null>;
  setMiscReminder: (request: MiscReminderUpdateRequest) => Promise<string | null>;
  resolveLegacyMiscDeadline: (request: LegacyMiscDeadlineActionRequest) => Promise<string | null>;
  openDetail: (id: string) => Promise<void>;
  prefetchDetail: (id: string) => Promise<void>;
  loadTaskLinks: (id: string) => Promise<{ links: TaskLink[]; error: string | null }>;
  closeDetail: () => void;
  addNode: (taskId: string, input: NodeInput) => Promise<string | null>;
  updateNode: (taskId: string, nodeId: string, input: NodeInput) => Promise<string | null>;
  setNodeTitle: (taskId: string, request: NodeTitleUpdateRequest) => Promise<string | null>;
  setNodeStartTime: (taskId: string, request: NodeTimeUpdateRequest) => Promise<string | null>;
  removeNode: (nodeId: string) => Promise<string | null>;
  setNodeStatus: (taskId: string, nodeId: string, status: NodeStatus) => Promise<string | null>;
  moveNode: (taskId: string, nodeId: string, dir: -1 | 1) => Promise<string | null>;
  addLink: (taskId: string, input: LinkInput) => Promise<string | null>;
  removeLink: (linkId: string) => Promise<string | null>;
  saveNote: (taskId: string, body: string) => Promise<string | null>;
  refreshDetail: (id: string) => Promise<void>;
}

let listRequest: Promise<void> | null = null;
const detailRequests = new Map<string, Promise<void>>();

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  loading: false,
  loaded: false,
  loadError: null,
  detail: null,
  detailLoading: false,
  detailError: null,
  detailCache: {},
  onboarded: null,

  ensureLoaded: async () => {
    if (get().loaded) return;
    if (listRequest) return listRequest;
    listRequest = get().load().finally(() => { listRequest = null; });
    return listRequest;
  },

  ensureOnboarded: async () => {
    if (get().onboarded !== null) return;
    const result = await window.api.getSettings();
    set({ onboarded: result.ok ? (result.data as { onboarded?: boolean }).onboarded === true : true });
  },

  setOnboarded: (onboarded) => set({ onboarded }),

  load: async () => {
    set({ loading: true, loadError: null });
    const r = await window.api.listTasks();
    if (r.ok) set({ tasks: r.data, loading: false, loaded: true, loadError: null });
    else set({ loading: false, loaded: true, loadError: r.error });
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
      set((state) => {
        const detailCache = { ...state.detailCache };
        delete detailCache[id];
        return { detail: null, detailCache };
      });
      await get().load();
      return null;
    }
    return r.error;
  },

  cancel: async (id) => {
    const r = await window.api.cancelTask(id);
    if (r.ok) {
      set((state) => {
        const detailCache = { ...state.detailCache };
        delete detailCache[id];
        return { detail: null, detailCache };
      });
      await get().load();
      return null;
    }
    return r.error;
  },

  deleteTask: async (id) => {
    const r = await window.api.deleteTask(id);
    if (r.ok) {
      set((state) => {
        const detailCache = { ...state.detailCache };
        delete detailCache[id];
        return { detail: state.detail?.task.id === id ? null : state.detail, detailCache };
      });
      await get().load();
      return null;
    }
    return r.error;
  },

  setTaskName: async (request) => {
    const r = await window.api.setTaskName(request);
    if (!r.ok) return r.error;
    set((state) => {
      const tasks = state.tasks.map((card) => card.task.id === request.taskId
        ? { ...card, task: r.data }
        : card);
      const detail = state.detail?.task.id === request.taskId
        ? { ...state.detail, task: r.data }
        : state.detail;
      const detailCache = { ...state.detailCache };
      if (detailCache[request.taskId]) detailCache[request.taskId] = { ...detailCache[request.taskId], task: r.data };
      return { tasks, detail, detailCache };
    });
    await get().load();
    return null;
  },

  setTaskNames: async (request) => {
    const r = await window.api.setTaskNames(request);
    if (!r.ok) return r.error;
    set((state) => {
      const tasks = state.tasks.map((card) => card.task.id === request.taskId ? { ...card, task: r.data } : card);
      const detail = state.detail?.task.id === request.taskId ? { ...state.detail, task: r.data } : state.detail;
      const detailCache = { ...state.detailCache };
      if (detailCache[request.taskId]) detailCache[request.taskId] = { ...detailCache[request.taskId], task: r.data };
      return { tasks, detail, detailCache };
    });
    await get().load();
    return null;
  },

  setTaskUrgency: async (request) => {
    const r = await window.api.setTaskUrgency(request);
    if (!r.ok) return r.error;
    set((state) => {
      const tasks = state.tasks.map((card) => card.task.id === request.taskId
        ? { ...card, task: r.data }
        : card);
      const detail = state.detail?.task.id === request.taskId
        ? { ...state.detail, task: r.data }
        : state.detail;
      const detailCache = { ...state.detailCache };
      if (detailCache[request.taskId]) {
        detailCache[request.taskId] = { ...detailCache[request.taskId], task: r.data };
      }
      return { tasks, detail, detailCache };
    });
    await get().load();
    return null;
  },

  setMiscReminder: async (request) => {
    const r = await window.api.setMiscReminder(request);
    if (!r.ok) return r.error;
    await get().refreshDetail(request.taskId);
    return null;
  },

  resolveLegacyMiscDeadline: async (request) => {
    const r = await window.api.resolveLegacyMiscDeadline(request);
    if (!r.ok) return r.error;
    await get().refreshDetail(request.taskId);
    return null;
  },

  openDetail: async (id) => {
    const cached = get().detailCache[id];
    if (cached) {
      set({ detail: cached, detailLoading: false, detailError: null });
      return;
    }
    set({ detailLoading: true, detailError: null });
    await get().prefetchDetail(id);
    const detail = get().detailCache[id] ?? null;
    set({ detail, detailLoading: false, detailError: detail ? null : get().detailError });
  },

  prefetchDetail: async (id) => {
    if (get().detailCache[id]) return;
    const active = detailRequests.get(id);
    if (active) return active;
    const request = window.api.taskDetail(id).then((result) => {
      if (result.ok) {
        set((state) => ({ detailCache: { ...state.detailCache, [id]: result.data }, detailError: null }));
      } else {
        set({ detailError: result.error });
      }
    }).finally(() => { detailRequests.delete(id); });
    detailRequests.set(id, request);
    return request;
  },

  loadTaskLinks: async (id) => {
    await get().prefetchDetail(id);
    const cached = get().detailCache[id];
    return cached
      ? { links: cached.links, error: null }
      : { links: [], error: get().detailError ?? '暂时无法读取任务资料' };
  },

  closeDetail: () => set({ detail: null, detailError: null }),

  refreshDetail: async (id) => {
    const r = await window.api.taskDetail(id);
    if (r.ok) set((state) => ({ detail: r.data, detailCache: { ...state.detailCache, [id]: r.data }, detailError: null }));
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

  updateNode: async (taskId, nodeId, input) => {
    const r = await window.api.updateNode(nodeId, input);
    if (r.ok) {
      await get().refreshDetail(taskId);
      return null;
    }
    return r.error;
  },

  setNodeTitle: async (taskId, request) => {
    const r = await window.api.setNodeTitle(request);
    if (!r.ok) return r.error;
    set((state) => {
      const patchNodes = <T extends { id: string }>(nodes: T[]) => nodes.map((node) => node.id === request.nodeId
        ? { ...node, title: r.data.title }
        : node);
      const tasks = state.tasks.map((card) => card.task.id === taskId
        ? {
            ...card,
            nodes: patchNodes(card.nodes),
            progress: card.progress.nextTitle === request.expectedTitle
              ? { ...card.progress, nextTitle: r.data.title }
              : card.progress
          }
        : card);
      const detail = state.detail?.task.id === taskId
        ? { ...state.detail, nodes: patchNodes(state.detail.nodes) }
        : state.detail;
      const detailCache = { ...state.detailCache };
      if (detailCache[taskId]) detailCache[taskId] = { ...detailCache[taskId], nodes: patchNodes(detailCache[taskId].nodes) };
      return { tasks, detail, detailCache };
    });
    await get().load();
    return null;
  },

  setNodeStartTime: async (taskId, request) => {
    const r = await window.api.setNodeStartTime(request);
    if (!r.ok) return r.error;
    if (get().detail?.task.id === taskId) await get().refreshDetail(taskId);
    else {
      set((state) => {
        const detailCache = { ...state.detailCache };
        delete detailCache[taskId];
        return { detailCache };
      });
      await get().load();
    }
    return null;
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

  setNodeStatus: async (taskId, nodeId, status) => {
    const r = await window.api.setNodeStatus(nodeId, status);
    if (r.ok) {
      if (get().detail?.task.id === taskId) await get().refreshDetail(taskId);
      else {
        set((state) => {
          const detailCache = { ...state.detailCache };
          delete detailCache[taskId];
          return { detailCache };
        });
        await get().load();
      }
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
