import { AuthoringError, hintList } from './errors';
import type { Comp, DirectorMeta, LayerMeta, SceneMeta } from './types';

/** A copy of `meta.director`; empty maps when absent. */
export function readDirector(c: Comp): DirectorMeta {
  const d = (c.meta as { director?: Partial<DirectorMeta> } | undefined)?.director;
  return structuredClone({ ...(d?.productNoun !== undefined ? { productNoun: d.productNoun } : {}), scenes: d?.scenes ?? {}, layers: d?.layers ?? {} });
}

/** A clone of `c` whose `meta.director` is `meta`; other meta keys are kept. */
export function writeDirector(c: Comp, meta: DirectorMeta): Comp {
  const out = structuredClone(c);
  out.meta = { ...(out.meta ?? {}), director: structuredClone(meta) };
  return out;
}

export function sceneMeta(c: Comp, id: string): SceneMeta {
  const m = readDirector(c).scenes[id];
  if (!m) throw new AuthoringError('unknown_scene', `no scene '${id}'`, hintList(sceneIds(c)));
  return m;
}

export function layerMeta(c: Comp, id: string): LayerMeta {
  const m = readDirector(c).layers[id];
  if (!m) throw new AuthoringError('unknown_layer', `no layer '${id}'`, hintList(Object.keys(readDirector(c).layers)));
  return m;
}

/** Scene ids in timeline order: the order of the root precomp layers. */
export const sceneIds = (c: Comp): string[] => c.layers.filter((l) => l.kind === 'precomp').map((l) => l.id);

export function setProductNoun(c: Comp, noun: string): Comp {
  const n = noun.trim();
  if (!n) throw new AuthoringError('bad_value', 'productNoun must not be empty');
  const d = readDirector(c);
  d.productNoun = n;
  return writeDirector(c, d);
}

export const getProductNoun = (c: Comp): string | undefined => readDirector(c).productNoun;
