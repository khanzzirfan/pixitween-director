// Builds the catalog variant film on the saved can cut-out (no model call) and writes a film JSON to view at
// /stage-check.html?film=live&file=/cartoon/<out>. Usage: npx tsx scripts/variant-demo.ts [aspect] [out.json]
import { writeFileSync } from 'node:fs';
import { buildVariantFilm } from '../server/authoring/variant-film';

const [aspectArg = '9:16', outArg = 'variant-film.json'] = process.argv.slice(2);
const can = { id: 'ast_5f70b53ecd06e5ce73d07b8d26bd69f0', src: '/api/assets/ast_5f70b53ecd06e5ce73d07b8d26bd69f0', width: 256, height: 752 };
const film = buildVariantFilm({
  aspect: aspectArg as '9:16' | '16:9' | '1:1',
  brand: 'Coffee Co.',
  tagline: 'Pick your cold brew',
  accent: '#7a3b12',
  variants: [
    { product: can, name: 'Original', color: '#3b2314', price: 4.5 },
    { product: can, name: 'Vanilla Cream', color: '#e8c872', price: 4.75 },
    { product: can, name: 'Mocha', color: '#a0522d', price: 4.75 },
  ],
  music: { id: 'bed', src: '/cartoon/bed.wav', level: 0.6 },
});
const out = `web/public/cartoon/${outArg}`;
writeFileSync(out, JSON.stringify(film, null, 2));
console.log(`wrote ${out} (${(film.durationInFrames / film.fps).toFixed(1)} s, ${aspectArg})`);
