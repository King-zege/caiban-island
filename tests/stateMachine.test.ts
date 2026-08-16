import { describe, expect, it } from 'vitest';
import { nextLevel, TIMING } from '../src/shared/stateMachine';

describe('nextLevel 状态机', () => {
  it('热区停留：l1 → l2，其他层级不变', () => {
    expect(nextLevel('l1', { type: 'hoverDwell' })).toBe('l2');
    expect(nextLevel('l2', { type: 'hoverDwell' })).toBe('l2');
    expect(nextLevel('l3', { type: 'hoverDwell' })).toBe('l3');
  });
  it('离开：只有 l2 自动返回 l1，l3 保持工作台', () => {
    expect(nextLevel('l2', { type: 'leave' })).toBe('l1');
    expect(nextLevel('l3', { type: 'leave' })).toBe('l3');
    expect(nextLevel('l1', { type: 'leave' })).toBe('l1');
  });
  it('Esc 逐层返回', () => {
    expect(nextLevel('l3', { type: 'esc' })).toBe('l2');
    expect(nextLevel('l2', { type: 'esc' })).toBe('l1');
    expect(nextLevel('l1', { type: 'esc' })).toBe('l1');
  });
  it('openDetail：l2 → l3；back：l3 → l2', () => {
    expect(nextLevel('l2', { type: 'openDetail' })).toBe('l3');
    expect(nextLevel('l3', { type: 'back' })).toBe('l2');
  });
  it('toggle 双向切换', () => {
    expect(nextLevel('l1', { type: 'toggle' })).toBe('l2');
    expect(nextLevel('l2', { type: 'toggle' })).toBe('l1');
  });
});

describe('TIMING 常量', () => {
  it('符合 SPEC FR-011/FR-012 与设计系统', () => {
    expect(TIMING.HOVER_DWELL_MS).toBe(250);
    expect(TIMING.LEAVE_GRACE_MS).toBe(400);
    expect(TIMING.POLL_INTERVAL_MS).toBe(80);
    expect(TIMING.ANIMATION_MS).toBeGreaterThanOrEqual(180);
    expect(TIMING.ANIMATION_MS).toBeLessThanOrEqual(220);
  });
});
