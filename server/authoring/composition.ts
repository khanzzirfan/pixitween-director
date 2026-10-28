import { ASPECT_SIZES } from '@shared/composition';
import { AEP_VERSION } from './constants';
import { AuthoringError, hintList } from './errors';
import type { Aspect, Comp, Obj } from './types';

export function newFilmComposition(o: { aspect: Aspect; title?: string; palette?: string[] }): Comp {
  const { width, height } = ASPECT_SIZES[o.aspect];
  return {
    version: AEP_VERSION,
    id: 'film',
    ...(o.title ? { name: o.title } : {}),
    width,
    height,
    fps: 30,
    durationInFrames: 1,
    bgColor: o.palette?.[0] ?? '#000000',
    assets: {},
    layers: [],
    precomps: {},
    meta: { director: { scenes: {}, layers: {} } },
  };
}

/** `duration` is passed through in the engine's own unit, FRAMES (asset.ts). */
export function registerAsset(
  c: Comp,
  a: { id: string; kind: 'image' | 'video' | 'audio'; src: string; width?: number; height?: number; duration?: number },
): Comp {
  const out = structuredClone(c);
  out.assets[a.id] = {
    type: a.kind,
    src: a.src,
    ...(a.width !== undefined ? { width: a.width } : {}),
    ...(a.height !== undefined ? { height: a.height } : {}),
    ...(a.duration !== undefined ? { duration: a.duration } : {}),
  };
  return out;
}

/** Updates the src at the root and in every scene precomp that holds its own copy (inner entries override the outer assetMap). */
export function setAssetSrc(c: Comp, assetId: string, src: string): Comp {
  if (!c.assets[assetId]) throw new AuthoringError('unknown_asset', `asset '${assetId}' is not registered`, hintList(Object.keys(c.assets)));
  const out = structuredClone(c);
  out.assets[assetId]!.src = src;
  for (const p of Object.values((out.precomps ?? {}) as Record<string, Obj>)) if (p.assets?.[assetId]) p.assets[assetId].src = src;
  return out;
}
