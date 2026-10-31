import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import type { AssetRef } from '@shared/composition';
import type { SamObject } from '@shared/ports';
import type { ToolCtx } from '@shared/tools';
import { alphaCutout, imageSize } from '../media/image';
import { ArtError } from './errors';
import { charge, emitAsset } from './events';
import { trimBox } from './geometry';
import { PRICE } from './prices';

// A cut-out sheet: one picture with several pieces of the same thing on a plain backdrop (four stages of a splash in a row, a handful of
// beans), cut out by ONE SAM call into one transparent PNG per piece. Cheaper than a picture per piece, and the pieces share a light and a hand.

export interface SheetPiece {
  asset: AssetRef;
  width: number;
  height: number;
  confidence?: number;
}

/**
 * The pieces SAM found, in reading order: top to bottom by row, then left to right inside a row. Two pieces are in one row when their
 * vertical centres are within half the smaller piece's height. Objects below `minConfidence` or smaller than 1.5 % of the biggest are dropped
 * (specks and dust), and at most `max` of the biggest remain.
 */
export function orderPieces(objects: SamObject[], o: { max: number; minConfidence?: number }): SamObject[] {
  const area = (x: SamObject) => (x.bounds.right - x.bounds.left) * (x.bounds.bottom - x.bounds.top);
  const ok = objects.filter((x) => x.confidence === undefined || x.confidence >= (o.minConfidence ?? 0.5));
  const biggest = Math.max(0, ...ok.map(area));
  const kept = ok
    .filter((x) => area(x) >= biggest * 0.015)
    .sort((a, b) => area(b) - area(a) || a.objectId.localeCompare(b.objectId))
    .slice(0, o.max);
  const cy = (x: SamObject) => (x.bounds.top + x.bounds.bottom) / 2;
  const h = (x: SamObject) => x.bounds.bottom - x.bounds.top;
  const rows: SamObject[][] = [];
  for (const x of [...kept].sort((a, b) => cy(a) - cy(b))) {
    const row = rows.find((r) => Math.abs(cy(r[0]!) - cy(x)) <= Math.min(h(r[0]!), h(x)) / 2);
    if (row) row.push(x);
    else rows.push([x]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.bounds.left - b.bounds.left));
}

/**
 * Cuts every piece out of `source` with one SAM call asking for `noun`. Throws ArtError('no-object') when nothing usable is found.
 * Charges one SAM image. The caller decides what to do with fewer pieces than it asked for.
 */
export async function cutoutSheet(ctx: ToolCtx, o: { source: Buffer; noun: string; max: number; sceneId?: string; feather?: number }): Promise<SheetPiece[]> {
  const { width, height } = await imageSize(o.source);
  const objects = await ctx.meta.sam.segmentImage(o.source, o.noun);
  charge(ctx, 'sam-3.1', '1 image', PRICE.samImageUsd);
  const pieces = orderPieces(objects, { max: o.max });
  if (!pieces.length) throw new ArtError('no-object', `no ${o.noun} found in the sheet`);
  const out: SheetPiece[] = [];
  for (const obj of pieces) {
    if (obj.alpha.length !== width * height) throw new ArtError('alpha-size-mismatch', `SAM alpha length ${obj.alpha.length} does not match ${width}x${height}`);
    const rgba = await alphaCutout(o.source, obj.alpha, { feather: o.feather ?? 1.5 });
    const b = trimBox(obj.bounds, width, height);
    const w = b.right - b.left;
    const h = b.bottom - b.top;
    const png = await sharp(rgba).extract({ left: b.left, top: b.top, width: w, height: h }).png().toBuffer();
    const asset = await ctx.assets.put(png, 'image/png', { role: 'cutout', ...(o.sceneId ? { sceneId: o.sceneId } : {}), width: w, height: h });
    emitAsset(ctx, asset);
    out.push({ asset, width: w, height: h, ...(obj.confidence !== undefined ? { confidence: obj.confidence } : {}) });
  }
  return out;
}

/** The backdrop colour: the median of the sheet's border pixels, per channel (a drawn "white" studio sweep is often 230-245 grey). */
export function backdropColor(rgb: Uint8Array | Buffer, width: number, height: number): [number, number, number] {
  const ch: [number[], number[], number[]] = [[], [], []];
  const take = (x: number, y: number) => {
    for (let c = 0; c < 3; c++) ch[c]!.push(rgb[(y * width + x) * 3 + c]!);
  };
  for (let x = 0; x < width; x += 2) {
    take(x, 0);
    take(x, height - 1);
  }
  for (let y = 0; y < height; y += 2) {
    take(0, y);
    take(width - 1, y);
  }
  const med = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 255;
  return [med(ch[0]), med(ch[1]), med(ch[2])];
}

/**
 * How far a pixel is from the backdrop, as an alpha: 0 within 22 of it (the backdrop's own shading and soft shadows), 255 from 70 away, a
 * ramp between. The distance is the largest channel difference.
 */
export function whiteKeyAlpha(rgb: Uint8Array | Buffer, width: number, height: number, bg: [number, number, number] = [255, 255, 255]): Uint8Array {
  const a = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const d = Math.max(Math.abs(rgb[i * 3]! - bg[0]), Math.abs(rgb[i * 3 + 1]! - bg[1]), Math.abs(rgb[i * 3 + 2]! - bg[2]));
    a[i] = d <= 22 ? 0 : d >= 70 ? 255 : Math.round(((d - 22) / 48) * 255);
  }
  return a;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  ink: number;
}

/**
 * The pieces of a white-backdrop sheet, split at its empty columns: a run of white columns at least 2 % of the width wide separates two
 * pieces (the sheet prompt asks for stages in a row with space between). Each piece is trimmed to its ink; pieces with less than 1.5 % of the
 * biggest piece's ink are dust. At most `max` of the biggest remain, left to right.
 */
export function columnPieces(alpha: Uint8Array, width: number, height: number, max: number): Box[] {
  const col = new Array<number>(width).fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (alpha[y * width + x]! > 128) col[x]!++;
  const gap = Math.max(2, Math.round(width * 0.02));
  const runs: Array<[number, number]> = [];
  let start = -1;
  let empty = 0;
  for (let x = 0; x <= width; x++) {
    const inked = x < width && col[x]! >= 2;
    if (inked) {
      if (start < 0) start = x;
      empty = 0;
    } else if (start >= 0 && ++empty >= gap) {
      runs.push([start, x - empty]);
      start = -1;
      empty = 0;
    }
  }
  if (start >= 0) runs.push([start, width - 1]);
  const boxes = runs.map(([l, r]) => {
    let top = height;
    let bottom = -1;
    let ink = 0;
    for (let y = 0; y < height; y++) {
      for (let x = l; x <= r; x++) {
        if (alpha[y * width + x]! > 128) {
          ink++;
          if (y < top) top = y;
          bottom = y;
        }
      }
    }
    return { left: l, right: r + 1, top, bottom: bottom + 1, ink };
  });
  const biggest = Math.max(0, ...boxes.map((b) => b.ink));
  return boxes
    .filter((b) => b.ink > 0 && b.ink >= biggest * 0.015)
    .sort((a, b) => b.ink - a.ink)
    .slice(0, max)
    .sort((a, b) => a.left - b.left);
}

/**
 * The free fallback when SAM finds nothing: the sheet is keyed against its white backdrop and split at its empty columns. No model call.
 * Throws ArtError('no-object') when the sheet is blank.
 */
export async function whiteKeySheet(ctx: ToolCtx, o: { source: Buffer; max: number; sceneId?: string }): Promise<SheetPiece[]> {
  const { width, height } = await imageSize(o.source);
  const rgb = await sharp(o.source).removeAlpha().raw().toBuffer();
  const alpha = whiteKeyAlpha(rgb, width, height, backdropColor(rgb, width, height));
  const boxes = columnPieces(alpha, width, height, o.max);
  if (!boxes.length) throw new ArtError('no-object', 'the sheet is blank');
  const rgba = await alphaCutout(o.source, Buffer.from(alpha), { feather: 0.8 });
  const out: SheetPiece[] = [];
  for (const b of boxes) {
    const pad = 4;
    const left = Math.max(0, b.left - pad);
    const top = Math.max(0, b.top - pad);
    const w = Math.min(width, b.right + pad) - left;
    const h = Math.min(height, b.bottom + pad) - top;
    const png = await sharp(rgba).extract({ left, top, width: w, height: h }).png().toBuffer();
    const asset = await ctx.assets.put(png, 'image/png', { role: 'cutout', ...(o.sceneId ? { sceneId: o.sceneId } : {}), width: w, height: h });
    emitAsset(ctx, asset);
    out.push({ asset, width: w, height: h });
  }
  return out;
}
