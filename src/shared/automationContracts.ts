export type AutomationScheduleKind = 'once' | 'daily' | 'weekly';
export type AutomationRunStatus = 'queued' | 'running' | 'waiting_approval' | 'succeeded' | 'failed' | 'skipped';

export interface AgentAutomation {
  id: string;
  name: string;
  prompt: string;
  scheduleKind: AutomationScheduleKind;
  timeZone: string;
  localTime: string;
  weekdays: number[];
  runAtUtc: string | null;
  nextRunAtUtc: string | null;
  enabled: boolean;
  isDefaultDailyBriefing: boolean;
  lastFailure: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  scheduledForUtc: string;
  status: AutomationRunStatus;
  sessionId: string | null;
  outputRelativePath: string | null;
  approvalRequired: boolean;
  errorCategory: string | null;
  createdAtUtc: string;
  startedAtUtc: string | null;
  completedAtUtc: string | null;
}

export interface AutomationCreateRequest {
  name: string;
  prompt: string;
  scheduleKind: AutomationScheduleKind;
  timeZone: string;
  localTime: string;
  weekdays: number[];
  runAtUtc: string | null;
}

export interface AutomationUpdateRequest extends AutomationCreateRequest {
  automationId: string;
  expectedUpdatedAtUtc: string;
}

export interface AutomationEnabledRequest {
  automationId: string;
  enabled: boolean;
  expectedUpdatedAtUtc: string;
}

export interface DailyBriefingSource {
  kind: 'procurement' | 'node' | 'contract_action' | 'misc';
  entityId: string;
  parentId: string | null;
  label: string;
  dueAtUtc: string;
}

export interface DailyBriefingItem {
  id: string;
  domain: '采购' | '合同' | '杂事';
  title: string;
  detail: string;
  dueAtUtc: string;
  source: DailyBriefingSource;
}

export interface DailyBriefingDocument {
  schemaVersion: 1;
  date: string;
  timeZone: string;
  generatedAtUtc: string;
  agentAnalysisGenerated: boolean;
  headline: string;
  overdue: DailyBriefingItem[];
  today: DailyBriefingItem[];
  nextSevenDays: DailyBriefingItem[];
  notes: string[];
}
