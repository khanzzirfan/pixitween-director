import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import type { AssetRef } from '@shared/composition';
import type { SamObject } from '@shared/ports';
import type { ToolCtx } from '@shared/tools';
import { alphaCutout, imageSize } from '../media/image';
import { backdropColor, whiteKeyAlpha } from './cutout-sheet';
import { ArtError } from './errors';
import { charge, emitAsset } from './events';
import { PRICE } from './prices';
import { trimBox } from './geometry';

export const STUB_OWNER = 'S4' as const;
const cache = new Map<
  string,
  Promise<{ cutout: AssetRef; mask: AssetRef; bounds: SamObject['bounds']; confidence?: number; objectId: string }>
>();
/** The word and the confidence the second try uses when SAM finds nothing by the name asked for. */
const FALLBACK_NOUN = 'product';
const FALLBACK_CONFIDENCE = 0.35;

export function selectObject(objects: SamObject[], minConfidence = 0.5): SamObject | undefined {
  return objects
    .filter((obj) => obj.confidence === undefined || obj.confidence >= minConfidence)
    .sort((a, b) => {
      const area = (x: SamObject) => (x.bounds.right - x.bounds.left) * (x.bounds.bottom - x.bounds.top);
      return area(b) - area(a) || (b.confidence ?? 1) - (a.confidence ?? 1) || a.objectId.localeCompare(b.objectId);
    })[0];
}
/** The box round every pixel above half alpha, and how much of the frame it covers; undefined when there is none. */
function inkBox(alpha: Uint8Array | Buffer, width: number, height: number): { box: SamObject['bounds']; frac: number } | undefined {
  let ink = 0;
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x]! <= 128) continue;
      ink++;
      if (x < left) left = x;
      if (y < top) top = y;
      if (x + 1 > right) right = x + 1;
      if (y + 1 > bottom) bottom = y + 1;
    }
  }
  return right > left ? { box: { left, top, right, bottom }, frac: ink / (width * height) } : undefined;
}

/**
 * Only the backdrop that touches the frame's edge is backdrop: a keyed pixel stays clear when it is joined to the border through other
 * clear pixels, and every other one is part of the product (a cream can, a white cap, a pale label inside the outline). Changes `alpha`.
 */
export function keepEnclosed(alpha: Uint8Array, width: number, height: number): Uint8Array {
  const outside = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!outside[i] && alpha[i]! < 128) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (i >= width) push(i - width);
    if (i < (height - 1) * width) push(i + width);
  }
  for (let i = 0; i < alpha.length; i++) if (!outside[i] && alpha[i]! < 128) alpha[i] = 255;
  return alpha;
}

/**
 * A photo that is already cut out (a PNG or WebP with a clear background) needs no model: its own alpha is the mask. Returns nothing when
 * the photo has no alpha, or the edge of the frame is not clear, or the clear part is almost all or almost none of it.
 */
export async function ownAlpha(source: Buffer): Promise<SamObject | undefined> {
  try {
    const img = sharp(source);
    if (!(await img.metadata()).hasAlpha) return undefined;
    const { data, info } = await img.ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    let edge = 0;
    let clear = 0;
    const at = (x: number, y: number) => {
      edge++;
      if (data[y * width + x]! < 16) clear++;
    };
    for (let x = 0; x < width; x++) {
      at(x, 0);
      at(x, height - 1);
    }
    for (let y = 1; y < height - 1; y++) {
      at(0, y);
      at(width - 1, y);
    }
    if (clear / edge < 0.6) return undefined;
    const ink = inkBox(data, width, height);
    if (!ink || ink.frac < 0.02 || ink.frac > 0.95) return undefined;
    return { objectId: 'own-alpha', bounds: ink.box, alpha: Buffer.from(data), confidence: 1 };
  } catch {
    return undefined;
  }
}

/**
 * A pack shot on a near-white studio sweep can be keyed without a model. Returns nothing when the border is not light, or when keying
 * removes almost everything or almost nothing (a white product, or a photo that only happens to have a light edge). Only the light
 * backdrop joined to the frame's edge is removed, so a light product (cream, white, silver) keeps its body.
 */
export async function studioKey(source: Buffer): Promise<SamObject | undefined> {
  try {
    const { width, height } = await imageSize(source);
    const rgb = await sharp(source).removeAlpha().raw().toBuffer();
    const bg = backdropColor(rgb, width, height);
    if (bg[0] < 210 || bg[1] < 210 || bg[2] < 210) return undefined;
    const alpha = keepEnclosed(whiteKeyAlpha(rgb, width, height, bg), width, height);
    const ink = inkBox(alpha, width, height);
    if (!ink || ink.frac < 0.02 || ink.frac > 0.72) return undefined;
    return { objectId: 'studio-key', bounds: ink.box, alpha: Buffer.from(alpha), confidence: 1 };
  } catch {
    return undefined;
  }
}

/**
 * The last resort when SAM finds nothing by any word: a product shot on a plain backdrop of any colour (a grey, a beige or a coloured sweep) is keyed
 * by its distance from the border colour, keeping only what the backdrop's own edge does not reach. Returns nothing when the border is not one colour
 * (nine tenths of its pixels within 40 of the median), or the key removes almost nothing or almost everything.
 */
export async function plainKey(source: Buffer): Promise<SamObject | undefined> {
  try {
    const { width, height } = await imageSize(source);
    const rgb = await sharp(source).removeAlpha().raw().toBuffer();
    const bg = backdropColor(rgb, width, height);
    let near = 0;
    let total = 0;
    const probe = (x: number, y: number) => {
      total++;
      const i = (y * width + x) * 3;
      if (Math.max(Math.abs(rgb[i]! - bg[0]), Math.abs(rgb[i + 1]! - bg[1]), Math.abs(rgb[i + 2]! - bg[2])) <= 40) near++;
    };
    for (let x = 0; x < width; x += 2) {
      probe(x, 0);
      probe(x, height - 1);
    }
    for (let y = 0; y < height; y += 2) {
      probe(0, y);
      probe(width - 1, y);
    }
    if (near / total < 0.9) return undefined;
    const alpha = keepEnclosed(whiteKeyAlpha(rgb, width, height, bg), width, height);
    const ink = inkBox(alpha, width, height);
    if (!ink || ink.frac < 0.02 || ink.frac > 0.72) return undefined;
    return { objectId: 'plain-key', bounds: ink.box, alpha: Buffer.from(alpha), confidence: 0.5 };
  } catch {
    return undefined;
  }
}

/**
 * A colour key is only trusted when it is solid: of the pixels it keeps, at most this share may be part see-through. A product close to its backdrop's
 * colour (a cream can on a pale grey sweep) keys as a ghost, half of it see-through, and is built into a sliver of itself; a clean key is about 1 %.
 */
export const KEY_SEMI_MAX = 0.2;

/** Of the pixels a mask keeps (alpha above 16), the share that is part see-through (below 200). 1 for an empty mask. */
export function semiShare(alpha: Uint8Array): number {
  let kept = 0;
  let semi = 0;
  for (const a of alpha) {
    if (a <= 16) continue;
    kept++;
    if (a < 200) semi++;
  }
  return kept ? semi / kept : 1;
}

/**
 * A SAM answer must cover most of what the photo shows against its backdrop: asked for "yoghurt", SAM can hand back the strawberry printed on
 * the pot, which would be built into a red blob. Of the pixels the colour key marks as the product, at least this share must lie inside the mask.
 */
export const COVER_MIN = 0.6;
/** A named answer this sure is cut from even when it covers less of the plain-backdrop reference than COVER_MIN (the reference may include a prop the product stands on). */
export const SURE_CONFIDENCE = 0.9;

/** Of the pixels `reference` marks as product (alpha above 16), the share that `mask` keeps (alpha above 127). 1 when the reference is empty. */
export function coverage(mask: Uint8Array, reference: Uint8Array): number {
  let total = 0;
  let inside = 0;
  for (let i = 0; i < reference.length; i++) {
    if (reference[i]! <= 16) continue;
    total++;
    if (mask[i]! > 127) inside++;
  }
  return total ? inside / total : 1;
}

/** The key, when it is solid enough to build from; otherwise nothing, so the cut-out goes on to SAM. */
const solidKey = (o: SamObject | undefined): SamObject | undefined => (o && semiShare(o.alpha) <= KEY_SEMI_MAX ? o : undefined);

export async function cutout(
  ctx: ToolCtx,
  o: { source: Buffer; noun: string; /** other words to ask SAM for when the first finds nothing, one call each, in order */ alsoTry?: string[]; sceneId?: string; minConfidence?: number; feather?: number; cacheKey?: string },
): Promise<{ cutout: AssetRef; mask: AssetRef; bounds: SamObject['bounds']; confidence?: number; objectId: string }> {
  if (o.cacheKey && cache.has(o.cacheKey)) return cache.get(o.cacheKey)!;
  const pending = (async () => {
    const { width, height } = await imageSize(o.source);
    // a photo already cut out keeps its own edge; a studio pack shot is keyed; anything else goes to SAM
    const keyed = (await ownAlpha(o.source)) ?? solidKey(await studioKey(o.source));
    // SAM answers to the word it is given (it finds "goggles" at 0.9 and "product" at nothing), so each word is tried in turn; a word that
    // finds something only just under the bar is kept, and used when no word clears it
    const bar = o.minConfidence ?? 0.5;
    let object = keyed;
    let loose: SamObject | undefined;
    // a named object SAM is sure of (a mug on its coaster: the mug is found at 0.96, the coaster is not part of it) that the coverage check
    // refused; used only when nothing else was found, so the film is cut from it instead of failing
    let sure: SamObject | undefined;
    // what the photo shows against its backdrop, when the backdrop is one colour: an answer that misses most of it found a part, not the product
    const reference = keyed ? undefined : (await plainKey(o.source))?.alpha;
    const whole = (c: SamObject | undefined): SamObject | undefined => (c && (!reference || coverage(c.alpha, reference) >= COVER_MIN) ? c : undefined);
    if (!keyed) {
      for (const word of [o.noun, ...(o.alsoTry ?? [])]) {
        const found = await ctx.meta.sam.segmentImage(o.source, word);
        charge(ctx, 'sam-3.1', '1 image', PRICE.samImageUsd);
        object = whole(selectObject(found, bar));
        if (object) break;
        loose ??= whole(selectObject(found, Math.min(bar, FALLBACK_CONFIDENCE)));
        const top = selectObject(found, SURE_CONFIDENCE);
        if (top && (top.confidence ?? 0) > (sure?.confidence ?? 0)) sure = top;
      }
      object ??= loose;
    }
    // the name asked for is a guess (a model's word, or the last word of a product title): when SAM finds nothing by it, ask once
    // more for the most general word, a little less strictly, before giving up
    if (!object && !keyed) {
      const generic = o.noun.toLowerCase() === FALLBACK_NOUN ? 'object' : FALLBACK_NOUN;
      object = whole(selectObject(await ctx.meta.sam.segmentImage(o.source, generic), Math.min(o.minConfidence ?? 0.5, FALLBACK_CONFIDENCE)));
      charge(ctx, 'sam-3.1', '1 image', PRICE.samImageUsd);
    }
    // no word found it: a product on a plain backdrop can still be keyed by colour, for nothing
    if (!object && !keyed) object = solidKey(await plainKey(o.source));
    if (!object && !keyed) object = sure;
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
