import type { FilmState } from '@shared/composition';
import { addLayer, layerIdsByRole, removeLayer, reorderLayer, setCamera } from '../authoring/api';
import { readDirector, writeDirector } from '../authoring/meta';
import type { Comp, LayerRole } from '../authoring/types';
import { ArtError } from './errors';
export const ROLE_RANK = ['bg', 'subject', 'product', 'headline', 'caption'] as const;
export const ROLE_Z = { bg: 10, subject: 5, headline: 3, product: 1, caption: 0 } as const;
export function ensureInnerAsset(comp: Comp, sceneId: string, assetId: string): Comp {
  if (!comp.precomps?.[sceneId]) throw new ArtError('unknown-scene', `unknown scene '${sceneId}'`);
  const asset = comp.assets[assetId];
  if (!asset) throw new Error(`asset '${assetId}' is not registered`);
  const out = structuredClone(comp);
  const inner = out.precomps![sceneId]!;
  if (!inner.assets[assetId]) inner.assets[assetId] = structuredClone(asset);
  return out;
}
export function withMaskAsset(comp: Comp, layerId: string, maskAssetId: string): Comp {
  const meta = readDirector(comp);
  const layer = meta.layers[layerId];
  if (!layer) throw new Error(`unknown layer '${layerId}'`);
  layer.maskAssetId = maskAssetId;
  return writeDirector(comp, meta);
}
export function withProductNoun(comp: Comp, noun: string): Comp {
  const meta = readDirector(comp);
  meta.productNoun = noun.trim();
  return writeDirector(comp, meta);
}
export function reapplyCamera(comp: Comp, film: FilmState, sceneId: string): Comp {
  const move = film.storyboard?.scenes.find((scene) => scene.id === sceneId)?.camera ?? 'static';
  return setCamera(comp, sceneId, move);
}
function layerFor(comp: Comp, sceneId: string, id: string) {
  return (comp.precomps![sceneId]!.layers as Array<Record<string, any>>).find((layer) => layer.id === id);
}
export function replaceRoleLayer(
  comp: Comp,
  sceneId: string,
  role: LayerRole,
  spec: Parameters<typeof addLayer>[1],
  opts: { keepOpacity?: boolean } = {},
): Comp {
  const oldId = layerIdsByRole(comp, role, sceneId)[0];
  let next = comp;
  let below: string | undefined;
  let opacity: unknown;
  const layers = comp.precomps?.[sceneId]?.layers as Array<Record<string, any>> | undefined;
  if (oldId && layers) {
    const index = layers.findIndex((layer) => layer.id === oldId);
    below = role === 'bg' ? undefined : layers[index - 1]?.id;
    opacity = layerFor(comp, sceneId, oldId)?.transform?.opacity;
    next = removeLayer(next, oldId);
  }
  const before = new Set(Object.keys(readDirector(next).layers));
  next = addLayer(next, spec);
  const newId = Object.keys(readDirector(next).layers).find((id) => !before.has(id))!;
  if (below && role !== 'bg') next = reorderLayer(next, newId, { above: below });
  else next = reorderLayer(next, newId, 'back');
  if (!oldId && role !== 'bg') {
    const meta = readDirector(next);
    const inner = next.precomps![sceneId]!.layers as Array<Record<string, any>>;
    const rank = ROLE_RANK.indexOf(role as (typeof ROLE_RANK)[number]);
    const prev = inner.filter((l) => (ROLE_RANK.indexOf(meta.layers[l.id]?.role as (typeof ROLE_RANK)[number]) ?? -1) < rank).at(-1)?.id;
    if (prev) next = reorderLayer(next, newId, { above: prev });
  }
  if (opts.keepOpacity !== false && opacity !== undefined) {
    const out = structuredClone(next);
    const layer = layerFor(out, sceneId, newId);
    if (layer) layer.transform.opacity = structuredClone(opacity);
    next = out;
  }
  return next;
}
