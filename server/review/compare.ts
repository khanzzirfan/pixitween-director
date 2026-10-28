import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { Box } from './types';
import { layerBoxAt } from './geometry';
import { isKeyframed } from './keyframes';

export interface MeasuredBox {
  /** The frame the browser measured at. */
  frame: number;
  box: Box;
}
export type MeasuredBoxes = Record<string, MeasuredBox>;

/** Compares measured text boxes with the geometry model. Errors are relative to the frame size, so 0.01 means 1 % of the frame. */
export function compareGeometry(comp: AepCompositionJson, measured: MeasuredBoxes): { maxRelError: number; layers: number } | null {
  let maxRelError = 0;
  let layers = 0;
  for (const [layerId, m] of Object.entries(measured)) {
    let model: Box;
    try {
      model = layerBoxAt(comp, layerId, m.frame).box;
    } catch {
      continue;
    }
    const dx = Math.max(Math.abs(model.left - m.box.left), Math.abs(model.right - m.box.right)) / comp.width;
    const dy = Math.max(Math.abs(model.top - m.box.top), Math.abs(model.bottom - m.box.bottom)) / comp.height;
    maxRelError = Math.max(maxRelError, dx, dy);
    layers++;
  }
  return layers ? { maxRelError, layers } : null;
}

/** Measured boxes the rules may use: only layers whose position and scale are static, since the rules sample one frame. */
export function measuredForRules(comp: AepCompositionJson, measured: MeasuredBoxes): Record<string, Box> {
  const out: Record<string, Box> = {};
  const layers = [
    ...(comp.layers as Array<{ id: string }>),
    ...Object.values(comp.precomps ?? {}).flatMap((p) => (p as { layers: Array<{ id: string }> }).layers),
  ];
  for (const [layerId, m] of Object.entries(measured)) {
    const layer = layers.find((l) => l.id === layerId) as { transform?: { position?: unknown; scale?: unknown } } | undefined;
    if (!layer) continue;
    if (isKeyframed(layer.transform?.position) || isKeyframed(layer.transform?.scale)) continue;
    out[layerId] = m.box;
  }
  return out;
}
