// The 3D hero clip on a cut-out already in ./data/assets, offline and free: unwraps the label (prepareProduct3D), builds the clip
// and writes it where the stage-check viewer can read it. The label made for a cut-out is remembered in ./data/hero3d-labels.json,
// so a rerun reuses it instead of storing another copy.
// Usage: npx tsx scripts/hero3d-demo.ts [cutoutAssetId] [aspect] [out.json] [--sale]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildHero3DClip } from '../server/authoring/hero3d-clip';
import type { Aspect } from '../server/authoring/types';
import { prepareProduct3D, type PrepareCache, type Prepared3D } from '../server/product3d/prepare';
import { createAssetStore } from '../server/store/asset-store';

const LABELS = './data/hero3d-labels.json';
const [cut = 'ast_2a171cef49d92850819dc9607f18a534', aspect = '9:16', out = 'web/public/cartoon/hero3d-clip.json'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const sale = process.argv.includes('--sale');
const assets = createAssetStore({ dir: './data', publicBaseUrl: '' });
// the cache prepareProduct3D keeps per process, seeded from the file with entries whose label is still stored
const saved: Record<string, Prepared3D> = existsSync(LABELS) ? JSON.parse(readFileSync(LABELS, 'utf8')) : {};
const cache: PrepareCache = new Map();
for (const [k, v] of Object.entries(saved)) if (await assets.has(v.texture.id)) cache.set(k, v);
const prep = await prepareProduct3D(assets, { cutoutAssetId: cut, shape: 'can' }, cache);
writeFileSync(LABELS, JSON.stringify(Object.fromEntries(cache), null, 2));
if (prep.shape === 'other') throw new Error('no straight can body in the cut-out; the hero-3d look needs a round pack');
const clip = buildHero3DClip({
  aspect: aspect as Aspect,
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
});
writeFileSync(out, JSON.stringify(clip));
console.log(`label ${prep.texture.id} (${prep.textureKind}), side ${prep.side}, aspect ${prep.aspect} -> ${out}`);
