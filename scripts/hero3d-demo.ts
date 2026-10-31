// The 3D hero clip on a cut-out already in ./data/assets, offline and free: unwraps the label (prepareProduct3D), builds the clip
// and writes it where the stage-check viewer can read it. Usage: npx tsx scripts/hero3d-demo.ts [cutoutAssetId] [aspect] [out.json] [--sale]
import { writeFileSync } from 'node:fs';
import { buildHero3DClip } from '../server/authoring/hero3d-clip';
import type { Aspect } from '../server/authoring/types';
import { prepareProduct3D } from '../server/product3d/prepare';
import { createAssetStore } from '../server/store/asset-store';

const [cut = 'ast_2a171cef49d92850819dc9607f18a534', aspect = '9:16', out = 'web/public/cartoon/hero3d-clip.json'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const sale = process.argv.includes('--sale');
const assets = createAssetStore({ dir: './data', publicBaseUrl: '' });
const prep = await prepareProduct3D(assets, { cutoutAssetId: cut, shape: 'can' });
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
