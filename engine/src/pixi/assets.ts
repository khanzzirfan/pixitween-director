import { Assets } from 'pixi.js';
import type { Texture } from 'pixi.js';
import type { MotionDoc } from '../schema';

export type ImageLoader = (url: string) => Promise<Texture>;
export type ImageUnloader = (url: string) => Promise<void>;

export interface LoadedImageAssets {
  textures: Map<string, Texture>;
  errors: Array<{ assetId: string; error: unknown }>;
}

type SettledImage =
  | { assetId: string; texture: Texture }
  | { assetId: string; error: unknown };

/**
 * Request every `type: "image"` asset in parallel. A failing asset is reported in
 * `errors` and never stops the others. glTF assets are left to three.js.
 */
export async function loadImageAssets(
  doc: MotionDoc,
  load: ImageLoader = (url) => Assets.load<Texture>(url),
): Promise<LoadedImageAssets> {
  const images = Object.entries(doc.assets).filter(([, asset]) => asset.type === 'image');

  const settled = await Promise.all(
    images.map(async ([assetId, asset]): Promise<SettledImage> => {
      try {
        return { assetId, texture: await load(asset.url) };
      } catch (error) {
        return { assetId, error };
      }
    }),
  );

  const textures = new Map<string, Texture>();
  const errors: Array<{ assetId: string; error: unknown }> = [];
  for (const result of settled) {
    if ('texture' in result) textures.set(result.assetId, result.texture);
    else errors.push({ assetId: result.assetId, error: result.error });
  }

  return { textures, errors };
}

/** Release every image asset. Mirrors `loadImageAssets`; glTF is untouched. */
export async function unloadImageAssets(
  doc: MotionDoc,
  unload: ImageUnloader = (url) => Assets.unload(url),
): Promise<void> {
  const urls = Object.values(doc.assets)
    .filter((asset) => asset.type === 'image')
    .map((asset) => asset.url);
  await Promise.all(urls.map((url) => unload(url)));
}
