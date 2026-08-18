import type { RenderMode } from './types';

export interface RenderModeInputs {
  gpuCompositing?: string;
  highContrast?: boolean;
  reducedMotion?: boolean;
  gpuCrashed?: boolean;
}

export function classifyRenderMode(inputs: RenderModeInputs): RenderMode {
  if (inputs.highContrast || inputs.reducedMotion || inputs.gpuCrashed) return 'direct';
  const status = inputs.gpuCompositing;
  if (!status) return 'software';
  if (status.startsWith('enabled')) return 'composited';
  if (status === 'disabled_software' || status === 'unavailable_software') return 'software';
  return 'direct';
}
