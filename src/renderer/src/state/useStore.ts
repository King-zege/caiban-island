import { create } from 'zustand';
import type { TaskCard, TaskInput } from '../../../shared/types';

interface TaskState {
  tasks: TaskCard[];
  loading: boolean;
  load: () => Promise<void>;
  create: (input: TaskInput) => Promise<string | null>;
  complete: (id: string) => Promise<string | null>;
  cancel: (id: string) => Promise<string | null>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  loading: false,
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
      await get().load();
      return null;
    }
    return r.error;
  },
  cancel: async (id) => {
    const r = await window.api.cancelTask(id);
    if (r.ok) {
      await get().load();
      return null;
    }
    return r.error;
  }
}));
