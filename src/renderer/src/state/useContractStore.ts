import { create } from 'zustand';
import type {
  ContractActionInput,
  ContractActionReminderRequest,
  ContractActionStatusRequest,
  ContractActionUpdateRequest,
  ContractCard,
  ContractCreateRequest,
  ContractDetail,
  ContractLinkInput,
  ContractStatusRequest,
  ContractUpdateRequest
} from '../../../shared/contractContracts';

interface ContractState {
  contracts: ContractCard[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  detail: ContractDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  load: () => Promise<void>;
  ensureLoaded: () => Promise<void>;
  openDetail: (id: string) => Promise<void>;
  createContract: (input: ContractCreateRequest) => Promise<string | null>;
  updateContract: (input: ContractUpdateRequest) => Promise<string | null>;
  setStatus: (input: ContractStatusRequest) => Promise<string | null>;
  addAction: (contractId: string, input: ContractActionInput) => Promise<string | null>;
  updateAction: (input: ContractActionUpdateRequest) => Promise<string | null>;
  setActionStatus: (input: ContractActionStatusRequest) => Promise<string | null>;
  removeAction: (id: string) => Promise<string | null>;
  setActionReminder: (input: ContractActionReminderRequest) => Promise<string | null>;
  addLink: (contractId: string, input: ContractLinkInput) => Promise<string | null>;
  removeLink: (id: string) => Promise<string | null>;
  saveNote: (contractId: string, body: string) => Promise<string | null>;
}

let listRequest: Promise<void> | null = null;

export const useContractStore = create<ContractState>((set, get) => ({
  contracts: [], loading: false, loaded: false, error: null, detail: null, detailLoading: false, detailError: null,
  load: async () => {
    set({ loading: true, error: null });
    if (typeof window.api.listContracts !== 'function') {
      set({ contracts: [], loading: false, loaded: true });
      return;
    }
    const result = await window.api.listContracts();
    set(result.ok ? { contracts: result.data, loading: false, loaded: true } : { loading: false, loaded: true, error: result.error });
  },
  ensureLoaded: async () => {
    if (get().loaded) return;
    listRequest ??= get().load().finally(() => { listRequest = null; });
    return listRequest;
  },
  openDetail: async (id) => {
    set({ detailLoading: true, detailError: null });
    const result = await window.api.contractDetail(id);
    set(result.ok ? { detail: result.data, detailLoading: false } : { detailLoading: false, detailError: result.error });
  },
  createContract: async (input) => {
    const result = await window.api.createContract(input); if (!result.ok) return result.error;
    await get().load(); return null;
  },
  updateContract: async (input) => {
    const result = await window.api.updateContract(input); if (!result.ok) return result.error;
    await Promise.all([get().load(), get().openDetail(input.contractId)]); return null;
  },
  setStatus: async (input) => {
    const result = await window.api.setContractStatus(input); if (!result.ok) return result.error;
    await get().load();
    if (result.data.status === 'archived') set({ detail: null }); else await get().openDetail(input.contractId);
    return null;
  },
  addAction: async (contractId, input) => { const result = await window.api.addContractAction(contractId, input); if (!result.ok) return result.error; await Promise.all([get().load(), get().openDetail(contractId)]); return null; },
  updateAction: async (input) => { const result = await window.api.updateContractAction(input); if (!result.ok) return result.error; await Promise.all([get().load(), get().openDetail(result.data.contractId)]); return null; },
  setActionStatus: async (input) => { const result = await window.api.setContractActionStatus(input); if (!result.ok) return result.error; await Promise.all([get().load(), get().openDetail(result.data.contractId)]); return null; },
  removeAction: async (id) => { const contractId = get().detail?.contract.id; const result = await window.api.removeContractAction(id); if (!result.ok) return result.error; if (contractId) await Promise.all([get().load(), get().openDetail(contractId)]); return null; },
  setActionReminder: async (input) => { const contractId = get().detail?.contract.id; const result = await window.api.setContractActionReminder(input); if (!result.ok) return result.error; if (contractId) await get().openDetail(contractId); return null; },
  addLink: async (contractId, input) => { const result = await window.api.addContractLink(contractId, input); if (!result.ok) return result.error; await get().openDetail(contractId); return null; },
  removeLink: async (id) => { const contractId = get().detail?.contract.id; const result = await window.api.removeContractLink(id); if (!result.ok) return result.error; if (contractId) await get().openDetail(contractId); return null; },
  saveNote: async (contractId, body) => { const result = await window.api.saveContractNote(contractId, body); if (!result.ok) return result.error; await get().openDetail(contractId); return null; }
}));
