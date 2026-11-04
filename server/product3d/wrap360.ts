// A round label that goes all the way round: the front half is today's unwrap of the photo, the back half the unwrap of the drawn back.
import type { Buffer } from 'node:buffer';
import { decode, encode, trim } from './codec';
import { sideColour } from './colour';
import { findBodyBand, unwrapCylinder, LABEL_HEIGHT, LABEL_WIDTH } from './unwrap';

/** The strip wears the photo up to this angle either side of the front, then crosses to the drawn back over the same span again. */
const SEAM = { from: 85, to: 95 } as const;

async function unwrapped(png: Buffer): Promise<Uint8ClampedArray | undefined> {
  const cut = trim(await decode(png));
  const band = findBodyBand(cut);
  if (!band) return undefined;
  return unwrapCylinder(cut, band, sideColour(cut, band)).data;
}

/**
 * The 2048 x 1024 strip of a round product. Columns for -90..+90 degrees come from the front's unwrap unchanged; the columns round the other side from the
 * back view's unwrap (its centre column is the strip's 180 degrees); the two are blended across a 10 degree seam at each side. Same size and
 * angle-to-column mapping as unwrapCylinder, so the renderer needs no change. Undefined when either view has no straight body band.
 */
export async function wrapStrip(o: { front: Buffer; back: Buffer }): Promise<Buffer | undefined> {
  const [front, back] = await Promise.all([unwrapped(o.front), unwrapped(o.back)]);
  if (!front || !back) return undefined;
  const out = new Uint8ClampedArray(front.length);
  for (let u = 0; u < LABEL_WIDTH; u++) {
    const theta = ((u + 0.5) / LABEL_WIDTH - 0.5) * 360;
    const a = Math.abs(theta);
    const wFront = a <= SEAM.from ? 1 : a >= SEAM.to ? 0 : (SEAM.to - a) / (SEAM.to - SEAM.from);
    const phi = theta - 180 * Math.sign(theta);
    const ub = Math.min(LABEL_WIDTH - 1, Math.max(0, Math.round((phi / 360 + 0.5) * LABEL_WIDTH - 0.5)));
    for (let v = 0; v < LABEL_HEIGHT; v++) {
      const i = (v * LABEL_WIDTH + u) * 4;
      const j = (v * LABEL_WIDTH + ub) * 4;
      for (let c = 0; c < 4; c++) out[i + c] = wFront === 1 ? front[i + c]! : Math.round(front[i + c]! * wFront + back[j + c]! * (1 - wFront));
    }
  }
  return encode(out, LABEL_WIDTH, LABEL_HEIGHT);
}
