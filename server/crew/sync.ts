// Owned by S12a. Applies a storyboard revision to the composition without a model (design.md 5.4):
// scenes added, removed and moved, plus duration, camera and headline text. What needs a builder or a mode change is only reported.
import { compositionMode, type Scene, type Storyboard } from '@shared/storyboard';
import { addLayer, addScene, removeScene, setCamera, setSceneDuration, setText, swapScenes } from '../authoring/api';
import { layerMeta, sceneIds } from '../authoring/meta';
import type { Comp } from '../authoring/types';
import type { OpsResult } from './storyboard-ops';

export interface SyncResult {
  next: Comp;
  /** Scenes that still need a builder: every new scene and every scene whose intent, shot or layers changed. */
  needsBuilder: string[];
  /** Scenes whose mode changed. The caller runs the generate propose flow or the revert. */
  needsMode: string[];
}

const hasLayer = (c: Comp, id: string): boolean => {
  try {
    layerMeta(c, id);
    return true;
  } catch {
    return false;
  }
};

/** Swaps scenes into the storyboard's order. */
function reorder(c: Comp, order: string[]): Comp {
  let out = c;
  for (let i = 0; i < order.length; i++) {
    const have = sceneIds(out);
    if (have[i] !== order[i]) out = swapScenes(out, have[i]!, order[i]!);
  }
  return out;
}

/**
 * `before` and `after` are the storyboards either side of the revision and `result` is what applyOps reported.
 * The composition is brought to match `after`, so running it twice changes nothing the second time.
 */
export function syncComposition(comp: Comp, before: Storyboard, after: Storyboard, result: Pick<OpsResult, 'dirty'>): SyncResult {
  let next = comp;
  const afterIds = after.scenes.map((s) => s.id);
  const inComp = new Set(sceneIds(next));
  const sceneOf = (id: string): Scene => after.scenes.find((s) => s.id === id)!;

  // removals first, so a swap of scenes never has to fit the film length twice
  for (const s of before.scenes) if (inComp.has(s.id) && !afterIds.includes(s.id)) next = removeScene(next, s.id);

  const added = after.scenes.filter((s) => !sceneIds(next).includes(s.id)).map((s) => s.id);
  const durationOf = (id: string) => {
    const frames = (next.precomps as Record<string, { durationInFrames: number }>)[id]?.durationInFrames;
    return frames === undefined ? undefined : frames / next.fps;
  };
  const changed = after.scenes.filter((s) => !added.includes(s.id) && durationOf(s.id) !== undefined && Math.abs(durationOf(s.id)! - s.durationSec) > 1e-6);

  // shrink first, then add, then grow: the film is never over its length in between
  for (const s of changed.filter((c) => c.durationSec < durationOf(c.id)!)) next = setSceneDuration(next, s.id, s.durationSec);
  for (const id of added) {
    const s = sceneOf(id);
    next = addScene(next, { id, durationSec: s.durationSec, mode: compositionMode(s.mode), intent: s.intent });
  }
  for (const s of changed.filter((c) => c.durationSec > durationOf(c.id)!)) next = setSceneDuration(next, s.id, s.durationSec);

  next = reorder(next, afterIds);

  const dirtyOf = (id: string) => result.dirty[id] ?? [];
  for (const s of after.scenes) {
    const isNew = added.includes(s.id);
    if (isNew || dirtyOf(s.id).includes('camera')) next = setCamera(next, s.id, s.camera);
    if (!isNew && dirtyOf(s.id).includes('text') && s.text) {
      const headline = `${s.id}:headline`;
      next = hasLayer(next, headline) ? setText(next, headline, s.text) : addLayer(next, { sceneId: s.id, role: 'headline', kind: 'text', text: s.text });
    }
  }

  const needsBuilder = after.scenes.filter((s) => added.includes(s.id) || dirtyOf(s.id).includes('rebuild')).map((s) => s.id);
  const needsMode = after.scenes.filter((s) => !added.includes(s.id) && dirtyOf(s.id).includes('mode')).map((s) => s.id);
  return { next, needsBuilder, needsMode };
}
