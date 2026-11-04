// Reads plates into fixtures/plates/<assetId>.json: the busy grid, the measured horizontal edges and, with --yes, the
// surfaces and quadrants a vision model names (Spark, about $0.002 a plate; the local model when local mode is on).
// Without --yes nothing is billed and the surfaces stay empty: the plate counts as unread.
// An id may be a prefix of the asset file name (ast_04d50dc4). A failed read with --yes exits 1 and keeps the old file.
// Usage: npx tsx scripts/read-plate.ts <assetId...> [--yes]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readPlate } from '../server/media/plate-map';
import { pickReviewer } from '../server/llm/router';

// loadEnvFile never overrides a variable that is already set, so .env.dev wins over .env (as scripts/live/run.ts)
for (const file of ['.env.dev', '.env']) if (existsSync(file)) process.loadEnvFile(file);

const OUT = 'fixtures/plates';
const ASSETS = 'data/assets';
const args = process.argv.slice(2);
const yes = args.includes('--yes');
const ids = args.filter((a) => !a.startsWith('--'));
if (!ids.length) {
  console.error('usage: npx tsx scripts/read-plate.ts <assetId...> [--yes]');
  process.exit(1);
}

const files = readdirSync(ASSETS).filter((f) => f.endsWith('.jpg'));
const resolve = (id: string): string => {
  const hits = files.filter((f) => f.startsWith(id));
  if (hits.length !== 1) throw new Error(`${id}: ${hits.length ? `ambiguous (${hits.join(', ')})` : `no ${ASSETS}/${id}*.jpg`}`);
  return hits[0]!.replace(/\.jpg$/, '');
};
const full = ids.map(resolve);

mkdirSync(OUT, { recursive: true });
const reviewer = yes ? pickReviewer() : undefined;
if (reviewer) console.log(`reviewer: ${reviewer.id}${reviewer.id === 'spark' ? ` (about $${(full.length * 0.002).toFixed(3)} for ${full.length} plates)` : ' (local, free)'}`);
let failed = 0;
for (const id of full) {
  const { error, ...map } = await readPlate(readFileSync(`${ASSETS}/${id}.jpg`), reviewer?.reviewImages);
  if (yes && map.source !== 'vision') {
    failed++;
    console.error(`${id}: read failed, file kept: ${error ?? 'unknown'}`);
    continue;
  }
  // number arrays on one line each, so the 144-cell grid stays readable
  const json = JSON.stringify(map, null, 2).replace(/\[\s+([-\d.,\s]+?)\s+\]/g, (_m, inner: string) => `[${inner.replace(/\s+/g, ' ')}]`);
  writeFileSync(`${OUT}/${id}.json`, `${json}\n`);
  const q = map.quadrants ? Object.entries(map.quadrants).map(([k, v]) => `${k} ${v}`).join(' | ') : '';
  console.log(`${id}: ${map.source}, surfaces ${map.surfaces.map((s) => `${s.name} ${s.top}-${s.bottom} x ${s.left}-${s.right}`).join('; ') || 'none'}${q ? `\n  ${q}` : ''}`);
}
if (!yes) console.log('unread: run again with --yes to have the vision model name the surfaces');
if (failed) process.exit(1);
