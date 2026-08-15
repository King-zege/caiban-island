export type IslandLevel = 'l1' | 'l2' | 'l3';
export type BackdropMode = 'acrylic' | 'fallback';

export interface Rect { x: number; y: number; width: number; height: number }
export interface WorkArea { x: number; y: number; width: number; height: number }
export interface DisplayInfo { x: number; y: number; width: number; height: number; workArea: WorkArea }

export interface IslandState { level: IslandLevel; backdrop: BackdropMode; paused: boolean }

export * from './taskContracts';
export * from './draftContracts';
