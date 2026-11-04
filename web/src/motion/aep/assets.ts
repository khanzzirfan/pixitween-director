// AEP asset table -> MotionDoc asset table. See engine/docs/10-aep-adapter.md ("Layers", `image`
// and `model3d` rows) — `image` assets become MotionDoc `image` assets, `model` assets become
// `gltf` assets, a `*.typeface.json` font becomes a `font` asset (3D titles), everything else (audio, video, lottie, gif, svg, font, composition) has no place
// in a MotionDoc asset table and is dropped.
import type { AepAssetMap } from '@shared/aep/asset';
import type { Asset } from '@engine/schema';
import { sanitizeId } from './sanitizeId';

export interface ConvertAssetsResult {
  assets: Record<string, Asset>;
}

const ASSET_TYPE_MAP: Record<string, Asset['type'] | undefined> = {
  image: 'image',
  model: 'gltf',
};

/** `resolveUrl` defaults to identity: `asset.src` is already a usable url (e.g. `/api/assets/<id>`). */
export function convertAssets(assetMap: AepAssetMap | undefined, resolveUrl: (src: string) => string = (src) => src): ConvertAssetsResult {
  const assets: Record<string, Asset> = {};
  if (!assetMap) return { assets };

  for (const [originalId, asset] of Object.entries(assetMap)) {
    // a font reaches the engine only as a Three typeface (the 3D titles' letters); other fonts are for flat text and stay behind
    const type = asset.type === 'font' && /\.typeface\.json(\?|$)/.test(asset.src) ? 'font' : ASSET_TYPE_MAP[asset.type];
    if (!type) continue;
    assets[sanitizeId(originalId)] = { type, url: resolveUrl(asset.src) };
  }

  return { assets };
}
