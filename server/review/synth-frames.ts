// Owned by S5b. Four deterministic frames with known faults, to check a vision reviewer without a browser or a film.
import { join } from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';

export type SynthName = 'clean' | 'text-over-product' | 'low-contrast' | 'product-missing';
export interface SynthFrame {
  name: SynthName;
  atSec: number;
  jpeg: Buffer;
  expected: { pass: boolean; kinds: string[] };
}

const W = 1280;
const H = 720;
const SEED = join(process.cwd(), 'fixtures', 'seed');
const MUG = { height: 400, centreX: 640, bottom: 560 };
const CAPTION = 'Slow mornings';

/** A caption, optionally on a dark translucent bar. All coordinates are in the 1280x720 frame. */
function caption(o: { y: number; bar: boolean }): Buffer {
  const bar = o.bar ? `<rect x="240" y="${o.y - 62}" width="800" height="92" rx="14" fill="rgb(0,0,0)" fill-opacity="0.6"/>` : '';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${bar}<text x="${W / 2}" y="${o.y}" font-family="Helvetica, Arial, sans-serif" font-size="60" font-weight="700" text-anchor="middle" fill="#ffffff">${CAPTION}</text></svg>`,
  );
}

export async function makeSyntheticFrames(): Promise<SynthFrame[]> {
  const plate = await sharp(join(SEED, 'cafe-plate.jpg')).resize(W, H, { fit: 'cover' }).png().toBuffer();
  const cutout = await sharp(join(SEED, 'mug-cutout-rgba.png')).resize({ height: MUG.height }).png().toBuffer();
  const { width: mugW } = await sharp(cutout).metadata();
  const mug = { input: cutout, left: Math.round(MUG.centreX - (mugW ?? 600) / 2), top: MUG.bottom - MUG.height };

  const render = (layers: OverlayOptions[]) => sharp(plate).composite(layers).jpeg({ quality: 85 }).toBuffer();
  const at = (name: SynthName, jpeg: Buffer, expected: SynthFrame['expected']): SynthFrame => ({ name, atSec: 1.0, jpeg, expected });

  return [
    // the caption sits on a dark bar below the mug: nothing wrong
    at('clean', await render([mug, { input: caption({ y: 650, bar: true }) }]), { pass: true, kinds: [] }),
    // the same bar and caption, but across the mug's body
    at('text-over-product', await render([mug, { input: caption({ y: 450, bar: true }) }]), { pass: false, kinds: ['text-over-product'] }),
    // white text straight onto the bright window, no bar
    at('low-contrast', await render([mug, { input: caption({ y: 110, bar: false }) }]), { pass: false, kinds: ['low-contrast'] }),
    // the product is not in the picture at all
    at('product-missing', await render([{ input: caption({ y: 650, bar: true }) }]), { pass: false, kinds: ['product-hidden'] }),
  ];
}
