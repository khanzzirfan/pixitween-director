// Owned by S7a. Scene mode helpers and the proposal facts shown to the user.
import type { FilmState } from '@shared/composition';
import { MAX_GENERATE_SCENES } from '@shared/storyboard';
import { CLIPPY_ESTIMATED_CREDITS } from '../clippy/types';
import { clipSecondsFor, wantsSound, type ClipModel } from './request';

export { MAX_GENERATE_SCENES };
type Comp = NonNullable<FilmState['composition']>;
type Meta = { scenes?: Record<string, { mode?: 'motion' | 'generate' }> };
const scenesOf = (c: Comp) => ((c.meta as { director?: Meta } | undefined)?.director?.scenes ?? {}) as NonNullable<Meta['scenes']>;

export const countGenerateScenes = (c: Comp): number => Object.values(scenesOf(c)).filter((s) => s.mode === 'generate').length;

export function setSceneMode(c: Comp, sceneId: string, mode: 'motion' | 'generate'): Comp {
  if (!scenesOf(c)[sceneId]) throw Object.assign(new Error(`unknown scene '${sceneId}'`), { code: 'unknown_scene' });
  const out = structuredClone(c);
  (out.meta as { director: { scenes: Record<string, { mode: string }> } }).director.scenes[sceneId]!.mode = mode;
  return out;
}

export interface ProposalInfo {
  model: ClipModel;
  durationSec: number;
  withSound: boolean;
  reason: string;
  estCredits: 25;
}

export function buildProposalInfo(i: { film: FilmState; comp: Comp; sceneId: string; sourceKind: 'still' | 'flatten' | 'plate' | 'product-photo'; balance?: number }): ProposalInfo {
  const scene = i.film.storyboard?.scenes.find((s) => s.id === i.sceneId);
  const meta = (i.comp.meta as { director?: { scenes?: Record<string, { durationFrames?: number; intent?: string }> } } | undefined)?.director?.scenes?.[i.sceneId];
  const intent = scene?.intent ?? meta?.intent ?? '';
  const sceneSec = scene?.durationSec ?? (meta?.durationFrames ?? 0) / i.comp.fps;
  const withSound = wantsSound(intent);
  const model: ClipModel = withSound ? 'fast-h3-omni' : 'fast-h3';
  let reason = scene?.modeReason?.trim() || 'You chose real video for this scene.';
  if (i.sourceKind === 'product-photo') reason += ' No scene image exists yet, so the product photo will be animated.';
  return { model, durationSec: clipSecondsFor(model, sceneSec), withSound, reason, estCredits: CLIPPY_ESTIMATED_CREDITS as 25 };
}
