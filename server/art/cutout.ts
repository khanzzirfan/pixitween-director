import type { Buffer } from 'node:buffer';
import sharp from 'sharp';
import type { AssetRef } from '@shared/composition';
import type { SamObject } from '@shared/ports';
import type { ToolCtx } from '@shared/tools';
import { alphaCutout, imageSize } from '../media/image';
import { ArtError } from './errors';
import { charge, emitAsset } from './events';
import { PRICE } from './prices';
import { trimBox } from './geometry';

export const STUB_OWNER = 'S4' as const;
const cache = new Map<
  string,
  Promise<{ cutout: AssetRef; mask: AssetRef; bounds: SamObject['bounds']; confidence?: number; objectId: string }>
>();
export function selectObject(objects: SamObject[], minConfidence = 0.5): SamObject | undefined {
  return objects
    .filter((obj) => obj.confidence === undefined || obj.confidence >= minConfidence)
    .sort((a, b) => {
      const area = (x: SamObject) => (x.bounds.right - x.bounds.left) * (x.bounds.bottom - x.bounds.top);
      return area(b) - area(a) || (b.confidence ?? 1) - (a.confidence ?? 1) || a.objectId.localeCompare(b.objectId);
    })[0];
}
export async function cutout(
  ctx: ToolCtx,
  o: { source: Buffer; noun: string; sceneId?: string; minConfidence?: number; feather?: number; cacheKey?: string },
): Promise<{ cutout: AssetRef; mask: AssetRef; bounds: SamObject['bounds']; confidence?: number; objectId: string }> {
  if (o.cacheKey && cache.has(o.cacheKey)) return cache.get(o.cacheKey)!;
  const pending = (async () => {
    const { width, height } = await imageSize(o.source);
    const objects = await ctx.meta.sam.segmentImage(o.source, o.noun);
    charge(ctx, 'sam-3.1', '1 image', PRICE.samImageUsd);
    const object = selectObject(objects, o.minConfidence ?? 0.5);
    if (!object) throw new ArtError('no-object', `no ${o.noun} found in the photo`);
    if (object.alpha.length !== width * height)
      throw new ArtError('alpha-size-mismatch', `SAM alpha length ${object.alpha.length} does not match ${width}x${height}`);
    const rgba = await alphaCutout(o.source, object.alpha, { feather: o.feather ?? 1.5 });
    const bounds = trimBox(object.bounds, width, height);
    const w = bounds.right - bounds.left,
      h = bounds.bottom - bounds.top;
    let cutPng: Buffer;
    try {
      cutPng = await sharp(rgba).extract({ left: bounds.left, top: bounds.top, width: w, height: h }).png().toBuffer();
    } catch {
      throw new ArtError('bad-image', 'could not crop SAM cutout');
    }
    const mask = await sharp(object.alpha, { raw: { width, height, channels: 1 } })
      .extract({ left: bounds.left, top: bounds.top, width: w, height: h })
      .png()
      .toBuffer();
    const [cutRef, maskRef] = await Promise.all([
      ctx.assets.put(cutPng, 'image/png', { role: 'cutout', sceneId: o.sceneId, width: w, height: h }),
      ctx.assets.put(mask, 'image/png', { role: 'mask', sceneId: o.sceneId, width: w, height: h }),
    ]);
    emitAsset(ctx, cutRef);
    emitAsset(ctx, maskRef);
    return {
      cutout: cutRef,
      mask: maskRef,
      bounds,
      ...(object.confidence !== undefined ? { confidence: object.confidence } : {}),
      objectId: object.objectId,
    };
  })();
  if (o.cacheKey) cache.set(o.cacheKey, pending);
  try {
    return await pending;
  } catch (e) {
    if (o.cacheKey) cache.delete(o.cacheKey);
    throw e;
  }
}
