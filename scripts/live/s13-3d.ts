// MG-1 of S13: one real crew film on the Coffee Co. brief whose hero scene is 3D. Paid, so it prints an estimate and exits unless --yes is passed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { bindCrew, createCrew } from '../../server/crew/run-crew';
import { buildDeps } from '../../server/main';
import type { FilmEvent } from '../../shared/events';
import type { LiveScript } from './run';

export const BRIEF = 'A 12 second film for Coffee Co., a fictional cold-brew coffee can. Make the first scene a hero shot where the can itself turns slowly in soft studio light, then the pour, then an end card.';
const FILM_TIMEOUT_MS = 8 * 60_000;

export const describe: LiveScript['describe'] = () =>
  'S13 MG-1: one real crew film on the Coffee Co. brief with a 3D hero scene (the real can turning in studio light). Needs PRODUCT_3D=true and engine 0.3.0-alpha.5. Prints the hero scene\'s mode and reason, the cost, and where to look.';

/** About $0.40: one crew film with a short plan; the 3D scene itself costs nothing to render. */
export const estimateUsd: LiveScript['estimateUsd'] = () => 0.4;

export interface Summary {
  filmId: string;
  modes: Array<{ id: string; mode: string; modeReason: string }>;
  heroMode: string | undefined;
  heroReason: string | undefined;
  has3DLayer: boolean;
  costUsd: number;
  wallTimeSec: number;
}

/** What the owner records: each scene's mode and the reason, whether a 3D layer was built, the cost and the time. */
export function summarise(filmId: string, events: readonly FilmEvent[], composition: unknown): Summary {
  let scenes: Summary['modes'] = [];
  for (const e of events) if (e.type === 'storyboard.revised' || e.type === 'director.storyboard') scenes = e.storyboard.scenes.map((s) => ({ id: s.id, mode: s.mode, modeReason: s.modeReason }));
  const times = events.map((e) => Date.parse(e.at)).filter((t) => !Number.isNaN(t));
  return {
    filmId,
    modes: scenes,
    heroMode: scenes[0]?.mode,
    heroReason: scenes[0]?.modeReason,
    has3DLayer: JSON.stringify(composition ?? {}).includes('"kind":"model3d"'),
    costUsd: Math.round(events.reduce((n, e) => n + (e.type === 'cost' ? e.usd : 0), 0) * 1e4) / 1e4,
    wallTimeSec: times.length ? (Math.max(...times) - Math.min(...times)) / 1000 : 0,
  };
}

export const run: LiveScript['run'] = async ({ env, log }) => {
  // checked before anything else, so a missing switch costs nothing
  if (!env.PRODUCT_3D) throw new Error('PRODUCT_3D is off: set PRODUCT_3D=true (and use engine 0.3.0-alpha.5) before running s13-3d');
  if (!env.metaApiKey) throw new Error('META_API_KEY is required for s13-3d');
  const deps = await buildDeps(env);
  // a can, to match the brief: with the mug photo the cut-out finds no can and the hero falls back to motion
  const photo = readFileSync(new URL('../../fixtures/s13/can-product.png', import.meta.url));
  const asset = await deps.assets.put(photo, 'image/png', { role: 'product-photo' });
  const film = await deps.films.create({ aspect: '16:9', title: 'Coffee Co.', brief: { text: BRIEF, productAssetId: asset.id }, assets: [asset], crew: true });

  const events: FilmEvent[] = [];
  const stop = deps.bus.subscribe(film.id, (e) => events.push(e.event));
  mkdirSync('debug/s13b', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let session: Awaited<ReturnType<ReturnType<typeof createCrew>['start']>> | undefined;
  try {
    bindCrew(deps, { idleEndMs: FILM_TIMEOUT_MS });
    const crew = createCrew(deps, { idleEndMs: FILM_TIMEOUT_MS });
    session = await crew.start(film.id);
    const t0 = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      const now = await deps.films.get(film.id);
      const quiet = session.crew.board.list().every((j) => ['done', 'failed', 'cancelled', 'superseded'].includes(j.status));
      if (now.status === 'ready' && quiet) break;
      if (now.status === 'failed') throw new Error('the crew film failed');
      if (Date.now() - t0 > FILM_TIMEOUT_MS) throw new Error('the crew film did not finish in time');
    }
  } catch (e) {
    // what the crew did up to the failure, so a failed paid run still says why
    const file = `debug/s13b/mg1-failed-${stamp}.json`;
    writeFileSync(file, JSON.stringify({ filmId: film.id, error: String(e), board: session?.crew.board.list() ?? [], events }, null, 2));
    log(`wrote ${file}`);
    throw e;
  } finally {
    // stops the workers too: without this a timed-out run keeps spending
    session?.stop();
    await session?.done;
    stop();
  }

  const final = await deps.films.get(film.id);
  const summary = summarise(film.id, events, final.composition);
  log('');
  for (const s of summary.modes) log(`  ${s.id}: ${s.mode.padEnd(8)} ${s.modeReason}`);
  log(`hero scene mode: ${summary.heroMode} | 3D layer built: ${summary.has3DLayer} | cost $${summary.costUsd.toFixed(2)} | ${summary.wallTimeSec.toFixed(0)} s`);
  log(`Open /?film=${film.id} and capture scene 1 at the start, middle and end of the turn. Score the realism 1-5: keep 3D in the demo only at 4 or above.`);
  const file = `debug/s13b/mg1-${stamp}.json`;
  writeFileSync(file, JSON.stringify({ summary, events }, null, 2));
  log(`wrote ${file}`);
};
