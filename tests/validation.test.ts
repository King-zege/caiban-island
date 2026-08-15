import { describe, expect, it } from 'vitest';
import { validateNodeInput, validateTaskInput } from '../src/shared/validation';
import type { TaskInput } from '../src/shared/taskContracts';

const base: TaskInput = {
  name: '采购任务',
  description: '',
  kind: 'task',
  urgency: 'normal',
  deadlineUtc: null,
  tzId: 'Asia/Shanghai'
};

describe('validateTaskInput（FR-020/FR-022/FR-023）', () => {
  it('合法输入通过', () => {
    expect(validateTaskInput(base)).toEqual({ ok: true });
  });
  it('名称去除首尾空白后必填，1–200 字符', () => {
    expect(validateTaskInput({ ...base, name: '   ' }).ok).toBe(false);
    expect(validateTaskInput({ ...base, name: ' 采购  ' }).ok).toBe(true);
    expect(validateTaskInput({ ...base, name: 'x'.repeat(201) }).ok).toBe(false);
    expect(validateTaskInput({ ...base, name: 'x'.repeat(200) }).ok).toBe(true);
  });
  it('非法枚举拒绝', () => {
    expect(validateTaskInput({ ...base, urgency: 'urgent' as never }).ok).toBe(false);
    expect(validateTaskInput({ ...base, kind: 'note' as never }).ok).toBe(false);
  });
  it('非法 deadline 拒绝', () => {
    expect(validateTaskInput({ ...base, deadlineUtc: '不是日期' }).ok).toBe(false);
    expect(validateTaskInput({ ...base, deadlineUtc: '2026-12-31T10:00:00.000Z' }).ok).toBe(true);
  });
  it('缺少时区拒绝', () => {
    expect(validateTaskInput({ ...base, tzId: '' }).ok).toBe(false);
  });
});

describe('validateNodeInput（FR-024/FR-025）', () => {
  it('节点截止早于开始 → 拒绝', () => {
    expect(
      validateNodeInput({ title: 'n', startUtc: '2026-03-02T00:00:00.000Z', endUtc: '2026-03-01T00:00:00.000Z' }).ok
    ).toBe(false);
  });
  it('标题必填', () => {
    expect(validateNodeInput({ title: ' ', startUtc: null, endUtc: null }).ok).toBe(false);
  });
  it('正常节点通过', () => {
    expect(validateNodeInput({ title: '询价', startUtc: null, endUtc: null }).ok).toBe(true);
  });
});
