// Owned by S13a. From the film's product cut-out to the texture assets a 3D layer wears, once per film (design sections 3.1 and 5).
import sharp from 'sharp';
import type { AssetRef } from '@shared/composition';
import type { AssetStore } from '@shared/ports';
import { boxFaces } from './box';
import { hexOf, sideColour } from './colour';
import { maskContour, type Point } from './contour';
import type { Rgba } from './pixels';
import type { PrimitiveShape } from './types';
import { findBodyBand, unwrapCylinder, LABEL_HEIGHT, LABEL_WIDTH } from './unwrap';

export type ProductShape = PrimitiveShape | 'other';

/** Shapes whose body is a cylinder: the photo is unwrapped into a label. */
const ROUND: readonly ProductShape[] = ['can', 'bottle', 'jar', 'tube'];
/** Shapes whose front is the photo itself. */
const FLAT: readonly ProductShape[] = ['box', 'pouch'];

export interface Prepared3D {
  /** The shape actually built: a round shape with no straight body falls back to 'other'. */
  shape: ProductShape;
  /** The wrapped label (round shapes) or the front face (flat shapes and 'other'): an image asset of role 'label'. */
  texture: AssetRef;
  textureKind: 'label' | 'front';
  /** Side colour as #rrggbb. */
  side: string;
  /** Height over width of the product, for the primitive's proportions. */
  aspect: number;
  /** The outline in the front image's own pixels, for an extruded cut-out. */
  contour?: Point[];
  /** Set when the requested shape could not be built and another was used. */
  fallback?: 'extrude';
}

export interface PrepareInput {
  cutoutAssetId: string;
  shape: ProductShape;
  filmId?: string;
  sceneId?: string;
}

/** Remembers what was made per cut-out and shape, so a film does the image work once. */
export type PrepareCache = Map<string, Prepared3D>;
export const newPrepareCache = (): PrepareCache => new Map();
const sharedCache: PrepareCache = new Map();

async function decode(png: Buffer): Promise<Rgba> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) };
}
const encode = (data: Uint8ClampedArray, width: number, height: number): Promise<Buffer> =>
  sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } }).png().toBuffer();

/** The smallest box that holds every opaque pixel, as a cropped copy. */
function trim(img: Rgba): Rgba {
  let [x0, y0, x1, y1] = [img.width, img.height, -1, -1];
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[(y * img.width + x) * 4 + 3]! > 127) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return img;
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) data.set(img.data.subarray(((y + y0) * img.width + x0) * 4, ((y + y0) * img.width + x0 + width) * 4), y * width * 4);
  return { width, height, data };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Turns the cut-out into the 3D textures for `shape` and stores them. Round shapes are unwrapped from the body band;
 * boxes and pouches keep the photo as the front face; anything else, or a round shape with no straight body, is outlined for extrusion.
 * A second call with the same cut-out and shape returns the first result and stores nothing.
 */
export async function prepareProduct3D(assets: AssetStore, input: PrepareInput, cache: PrepareCache = sharedCache): Promise<Prepared3D> {
  const key = `${input.cutoutAssetId}:${input.shape}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const cut = trim(await decode(await assets.read(input.cutoutAssetId)));
  const meta = { role: 'label' as const, ...(input.sceneId ? { sceneId: input.sceneId } : {}), ...(input.filmId ? { filmId: input.filmId } : {}) };
  let result: Prepared3D;

  const band = ROUND.includes(input.shape) ? findBodyBand(cut) : null;
  if (band) {
    const side = sideColour(cut, band);
    const out = unwrapCylinder(cut, band, side);
    const texture = await assets.put(await encode(out.data, LABEL_WIDTH, LABEL_HEIGHT), 'image/png', { ...meta, width: LABEL_WIDTH, height: LABEL_HEIGHT });
    result = { shape: input.shape, texture, textureKind: 'label', side: hexOf(side), aspect: round3(cut.height / (band.r * 2)) };
  } else if (FLAT.includes(input.shape)) {
    const faces = boxFaces(cut);
    const texture = await assets.put(await encode(faces.front, faces.frontSize.width, faces.frontSize.height), 'image/png', { ...meta, ...faces.frontSize });
    result = { shape: input.shape, texture, textureKind: 'front', side: hexOf(faces.side), aspect: round3(cut.height / cut.width) };
  } else {
    // an odd shape, or a round one with no straight body: extrude the outline, with the photo as its front
    const contour = maskContour(cut);
    if (contour.length < 3) throw new Error('the product cut-out has no outline to extrude');
    const xs = contour.map((p) => p[0]);
    const ys = contour.map((p) => p[1]);
    const box = { x: Math.max(0, Math.floor(Math.min(...xs))), y: Math.max(0, Math.floor(Math.min(...ys))) };
    const w = Math.min(cut.width - box.x, Math.ceil(Math.max(...xs)) - box.x);
    const h = Math.min(cut.height - box.y, Math.ceil(Math.max(...ys)) - box.y);
    // the front image maps over the contour's bounding box, so the photo is cropped to it and the contour is moved to match
    const front: Rgba = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    for (let y = 0; y < h; y++) front.data.set(cut.data.subarray(((y + box.y) * cut.width + box.x) * 4, ((y + box.y) * cut.width + box.x + w) * 4), y * w * 4);
    const moved = contour.map(([x, y]) => [round3(x - box.x), round3(y - box.y)] as Point);
    const side = sideColour(front, { top: 0, bottom: h - 1, cx: w / 2, r: w / 2 });
    const texture = await assets.put(await encode(front.data, w, h), 'image/png', { ...meta, width: w, height: h });
    result = { shape: 'other', texture, textureKind: 'front', side: hexOf(side), aspect: round3(h / w), contour: moved, ...(input.shape !== 'other' ? { fallback: 'extrude' as const } : {}) };
  }
  cache.set(key, result);
  return result;
}
