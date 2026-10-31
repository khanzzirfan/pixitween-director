// Builds the retail-clip template on two saved assets (no model call) and writes a film JSON to view at
// /stage-check.html?film=live&file=/cartoon/<out>. Usage: npx tsx scripts/retail-demo.ts [look|auto] [aspect] [frame] [out.json]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { LOOKS, pickLook, type LookId } from '../server/authoring/looks';
import { buildRetailClip } from '../server/authoring/retail-clip';

const [lookArg = 'auto', aspectArg = '9:16', frameArg, outArg] = process.argv.slice(2);
const aspect = aspectArg as '9:16' | '16:9' | '1:1';
const product = { id: 'ast_5f70b53ecd06e5ce73d07b8d26bd69f0', src: '/api/assets/ast_5f70b53ecd06e5ce73d07b8d26bd69f0', width: 256, height: 752 };
const title = 'Coffee Co. Cold Brew 330ml';
const pick = pickLook({ title, category: 'beverage', width: product.width, height: product.height });
const look = (lookArg === 'auto' ? pick.look : lookArg) as LookId;
if (!LOOKS[look]) throw new Error(`unknown look '${lookArg}'; one of: auto, ${Object.keys(LOOKS).join(', ')}`);
// the look's own plate from `npm run live -- s18-look-plates` when there is one, else the stock cafe plate
const PLATES = 'web/public/cartoon/look-plates.json';
const made = existsSync(PLATES) ? (JSON.parse(readFileSync(PLATES, 'utf8')) as Record<string, { id: string; width: number; height: number }>)[look] : undefined;
const plate = made
  ? { id: made.id, src: `/api/assets/${made.id}`, width: made.width, height: made.height }
  : { id: 'ast_e7b2d1aa618305df4333d651eef26655', src: '/api/assets/ast_e7b2d1aa618305df4333d651eef26655', width: 720, height: 1280 };
const clip = buildRetailClip({
  aspect,
  look,
  plate,
  product,
  title,
  subtitle: '330 ml  |  Smooth, low acid',
  price: 4.5,
  ...(look === 'price-promo' ? { wasPrice: 5.99 } : {}),
  brand: 'Coffee Co.',
  accent: '#7a3b12',
  frame: frameArg === 'frame',
});
const out = `web/public/cartoon/${outArg ?? 'retail-clip.json'}`;
writeFileSync(out, JSON.stringify(clip, null, 2));
console.log(`wrote ${out} (${look}${made ? ', own plate' : ', stock plate'}${lookArg === 'auto' ? `: ${pick.why}` : ''}, ${aspect})`);
