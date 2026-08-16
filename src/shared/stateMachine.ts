import type { IslandLevel } from './types';

export const TIMING = {
  HOVER_DWELL_MS: 250,
  LEAVE_GRACE_MS: 400,
  POLL_INTERVAL_MS: 80,
  ANIMATION_MS: 200,
  ANIMATION_FRAME_MS: 24
} as const;

export type IslandEvent =
  | { type: 'hoverDwell' }   // 鼠标在顶部热区停留达标
  | { type: 'leave' }        // 鼠标离开岛且无交互
  | { type: 'esc' }          // Esc：逐层返回
  | { type: 'openDetail' }   // 进入 L3 详细编辑
  | { type: 'back' }         // L3 返回 L2
  | { type: 'toggle' };      // 托盘/双击切换

export function nextLevel(current: IslandLevel, event: IslandEvent): IslandLevel {
  switch (event.type) {
    case 'hoverDwell': return current === 'l1' ? 'l2' : current;
    case 'leave': return current === 'l2' ? 'l1' : current;
    case 'esc': return current === 'l3' ? 'l2' : current === 'l2' ? 'l1' : current;
    case 'back': return current === 'l3' ? 'l2' : current;
    case 'openDetail': return current === 'l2' ? 'l3' : current;
    case 'toggle': return current === 'l1' ? 'l2' : 'l1';
  }
}
