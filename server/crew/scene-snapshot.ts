// Owned by S12a. Pure scene snapshot, restore and splice (design.md 5.3). Every function returns new objects and never touches its inputs.
import { AuthoringError } from '../authoring/errors';
import { readDirector, writeDirector } from '../authoring/meta';
import { sequenceScenes } from '../authoring/scenes';
import type { Comp, LayerMeta, Obj, SceneMeta } from '../authoring/types';

export interface SceneSnapshot {
  precomp: Obj;
  rootLayer: Obj;
  directorScene: SceneMeta;
  directorLayers: Record<string, LayerMeta>;
  /** The root `assets` entries the scene's layers use. */
  assets: Record<string, unknown>;
}

const precompsOf = (c: Comp): Record<string, Obj> => (c.precomps ?? {}) as Record<string, Obj>;

function requireScene(c: Comp, sceneId: string): { precomp: Obj; rootLayer: Obj } {
  const precomp = precompsOf(c)[sceneId];
  const rootLayer = (c.layers as Obj[]).find((l) => l.kind === 'precomp' && l.id === sceneId);
  if (!precomp || !rootLayer) throw new AuthoringError('unknown_scene', `no scene '${sceneId}'`);
  return { precomp, rootLayer };
}

export function snapshotScene(comp: Comp, sceneId: string): SceneSnapshot {
  const { precomp, rootLayer } = requireScene(comp, sceneId);
  const meta = readDirector(comp);
  const directorScene = meta.scenes[sceneId];
  if (!directorScene) throw new AuthoringError('unknown_scene', `no scene '${sceneId}'`);
  const directorLayers = Object.fromEntries(Object.entries(meta.layers).filter(([, m]) => m.sceneId === sceneId));

  const used = new Set<string>();
  for (const l of precomp.layers as Obj[]) for (const k of ['assetId', 'maskAssetId']) if (typeof l[k] === 'string') used.add(l[k]);
  for (const m of Object.values(directorLayers)) for (const id of [m.assetId, m.maskAssetId]) if (id) used.add(id);
  const rootAssets = (comp.assets ?? {}) as Record<string, unknown>;
  const assets = Object.fromEntries([...used].filter((id) => id in rootAssets).map((id) => [id, rootAssets[id]]));

  return structuredClone({ precomp, rootLayer, directorScene, directorLayers, assets });
}

/** Puts the snapshot back. If the scene's length differs, later scenes shift so the timeline stays gapless. */
export function restoreScene(comp: Comp, sceneId: string, snap: SceneSnapshot): Comp {
  requireScene(comp, sceneId);
  const s = structuredClone(snap);
  const out = structuredClone(comp);
  (out.precomps as Record<string, Obj>)[sceneId] = s.precomp;
  const i = (out.layers as Obj[]).findIndex((l) => l.kind === 'precomp' && l.id === sceneId);
  (out.layers as Obj[])[i] = s.rootLayer;
  out.assets = { ...(out.assets ?? {}), ...s.assets } as Comp['assets'];

  const meta = readDirector(out);
  meta.scenes[sceneId] = s.directorScene;
  for (const [id, m] of Object.entries(meta.layers)) if (m.sceneId === sceneId) delete meta.layers[id];
  Object.assign(meta.layers, s.directorLayers);
  return sequenceScenes(writeDirector(out, meta));
}

/** Copies one scene of `source` into the same scene id of `target`. This is how a picked take enters the parent film. */
export function spliceScene(target: Comp, sceneId: string, source: Comp): Comp {
  return restoreScene(target, sceneId, snapshotScene(source, sceneId));
}
