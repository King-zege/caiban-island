import type { DisplayInfo, L2TrackDescriptor, Rect } from './types';

export const ISLAND = {
  L1_WIDTH: 96,
  L1_HEIGHT: 6,
  L1_VISIBLE_HEIGHT: 4,
  L1_NATIVE_HEIGHT: 35,    // Windows 无框窗口的安全最小逻辑高度；透明主体移到屏幕外
  L2_WIDTH: 760,
  L2_HEIGHT: 280,
  L2_HEIGHT_MISC: 196,
  L2_HEIGHT_CONTRACT: 244,
  L2_HEIGHT_MIXED: 376,
  L2_HEIGHT_TRIPLE: 480,
  L2_HEIGHT_DETAIL: 480,
  L2_MIN_WIDTH: 560,
  L2_MAX_WIDTH_RATIO: 0.8,
  L2_MAX_HEIGHT_RATIO: 0.45,
  L2_DETAIL_HEIGHT_RATIO: 0.68,
  L3_MAX_WIDTH_RATIO: 0.85,
  L3_MAX_HEIGHT_RATIO: 0.85,
  L3_VERTICAL_POSITION: 0.08,
  EDGE_MARGIN: 12,
  HOTZONE_HALF_WIDTH: 60,  // 顶部热区：中央 ±60px
  HOTZONE_TOP: 10          // 顶部热区：屏幕顶边下 10px
} as const;

export function computeL1Bounds(display: DisplayInfo, nativeHeight: number = ISLAND.L1_NATIVE_HEIGHT): Rect {
  const height = Math.max(nativeHeight, ISLAND.L1_HEIGHT);
  return {
    x: display.x + Math.round((display.width - ISLAND.L1_WIDTH) / 2),
    y: display.y - (height - ISLAND.L1_VISIBLE_HEIGHT),
    width: ISLAND.L1_WIDTH,
    height
  };
}

const DEFAULT_L2_TRACKS: L2TrackDescriptor = { agent: false, procurement: true, contracts: false, misc: false };

export function computeL2Bounds(display: DisplayInfo, detail = false, tracks: L2TrackDescriptor = DEFAULT_L2_TRACKS): Rect {
  let w = Math.min(ISLAND.L2_WIDTH, Math.floor(display.width * ISLAND.L2_MAX_WIDTH_RATIO));
  w = Math.max(Math.min(ISLAND.L2_MIN_WIDTH, display.width), w);
  if (w > display.width) w = display.width;
  const activeTracks = Number(tracks.procurement) + Number(tracks.contracts) + Number(tracks.misc);
  const baseHeight = activeTracks === 0
    ? ISLAND.L2_HEIGHT
    : Math.min(ISLAND.L2_HEIGHT_TRIPLE, 72 + (tracks.procurement ? 208 : 0) + (tracks.contracts ? 172 : 0) + (tracks.misc ? 124 : 0));
  const h = detail || tracks.agent
    ? Math.min(ISLAND.L2_HEIGHT_DETAIL, Math.floor(display.height * ISLAND.L2_DETAIL_HEIGHT_RATIO))
    : Math.min(baseHeight, Math.floor(display.height * ISLAND.L2_MAX_HEIGHT_RATIO));
  return {
    x: display.x + Math.round((display.width - w) / 2),
    y: Math.max(display.y, display.workArea.y),
    width: w,
    height: h
  };
}

export function computeL3Bounds(display: DisplayInfo): Rect {
  const w = Math.min(Math.floor(display.width * ISLAND.L3_MAX_WIDTH_RATIO), display.width - 2 * ISLAND.EDGE_MARGIN);
  const h = Math.min(Math.floor(display.height * ISLAND.L3_MAX_HEIGHT_RATIO), display.height - 2 * ISLAND.EDGE_MARGIN);
  const y = display.workArea.y + Math.round((display.workArea.height - h) * ISLAND.L3_VERTICAL_POSITION);
  return {
    x: display.x + Math.round((display.width - w) / 2),
    y: Math.max(display.y, y),
    width: w,
    height: h
  };
}

export function isInHotZone(x: number, y: number, display: DisplayInfo): boolean {
  const centerX = display.x + display.width / 2;
  return y <= display.y + ISLAND.HOTZONE_TOP && Math.abs(x - centerX) <= ISLAND.HOTZONE_HALF_WIDTH;
}
