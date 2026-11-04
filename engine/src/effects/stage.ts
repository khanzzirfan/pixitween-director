import type * as THREE from 'three';
import { buildEffectChain, type EffectChain, type EffectSpecInput } from './chain';

// Stage effects (engine/docs/05-effects.md, "Stage effects"): one composer over the whole frame,
// rendering straight to the canvas (output null, no tone mapping — the stage already handles that
// per-layer). Null when there is nothing enabled to run, so the runtime can fall back to a plain
// `renderer.render(stage, camera)`.
export function buildStageChain(
  renderer: THREE.WebGLRenderer,
  stage: THREE.Scene,
  camera: THREE.Camera,
  effects: EffectSpecInput[],
  size: { width: number; height: number },
): EffectChain | null {
  if (!effects.some((effect) => effect.enabled !== false)) return null;
  return buildEffectChain({
    renderer,
    scene: stage,
    camera,
    effects,
    size,
    output: null,
    toneMapping: false,
  });
}
