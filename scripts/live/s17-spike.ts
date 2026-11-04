// S17 look spike: one real crew film, 9:16, from the product photo, to score how real the pipeline's ad looks before polishing it.
// Paid, so it prints an estimate and exits unless --yes is passed. Writes web/public/cartoon/spike-film.json: open /stage-check.html?film=spike to look at it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { bindCrew, createCrew } from '../../server/crew/run-crew';
import { buildDeps } from '../../server/main';
import type { FilmEvent } from '../../shared/events';
import type { LiveScript } from './run';

export const BRIEF =
  'A 16 second vertical (9:16) ad for Coffee Co. cold brew, shot like real product photography: soft morning window light, the can on a wooden counter with steam from a fresh pour beside it, a slow close look at the label, and an end card with the price $4.50. Four shots, slow camera moves, natural colours, no cartoon look.';
const FILM_TIMEOUT_MS = 15 * 60_000;

export const describe: LiveScript['describe'] = () =>
  'S17 look spike: one real crew film (Wonder showrunner, Spark builders, Muse Image plates, SAM cut-outs, critic) on the can photo in 9:16. Estimate: about $1. Prints scenes, jobs, findings, fixes, cost and time; writes the film for /stage-check.html?film=spike.';

/** About $1: a Wonder showrunner, four Spark builders, a few Muse Image plates, SAM and the critic. */
export const estimateUsd: LiveScript['estimateUsd'] = () => 1;

export const run: LiveScript['run'] = async ({ env, log }) => {
  if (!env.metaApiKey) throw new Error('META_API_KEY is required for s17-spike');
  const deps = await buildDeps(env);
  const photo = readFileSync(new URL('../../fixtures/s13/can-product.png', import.meta.url));
  const asset = await deps.assets.put(photo, 'image/png', { role: 'product-photo' });
  const film = await deps.films.create({ aspect: '9:16', title: 'Coffee Co. cold brew', brief: { text: BRIEF, productAssetId: asset.id }, assets: [asset], crew: true });

  const events: FilmEvent[] = [];
  const stop = deps.bus.subscribe(film.id, (e) => events.push(e.event));
  mkdirSync('debug/s17', { recursive: true });
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
    const file = `debug/s17/spike-failed-${stamp}.json`;
    writeFileSync(file, JSON.stringify({ filmId: film.id, error: String(e), board: session?.crew.board.list() ?? [], events }, null, 2));
    log(`wrote ${file}`);
    // keep what was built: a slow fix loop should not throw the film away
    const partial = await deps.films.get(film.id).catch(() => undefined);
    if (partial?.composition) {
      writeFileSync('web/public/cartoon/spike-film.json', JSON.stringify(partial.composition, null, 2));
      log(`saved the partial film (version ${partial.version}) to web/public/cartoon/spike-film.json`);
    }
    throw e;
  } finally {
    session?.stop();
    await session?.done;
    stop();
  }

  const final = await deps.films.get(film.id);
  const jobs = new Map<string, { kind: string }>();
  let scenes: string[] = [];
  for (const e of events) {
    if (e.type === 'job.update') jobs.set(e.job.id, e.job);
    if (e.type === 'storyboard.revised' || e.type === 'director.storyboard') scenes = e.storyboard.scenes.map((s) => s.id);
  }
  const byKind: Record<string, number> = {};
  for (const j of jobs.values()) byKind[j.kind] = (byKind[j.kind] ?? 0) + 1;
  const times = events.map((e) => Date.parse(e.at)).filter((t) => !Number.isNaN(t));
  const cost = events.reduce((n, e) => n + (e.type === 'cost' ? e.usd : 0), 0);
  log('');
  log(`scenes ${scenes.join(', ')} | jobs ${JSON.stringify(byKind)} | critic findings ${events.filter((e) => e.type === 'review.finding').length}`);
  log(`wall ${times.length ? ((Math.max(...times) - Math.min(...times)) / 1000).toFixed(0) : 0} s | cost $${cost.toFixed(2)} | film ${film.id}`);
  writeFileSync('web/public/cartoon/spike-film.json', JSON.stringify(final.composition, null, 2));
  const file = `debug/s17/spike-${stamp}.json`;
  writeFileSync(file, JSON.stringify({ filmId: film.id, scenes, byKind, costUsd: cost, events }, null, 2));
  log(`wrote ${file}. Open /stage-check.html?film=spike and score the look 1-5 (the plan's gate is 4).`);
};
