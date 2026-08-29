export type IslandLevel = 'l1' | 'l2' | 'l3';
export type L2ContentMode = 'empty' | 'project' | 'misc' | 'mixed' | 'agent';
export type BackdropMode = 'transparent' | 'acrylic' | 'fallback';
export type ColorScheme = 'dark' | 'light';
export type RenderMode = 'composited' | 'software' | 'direct';
export type IslandTransitionPhase = 'preparing' | 'animating' | 'settling';
export type TransitionReason = 'level' | 'l2-detail' | 'l2-content' | 'display-change';

export interface Rect { x: number; y: number; width: number; height: number }
export interface WorkArea { x: number; y: number; width: number; height: number }
export interface DisplayInfo { x: number; y: number; width: number; height: number; workArea: WorkArea }

export interface IslandTransitionState {
  id: string;
  from: IslandLevel;
  to: IslandLevel;
  phase: IslandTransitionPhase;
  fromBounds: Rect;
  toBounds: Rect;
  durationMs: number;
  renderMode: RenderMode;
  reason: TransitionReason;
}

export interface TransitionRequestResult {
  accepted: boolean;
  transitionId?: string;
}

export interface IslandState {
  level: IslandLevel;
  backdrop: BackdropMode;
  paused: boolean;
  transition: IslandTransitionState | null;
}
export interface UiPreferences {
  colorScheme: ColorScheme;
  highContrast: boolean;
  reducedMotion: boolean;
  backdropMode: BackdropMode;
  renderMode: RenderMode;
}

export * from './taskContracts';
export * from './draftContracts';
export * from './agentContracts';
export * from './agentProposalContracts';
export * from './procurementContracts';
