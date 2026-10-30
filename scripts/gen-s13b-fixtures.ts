// Deterministic, offline: the fixture can for the 3D check page. `npx tsx scripts/gen-s13b-fixtures.ts` writes
// fixtures/s13b/three-check.json (a film with one 3D can turning behind and in front of text) and web/public/dev/can-label.png (its label).
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { addLayer, addScene, newFilmComposition, type Comp } from '../server/authoring/api';
import { placeProduct3D } from '../server/product3d/authoring';
import { hexOf, sideColour } from '../server/product3d/colour';
import { stripedCan } from '../server/product3d/test-images';
import { findBodyBand, unwrapCylinder } from '../server/product3d/unwrap';

export const LABEL_ID = 'ast_00000000000000000000000000000c13';
export const LABEL_URL = '/dev/can-label.png';
const OUT = new URL('../fixtures/s13b/three-check.json', import.meta.url);
const LABEL_OUT = new URL('../web/public/dev/can-label.png', import.meta.url);

/** The label of the synthetic striped can, unwrapped exactly as a real product photo would be. */
export async function buildLabel(): Promise<{ png: Buffer; side: string; aspect: number }> {
  const { img } = stripedCan();
  const band = findBodyBand(img)!;
  const side = sideColour(img, band);
  const out = unwrapCylinder(img, band, side);
  const png = await sharp(Buffer.from(out.data.buffer, out.data.byteOffset, out.data.byteLength), { raw: { width: out.width, height: out.height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
  return { png, side: hexOf(side), aspect: Math.round((img.height / (band.r * 2)) * 1000) / 1000 };
}

/** One scene: a dark plate, a headline behind the can (so the turning can hides it), the can, a caption in front. */
export function buildFilm(side: string, aspect: number): Comp {
  let c = newFilmComposition({ aspect: '16:9', title: 'Three check', palette: ['#1f2937'] });
  c = addScene(c, { id: 's1', durationSec: 4, mode: 'motion', intent: 'The can turns in golden light' });
  c = addLayer(c, { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#d9d4c7' });
  c = addLayer(c, { sceneId: 's1', role: 'headline', kind: 'text', text: 'Behind the can', box: { x: 560, y: 420, w: 800, h: 140 }, style: { color: '#7c2d12', size: 120 }, z: 2 });
  c = addLayer(c, { sceneId: 's1', role: 'caption', kind: 'text', text: 'In front of it', box: { x: 560, y: 900, w: 800, h: 90 }, style: { color: '#1f2937' } });
  return placeProduct3D(c, {
    sceneId: 's1',
    box: { x: 760, y: 140, w: 400, h: 740 },
    shape: 'can',
    texture: { id: LABEL_ID, url: LABEL_URL, width: 2048, height: 1024, kind: 'label' },
    side,
    aspect,
    preset: 'studio',
  });
}

export const serialise = (c: Comp): string => `${JSON.stringify(c, null, 1)}\n`;

async function main() {
  const label = await buildLabel();
  writeFileSync(LABEL_OUT, label.png);
  writeFileSync(OUT, serialise(buildFilm(label.side, label.aspect)));
  console.log(`wrote ${OUT.pathname} and ${LABEL_OUT.pathname} (${label.png.length} bytes)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) void main();
