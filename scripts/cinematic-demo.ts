// The cinematic film on the saved can, offline and free: the label unwrapped from a cut-out already in ./data/assets, a beat sheet
// (the director's floor sheet), and PLACEHOLDER ingredients drawn locally (a brown ellipse for a bean, white blobs for the splash and milk),
// so the camera, the swarms and the timing can be checked before any Muse picture is paid for. Writes the film where the stage-check
// viewer reads it. It needs an engine with aep-32 (schema 1.12.0); on an older engine the viewer reports the schema error.
// Usage: npx tsx scripts/cinematic-demo.ts [cutoutAssetId] [aspect] [out.json] [--sale]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { checkBeatSheet, defaultBeatSheet, totalSeconds } from '../server/authoring/beatsheet';
import { buildCinematicFilm } from '../server/authoring/cinematic-film';
import { FLOOR, floorElements, glassAsset, type IngredientAsset } from '../server/authoring/ingredients';
import type { Aspect } from '../server/authoring/types';
import { prepareProduct3D, type PrepareCache, type Prepared3D } from '../server/product3d/prepare';
import { createAssetStore } from '../server/store/asset-store';

const LABELS = './data/hero3d-labels.json';
const [cut = 'ast_2a171cef49d92850819dc9607f18a534', aspect = '9:16', out = 'web/public/cartoon/cinematic-clip.json'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const sale = process.argv.includes('--sale');
const assets = createAssetStore({ dir: './data', publicBaseUrl: '' });

const saved: Record<string, Prepared3D> = existsSync(LABELS) ? JSON.parse(readFileSync(LABELS, 'utf8')) : {};
const cache: PrepareCache = new Map();
for (const [k, v] of Object.entries(saved)) if (await assets.has(v.texture.id)) cache.set(k, v);
const prep = await prepareProduct3D(assets, { cutoutAssetId: cut, shape: 'can' }, cache);
writeFileSync(LABELS, JSON.stringify(Object.fromEntries(cache), null, 2));
if (prep.shape === 'other') throw new Error('no straight can body in the cut-out; the cinematic film needs a round pack');

const png = (svg: string) => sharp(Buffer.from(svg)).png().toBuffer();
const put = async (svg: string, w: number, h: number) => {
  const a = await assets.put(await png(svg), 'image/png', { role: 'cutout', width: w, height: h });
  return { id: a.id, src: `/api/assets/${a.id}`, width: w, height: h };
};
const splash = (n: number) => {
  const r = 40 + n * 55;
  const dots = Array.from({ length: 8 }, (_, k) => `<circle cx="${256 + Math.cos(k) * r}" cy="${300 - n * 30 + Math.sin(k) * r * 0.5}" r="${10 + (k % 3) * 4}" fill="#ece3d6"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><ellipse cx="256" cy="320" rx="${r}" ry="${r * 0.35}" fill="#d9c7ae" opacity="0.9"/>${dots}</svg>`;
};
const elements = floorElements('Coffee Co. Cold Brew', 'drinks');
const ing: Record<string, IngredientAsset> = { ice: glassAsset(FLOOR.ice!) };
const beanSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="64"><ellipse cx="64" cy="32" rx="60" ry="28" fill="#4a2c18"/><path d="M8 32 Q64 20 120 32" stroke="#26140a" stroke-width="5" fill="none"/></svg>';
const contour: Array<[number, number]> = Array.from({ length: 24 }, (_, k) => [Math.round(64 + Math.cos((k / 24) * 2 * Math.PI) * 60), Math.round(32 + Math.sin((k / 24) * 2 * Math.PI) * 28)]);
ing.bean = { kind: 'bean', use: 'solid', sizeM: FLOOR.bean!.sizeM, frames: [await put(beanSvg, 128, 64)], contour, side: '#3b2416' };
ing.splash = { kind: 'splash', use: 'card', sizeM: FLOOR.splash!.sizeM, frames: [await put(splash(0), 512, 512), await put(splash(1), 512, 512), await put(splash(2), 512, 512), await put(splash(3), 512, 512)] };
ing.milk = { kind: 'milk', use: 'card', sizeM: FLOOR.milk!.sizeM, frames: [await put(splash(2), 512, 512)] };

const sheet = defaultBeatSheet(elements);
const clip = buildCinematicFilm({
  aspect: aspect as Aspect,
  sheet,
  texture: { id: prep.texture.id, src: `/api/assets/${prep.texture.id}`, width: prep.texture.width ?? 2048, height: prep.texture.height ?? 1024, kind: prep.textureKind },
  shape: prep.shape,
  side: prep.side,
  productAspect: prep.aspect,
  title: 'Coffee Co. Cold Brew',
  brand: 'Coffee Co.',
  price: sale ? 3.99 : 4.5,
  ...(sale ? { wasPrice: 4.75 } : {}),
  currency: 'USD',
  accent: '#c27a3a',
  ingredients: ing,
});
writeFileSync(out, JSON.stringify(clip));
console.log(`sheet ${totalSeconds(sheet)} s, ${sheet.beats.length} shots, rule breaks: ${checkBeatSheet(sheet, elements).length}`);
for (const b of sheet.beats) console.log(`  ${b.seconds.toFixed(1)} s  ${b.size.padEnd(6)} ${b.move.padEnd(10)} ${b.ingredient ? `${b.ingredient.kind} ${b.ingredient.action}` : ''}`);
console.log(`label ${prep.texture.id} -> ${out}`);
