import { KINDS, URGENCIES } from './taskContracts';
import type { NodeStatus, TaskInput } from './taskContracts';

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const NAME_MAX = 200;

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
  const nameResult = validateTaskName(input.name);
  if (!nameResult.ok) errors.push(...nameResult.errors);
  if (!URGENCIES.includes(input.urgency)) errors.push('无效的紧急程度');
  if (!KINDS.includes(input.kind)) errors.push('无效的任务类型');
  if (input.deadlineUtc !== null) {
    if (!isValidIsoUtc(input.deadlineUtc)) errors.push('截止时间格式无效');
  }
  if (!input.tzId || input.tzId.length === 0) errors.push('缺少时区信息');
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
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
