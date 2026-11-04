// The back and side textures of a body: the drawn views laid in the front texture's own box and matched to its colour. Calibration only: views are
// resized, colour-matched and their edge pixels carried out to the outline the body has; nothing is painted.
import type { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { decode, encode, trimPng } from './codec';
import type { Rgba } from './pixels';

const OPAQUE = 127;

const opaque = (img: Rgba, i: number) => img.data[i * 4 + 3]! > OPAQUE;

/** The median of each RGB channel over the pixels `mask` says; undefined when there are none. */
function medianColour(img: Rgba, mask: (i: number) => boolean): number[] | undefined {
  const ch: number[][] = [[], [], []];
  for (let i = 0; i < img.width * img.height; i++) if (mask(i)) for (let c = 0; c < 3; c++) ch[c]!.push(img.data[i * 4 + c]!);
  if (!ch[0]!.length) return undefined;
  return ch.map((v) => v.sort((x, y) => x - y)[v.length >> 1]!);
}

/**
 * Shifts each RGB channel of `view` by the difference of the two pictures' median colours, measured on the pixels each mask says. The median is the colour
 * most of the picture is (the pink sleeve, the white rim), so a plain back is not pulled toward the average of a front that carries art (4 Nov: the
 * back of the tub came out lilac when the mean and spread of the whole front were matched). Changes `view`.
 */
function colourMatch(view: Rgba, front: Rgba, inView: (i: number) => boolean, inFront: (i: number) => boolean): void {
  const a = medianColour(front, inFront);
  const b = medianColour(view, inView);
  if (!a || !b) return;
  for (let i = 0; i < view.width * view.height; i++) {
    if (view.data[i * 4 + 3] === 0) continue;
    for (let c = 0; c < 3; c++) view.data[i * 4 + c] = Math.max(0, Math.min(255, view.data[i * 4 + c]! + a[c]! - b[c]!));
  }
}

/**
 * Gives every pixel that `want` says should be opaque but `img` has clear the colour of the nearest opaque pixel in its row (or, in a row with none, the
 * nearest row that has one): the drawn view's own edge carried out to the outline. Changes `img`'s colours only.
 */
function carryEdges(img: Rgba, want: (i: number) => boolean): void {
  const { width, height, data } = img;
  const rowHas: boolean[] = [];
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const xs: number[] = [];
    for (let x = 0; x < width; x++) if (opaque(img, row + x)) xs.push(x);
    rowHas.push(xs.length > 0);
    if (!xs.length) continue;
    let k = 0;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      if (opaque(img, i) || !want(i)) continue;
      while (k + 1 < xs.length && Math.abs(xs[k + 1]! - x) <= Math.abs(xs[k]! - x)) k++;
      const from = (row + xs[k]!) * 4;
      data[i * 4] = data[from]!;
      data[i * 4 + 1] = data[from + 1]!;
      data[i * 4 + 2] = data[from + 2]!;
    }
  }
  // a row with nothing drawn takes the nearest row that has something, column by column
  for (let y = 0; y < height; y++) {
    if (rowHas[y]) continue;
    let d = 1;
    let src = -1;
    while (src < 0 && d < height) {
      if (y - d >= 0 && rowHas[y - d]) src = y - d;
      else if (y + d < height && rowHas[y + d]) src = y + d;
      d++;
    }
    if (src < 0) return;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!want(i)) continue;
      data.copyWithin(i * 4, (src * width + x) * 4, (src * width + x) * 4 + 3);
    }
  }
}

/**
 * `back` is the back view (a transparent PNG, seen from behind), `front` the front texture as prepareProduct3D stores it. The back is trimmed, resized to
 * exactly the front texture's size and colour-matched to it. Its outline becomes the front's, mirrored (the back half reads the picture mirrored from the
 * front, so this is the body's own outline there): where the drawing falls short of it, its nearest edge pixel in the row is carried out; where it
 * overshoots, it is clear. So the body has no holes at its sides.
 */
export async function backTexture(o: { back: Buffer; front: Buffer }): Promise<Buffer> {
  const front = await decode(o.front);
  const back = await decode(await sharp(await trimPng(o.back)).resize(front.width, front.height, { fit: 'fill' }).png().toBuffer());
  const { width } = front;
  const mirrored = (i: number) => opaque(front, i - (i % width) + (width - 1 - (i % width)));
  colourMatch(back, front, (i) => opaque(back, i) && mirrored(i), (i) => opaque(front, i));
  carryEdges(back, mirrored);
  for (let i = 0; i < width * front.height; i++) back.data[i * 4 + 3] = mirrored(i) ? 255 : 0;
  return encode(back.data, back.width, back.height);
}

/**
 * The side view as the body's side wears it: trimmed, as tall as the front texture, colour-matched to the front, and every row stretched from its own drawn
 * extent to the full width. The body's depth at a row is that row's own (a neck is shallower than the shoulders it stands on), and the drawing's silhouette
 * is narrower there too, so a row that spans the drawing's own extent spans the body's. A row with nothing drawn takes the nearest row that has something.
 */
export async function sideTexture(o: { side: Buffer; front: Buffer }): Promise<Buffer> {
  const front = await decode(o.front);
  const trimmed = await trimPng(o.side);
  const m = await sharp(trimmed).metadata();
  const width = Math.max(1, Math.round(((m.width ?? 1) / (m.height ?? 1)) * front.height));
  const side = await decode(await sharp(trimmed).resize(width, front.height, { fit: 'fill' }).png().toBuffer());
  colourMatch(side, front, (i) => opaque(side, i), (i) => opaque(front, i));
  const out = new Uint8ClampedArray(side.data.length);
  const drawn: Array<[number, number] | undefined> = [];
  for (let y = 0; y < side.height; y++) {
    let [lo, hi] = [-1, -1];
    for (let x = 0; x < width; x++) if (opaque(side, y * width + x)) { if (lo < 0) lo = x; hi = x; }
    drawn.push(lo >= 0 && hi > lo ? [lo, hi] : undefined);
  }
  for (let y = 0; y < side.height; y++) {
    let src = y;
    for (let d = 1; !drawn[src] && d < side.height; d++) src = drawn[y - d] ? y - d : drawn[y + d] ? y + d : src;
    const span = drawn[src];
    for (let x = 0; x < width; x++) {
      const at = span ? span[0] + (x / Math.max(width - 1, 1)) * (span[1] - span[0]) : x;
      const x0 = Math.min(width - 1, Math.floor(at));
      const x1 = Math.min(width - 1, x0 + 1);
      const f = at - x0;
      for (let c = 0; c < 3; c++) out[(y * width + x) * 4 + c] = Math.round(side.data[(src * width + x0) * 4 + c]! * (1 - f) + side.data[(src * width + x1) * 4 + c]! * f);
      out[(y * width + x) * 4 + 3] = 255;
    }
  }
  return encode(out, width, side.height);
}
