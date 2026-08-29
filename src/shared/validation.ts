import { URGENCIES } from './taskContracts';
import type { MiscReminderUpdateRequest, NodeStatus, TaskCreateRequest, TaskInput } from './taskContracts';

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const NAME_MAX = 200;
export const FULL_NAME_MAX = 500;
export const SHORT_NAME_MAX = 24;

function graphemes(value: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(value)].map((entry) => entry.segment);
  }
  return Array.from(value);
}

function graphemeCount(value: string): number {
  return graphemes(value).length;
}

export function deriveShortName(value: string): { shortName: string; needsReview: boolean } {
  const normalized = value.trim();
  const parts = graphemes(normalized);
  if (parts.length <= SHORT_NAME_MAX) return { shortName: normalized, needsReview: false };
  return { shortName: `${parts.slice(0, SHORT_NAME_MAX - 1).join('')}…`, needsReview: true };
}

export function validateFormalName(value: string): ValidationResult {
  const name = (value ?? '').trim();
  if (!name) return { ok: false, errors: ['正式名称不能为空'] };
  if (graphemeCount(name) > FULL_NAME_MAX) return { ok: false, errors: ['正式名称不能超过 ' + FULL_NAME_MAX + ' 个字符'] };
  return { ok: true };
}

export function validateShortName(value: string): ValidationResult {
  const name = (value ?? '').trim();
  if (!name) return { ok: false, errors: ['卡片简称不能为空'] };
  if (graphemeCount(name) > SHORT_NAME_MAX) return { ok: false, errors: ['卡片简称不能超过 ' + SHORT_NAME_MAX + ' 个字符'] };
  return { ok: true };
}

export function procurementNames(input: { name: string; fullName?: string; shortName?: string }): { fullName: string; shortName: string } {
  const fullName = (input.fullName ?? input.name).trim();
  return {
    fullName,
    shortName: (input.shortName ?? deriveShortName(fullName).shortName).trim()
  };
}

export function validateTaskName(value: string): ValidationResult {
  const name = (value ?? '').trim();
  if (name.length === 0) return { ok: false, errors: ['任务名称不能为空'] };
  if (name.length > NAME_MAX) return { ok: false, errors: ['任务名称不能超过 ' + NAME_MAX + ' 个字符'] };
  return { ok: true };
}

export function validateNodeTitle(value: string): ValidationResult {
  const title = (value ?? '').trim();
  if (title.length === 0) return { ok: false, errors: ['节点标题不能为空'] };
  if (title.length > NAME_MAX) return { ok: false, errors: ['节点标题不能超过 ' + NAME_MAX + ' 个字符'] };
  return { ok: true };
}

export function validateTaskInput(input: TaskInput): ValidationResult {
  const errors: string[] = [];
  if (input.kind === 'misc') {
    const nameResult = validateTaskName(input.name);
    if (!nameResult.ok) errors.push(...nameResult.errors);
    if (!input.tzId) errors.push('缺少时区信息');
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }
  const isLegacyAdapterInput = input.kind === 'task' && input.fullName === undefined && input.shortName === undefined;
  if (isLegacyAdapterInput) {
    const nameResult = validateTaskName(input.name);
    if (!nameResult.ok) errors.push(...nameResult.errors);
  }
  const names = procurementNames(input);
  const fullNameResult = validateFormalName(names.fullName);
  const shortNameResult = validateShortName(names.shortName);
  if (!fullNameResult.ok) errors.push(...fullNameResult.errors);
  if (!isLegacyAdapterInput && !shortNameResult.ok) errors.push(...shortNameResult.errors);
  if (!URGENCIES.includes(input.urgency)) errors.push('无效的紧急程度');
  if (input.kind !== 'procurement' && input.kind !== 'task') errors.push('无效的任务类型');
  if (input.deadlineUtc !== null) {
    if (!isValidIsoUtc(input.deadlineUtc)) errors.push('截止时间格式无效');
  }
  if (!input.tzId || input.tzId.length === 0) errors.push('缺少时区信息');
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateTaskCreateRequest(input: TaskCreateRequest, nowMs = Date.now()): ValidationResult {
  if (input.kind !== 'misc') return validateTaskInput(input);
  const errors: string[] = [];
  const nameResult = validateTaskName(input.name);
  if (!nameResult.ok) errors.push(...nameResult.errors);
  if (!input.tzId) errors.push('缺少时区信息');
  if (input.remindAtUtc !== null) {
    if (!isValidIsoUtc(input.remindAtUtc)) errors.push('提醒时间格式无效');
    else if (Date.parse(input.remindAtUtc) <= nowMs) errors.push('提醒时间必须晚于当前时间');
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateMiscReminderUpdate(request: MiscReminderUpdateRequest, nowMs = Date.now()): ValidationResult {
  if (request.remindAtUtc === null) return { ok: true };
  if (!isValidIsoUtc(request.remindAtUtc)) return { ok: false, errors: ['提醒时间格式无效'] };
  return Date.parse(request.remindAtUtc) <= nowMs
    ? { ok: false, errors: ['提醒时间必须晚于当前时间'] }
    : { ok: true };
}

export function validateNodeInput(input: {
  title: string;
  startUtc: string | null;
  endUtc: string | null;
}): ValidationResult {
  const errors: string[] = [];
  const titleResult = validateNodeTitle(input.title);
  if (!titleResult.ok) errors.push(...titleResult.errors);
  if (input.startUtc !== null && !isValidIsoUtc(input.startUtc)) errors.push('节点开始时间格式无效');
  if (input.endUtc !== null && !isValidIsoUtc(input.endUtc)) errors.push('节点截止时间格式无效');
  if (
    input.startUtc !== null &&
    input.endUtc !== null &&
    isValidIsoUtc(input.startUtc) &&
    isValidIsoUtc(input.endUtc) &&
    Date.parse(input.endUtc) < Date.parse(input.startUtc)
  ) {
    errors.push('节点截止时间不能早于开始时间');
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateNodeStartSchedule(
  startUtc: string | null,
  status: NodeStatus,
  previousStartUtc: string | null,
  nowMs = Date.now()
): ValidationResult {
  if (status === 'completed' || status === 'cancelled' || startUtc === null || startUtc === previousStartUtc) {
    return { ok: true };
  }
  if (!isValidIsoUtc(startUtc)) return { ok: false, errors: ['节点开始时间格式无效'] };
  const currentMinute = Math.floor(nowMs / 60000) * 60000;
  return Date.parse(startUtc) < currentMinute
    ? { ok: false, errors: ['节点开始时间不能早于当前时间'] }
    : { ok: true };
}

export function isValidIsoUtc(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return false;
  return true;
}
