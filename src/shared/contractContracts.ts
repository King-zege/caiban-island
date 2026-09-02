export const CONTRACT_STATUSES = ['draft', 'active', 'closing', 'closed', 'terminated', 'archived'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_ACTION_TYPES = ['payment', 'invoice', 'delivery', 'acceptance', 'renewal', 'expiry', 'archive', 'custom'] as const;
export type ContractActionType = (typeof CONTRACT_ACTION_TYPES)[number];
export const CONTRACT_ACTION_STATUSES = ['pending', 'in_progress', 'completed', 'waived'] as const;
export type ContractActionStatus = (typeof CONTRACT_ACTION_STATUSES)[number];

export type ContractRisk = 'overdue' | 'due_soon' | 'normal' | 'none';

export interface Contract {
  id: string;
  procurementProjectId: string | null;
  fullName: string;
  shortName: string;
  contractNo: string;
  supplierName: string;
  amountMinor: number | null;
  currency: string;
  signedOn: string | null;
  effectiveOn: string | null;
  expiresOn: string | null;
  tzId: string;
  status: ContractStatus;
  archivedFromStatus: Exclude<ContractStatus, 'archived'> | null;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface ContractAction {
  id: string;
  contractId: string;
  type: ContractActionType;
  title: string;
  description: string;
  dueAtUtc: string | null;
  amountMinor: number | null;
  relatedActionId: string | null;
  status: ContractActionStatus;
  position: number;
  completedAtUtc: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface ContractActionReminder {
  actionId: string;
  fireAtUtc: string;
  fired: boolean;
}

export interface ContractLink {
  id: string;
  contractId: string;
  kind: 'url' | 'file';
  title: string;
  target: string;
  meta: string;
}

export interface ContractCard {
  contract: Contract;
  nextAction: ContractAction | null;
  pendingActionCount: number;
  risk: ContractRisk;
  primaryFile: ContractLink | null;
  fileCount: number;
  urlCount: number;
}

export interface ContractDetail {
  contract: Contract;
  actions: ContractAction[];
  links: ContractLink[];
  note: string;
  reminders: ContractActionReminder[];
}

export interface ContractCreateRequest {
  procurementProjectId: string | null;
  fullName: string;
  shortName: string;
  contractNo: string;
  supplierName: string;
  amountMinor: number | null;
  currency: string;
  signedOn: string | null;
  effectiveOn: string | null;
  expiresOn: string | null;
  tzId: string;
  status: 'draft' | 'active';
  initialLinks?: ContractLinkInput[];
  initialActions?: ContractInitialActionInput[];
}

export interface ContractUpdateRequest extends Omit<ContractCreateRequest, 'status' | 'initialLinks' | 'initialActions'> {
  contractId: string;
  expectedUpdatedAtUtc: string;
}

export interface ContractActionInput {
  type: ContractActionType;
  title: string;
  description: string;
  dueAtUtc: string | null;
  amountMinor: number | null;
  relatedActionId: string | null;
}

export interface ContractActionUpdateRequest {
  actionId: string;
  input: ContractActionInput;
  expectedUpdatedAtUtc: string;
}

export interface ContractActionStatusRequest {
  actionId: string;
  status: ContractActionStatus;
  expectedStatus: ContractActionStatus;
}

export interface ContractActionReminderRequest {
  actionId: string;
  fireAtUtc: string | null;
  expectedFireAtUtc: string | null;
}

export interface ContractStatusRequest {
  contractId: string;
  status: ContractStatus;
  expectedStatus: ContractStatus;
}

export interface ContractLinkInput {
  kind: 'url' | 'file';
  title: string;
  target: string;
}

export interface ContractInitialActionInput {
  type: ContractActionType;
  title: string;
  description: string;
  dueAtUtc: string | null;
  amountMinor: number | null;
  remindAtUtc: string | null;
}

export type ContractWorkspaceSection = 'overview' | 'performance' | 'billing' | 'acceptance' | 'materials' | 'notes';

export const CONTRACT_ACTION_LABELS: Record<ContractActionType, string> = {
  payment: '付款', invoice: '开票', delivery: '交付', acceptance: '验收', renewal: '续签', expiry: '到期', archive: '归档', custom: '自定义'
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: '草拟', active: '履约中', closing: '收尾中', closed: '已关闭', terminated: '已终止', archived: '已归档'
};

export const CONTRACT_ACTION_STATUS_LABELS: Record<ContractActionStatus, string> = {
  pending: '待完成', in_progress: '进行中', completed: '已完成', waived: '已豁免'
};
