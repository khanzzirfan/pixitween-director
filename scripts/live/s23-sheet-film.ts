// S23 live: the sheet film, start to end, on the test server.
//   brief + photo -> parts -> product, element and set sheets -> one Muse look -> the film from JSON -> film sheet -> one Muse look -> committed 3D film.
// Prints the seconds of every step and the film's cost from the ledger, and writes the sheets, the film sheet, the film JSON and timings.json to
// debug/sheet-film/<stamp>/. The renderer needs the review web server on 5199 AND the API server on 8797 with DATA_DIR data-s-review: the pages
// load the film's pictures from /api/assets, which 5199 proxies to 8797. Both are checked before anything is paid for.
// Paid (Muse calls, about $0.06-0.10), so it prints an estimate and exits unless --yes is passed.
// Usage: npm run live -- s23-sheet-film [photo.png] [--yes]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDeps } from '../../server/main';
import { renderKeyFrames } from '../../server/crew/frame-review';
import { makeSheetFilm } from '../../server/crew/sheet-film';
import type { LiveScript } from './run';

const PHOTO = 'fixtures/catalog/yoghurt-berry.png';
const BRIEF = 'Cinematic 10s vertical (9:16) yoghurt ad for the "Pure Spoonful" mixed-berry tub';
const DATA_DIR = 'data-s-review';
const WEB = 'http://localhost:5199';
const API = 'http://localhost:8797';

/** Stops early, with what to start, when the renderer or the API that serves the film's pictures is not up. */
export async function preflight(assetId: string, get: (url: string) => Promise<{ ok: boolean }> = (u) => fetch(u)): Promise<void> {
  const up = (url: string) => get(url).then((r) => r.ok, () => false);
  if (!(await up(`${WEB}/stage-check.html`))) throw new Error(`the web server on 5199 is not running. Start it: DIRECTOR_WEB_PORT=5199 DIRECTOR_API_URL=${API} npx vite --config web/vite.config.ts`);
  if (!(await up(`${WEB}/api/assets/${assetId}`))) throw new Error(`the pictures are not served through 5199 (the API on 8797 is not running or reads another data folder). Start it: PORT=8797 DATA_DIR=${DATA_DIR} npm run dev:server:nowatch`);
}

export const describe: LiveScript['describe'] = () =>
  `S23 live: makes one 3D product film as a sheet film from ${PHOTO} (or the first .png given): parts, product/element/set sheets, one Muse check, the film, a film sheet, one Muse look, commit. Prints the time of every step and the cost. The renderer needs the web server on 5199 and the API on 8797 (the review servers); data goes to ${DATA_DIR}. Writes debug/sheet-film/<stamp>/.`;

export const estimateUsd: LiveScript['estimateUsd'] = () => 0.1;

export const run: LiveScript['run'] = async ({ env, log, args }) => {
  if (!env.metaApiKey) throw new Error('META_API_KEY is required for s23-sheet-film');
  const photoPath = args?.find((a) => a.endsWith('.png')) ?? PHOTO;
  process.env.DATA_DIR = DATA_DIR;
  const deps = await buildDeps({ ...env, DATA_DIR });
  const photo = await deps.assets.put(readFileSync(photoPath), 'image/png', { role: 'product-photo' });
  await preflight(photo.id);
  const film = await deps.films.create({ aspect: '9:16', title: 'Pure Spoonful', brief: { text: BRIEF, productAssetId: photo.id }, assets: [photo] });
  const base = deps.makeToolCtx(film.id);
  // the sheets are saved as assets and announced as art.asset events; they are not on the film itself
  const sheetIds: string[] = [];
  const ctx = { ...base, emit: (e: Parameters<typeof base.emit>[0]) => { if (e.type === 'art.asset' && e.asset.role === 'sheet') sheetIds.push(e.asset.id); base.emit(e); } };
  const t0 = Date.now();
  const made = await makeSheetFilm(ctx, { log: (line) => log(`  ${line}`), render: (comp, times) => renderKeyFrames(comp, times, WEB) });
  const total = Math.round((Date.now() - t0) / 100) / 10;
  const cost = deps.ledger.total(film.id);
  if (!made.ok) throw new Error(`the sheet film failed: ${made.reason} (after ${total} s, $${cost.toFixed(4)})`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = join('debug', 'sheet-film', stamp);
  mkdirSync(out, { recursive: true });
  const done = await deps.films.get(film.id);
  for (const [i, id] of sheetIds.entries()) writeFileSync(join(out, `sheet-${i + 1}.jpg`), await deps.assets.read(id));
  if (done.composition) writeFileSync(join(out, 'film.json'), JSON.stringify(done.composition));
  writeFileSync(join(out, 'timings.json'), JSON.stringify({ filmId: film.id, totalSeconds: total, seconds: made.seconds, costUsd: cost }, null, 2));
  for (const [step, s] of Object.entries(made.seconds)) log(`${step}: ${s} s`);
  log(`total ${total} s, cost $${cost.toFixed(4)}; ${sheetIds.length} sheets and the film in ${out}`);
};
