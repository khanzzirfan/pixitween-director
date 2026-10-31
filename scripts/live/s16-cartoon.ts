// MG-2 of S16b: one real cartoon film, end to end. Wonder plans and dispatches, the fixture forge makes the cast (no GPU yet), Spark blockers stage the shots, the critic checks them.
// Paid, so it prints an estimate and exits unless --yes is passed. Writes web/public/cartoon/live-film.json: open /stage-check.html?film=live to watch it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { bindCrew, createCrew } from '../../server/crew/run-crew';
import { buildDeps } from '../../server/main';
import type { FilmEvent } from '../../shared/events';
import type { LiveScript } from './run';

export const BRIEF = 'A 24 second cinematic toy cartoon for Coffee Co. cold brew. Pip, a small toy figure, wakes up tired in a cosy toy bedroom, shuffles out to the sunny toy kitchen, finds a can of cold brew on the counter, drinks it, and leaps for joy. Six shots: open wide, cut closer as Pip finds the can, a low heroic angle for the big jump, and end on the can. Two places. Locked camera in each shot.';
const FILM_TIMEOUT_MS = 12 * 60_000;

export const describe: LiveScript['describe'] = () =>
  'S16b MG-2: one real toy-cartoon film, end to end (Wonder showrunner, fixture forge, Spark blockers, critic). Needs META_API_KEY and CARTOON_MODE=true; set CARTOON_PAINT=true to paint every set backdrop with the image model ($0.01 each). Estimate: about $1 of Muse calls and $0 of forge GPU (the forge is a fixture until S16a). Prints wall time, model cost, GPU cost, critic findings and fixes.';

/** About $1: a Wonder showrunner for several turns, three Spark blockers and a few critic reviews. The forge costs nothing while it is the fixture. */
export const estimateUsd: LiveScript['estimateUsd'] = () => 1;

export interface Summary {
  filmId: string;
  scenes: string[];
  blocked: number;
  castReady: number;
  cast: number;
  jobsByKind: Record<string, number>;
  findings: number;
  fixes: number;
  modelCostUsd: number;
  gpuCostUsd: number;
  wallTimeSec: number;
  stageLayers: number;
}

/** What the owner records, from a film's event log and its composition. */
export function summarise(filmId: string, events: readonly FilmEvent[], composition: unknown, cast: ReadonlyArray<{ status: string }> = []): Summary {
  const jobs = new Map<string, Extract<FilmEvent, { type: 'job.update' }>['job']>();
  let scenes: string[] = [];
  for (const e of events) {
    if (e.type === 'job.update') jobs.set(e.job.id, e.job);
    if (e.type === 'storyboard.revised' || e.type === 'director.storyboard') scenes = e.storyboard.scenes.map((s) => s.id);
  }
  const times = events.map((e) => Date.parse(e.at)).filter((t) => !Number.isNaN(t));
  const byKind: Record<string, number> = {};
  for (const j of jobs.values()) byKind[j.kind] = (byKind[j.kind] ?? 0) + 1;
  return {
    filmId,
    scenes,
    blocked: [...jobs.values()].filter((j) => j.kind === 'block-shot' && j.status === 'done').length,
    cast: cast.length,
    castReady: cast.filter((m) => m.status === 'ready').length,
    jobsByKind: byKind,
    findings: events.filter((e) => e.type === 'review.finding').length,
    fixes: byKind.fix ?? 0,
    // the fixture forge is free; a real forge reports its GPU seconds as cost events on its own model name
    modelCostUsd: Math.round(events.reduce((n, e) => n + (e.type === 'cost' && !/forge|gpu/i.test(e.model) ? e.usd : 0), 0) * 1e4) / 1e4,
    gpuCostUsd: Math.round(events.reduce((n, e) => n + (e.type === 'cost' && /forge|gpu/i.test(e.model) ? e.usd : 0), 0) * 1e4) / 1e4,
    wallTimeSec: times.length ? (Math.max(...times) - Math.min(...times)) / 1000 : 0,
    stageLayers: (JSON.stringify(composition ?? {}).match(/"kind":\s*"stage3d"/g) ?? []).length,
  };
}

export const run: LiveScript['run'] = async ({ env, log }) => {
  // checked before anything else, so a missing switch costs nothing
  if (!env.CARTOON_MODE) throw new Error('CARTOON_MODE is off: set CARTOON_MODE=true before running s16-cartoon');
  if (!env.metaApiKey) throw new Error('META_API_KEY is required for s16-cartoon');
  const deps = await buildDeps(env);
  const photo = readFileSync(new URL('../../fixtures/s13/can-product.png', import.meta.url));
  const asset = await deps.assets.put(photo, 'image/png', { role: 'product-photo' });
  const film = await deps.films.create({ aspect: '16:9', title: 'Pip & the Cold Brew', brief: { text: BRIEF, productAssetId: asset.id }, assets: [asset], crew: true });

  const events: FilmEvent[] = [];
  const stop = deps.bus.subscribe(film.id, (e) => events.push(e.event));
  mkdirSync('debug/s16', { recursive: true });
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
    const file = `debug/s16/cartoon-failed-${stamp}.json`;
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
  const s = summarise(film.id, events, final.composition, final.cast);
  log('');
  log(`scenes ${s.scenes.join(', ')} | cast ready ${s.castReady}/${s.cast} | blocked shots ${s.blocked} | stage layers ${s.stageLayers}`);
  log(`jobs ${JSON.stringify(s.jobsByKind)} | critic findings ${s.findings} | fixes ${s.fixes}`);
  log(`wall ${s.wallTimeSec.toFixed(0)} s | model cost $${s.modelCostUsd.toFixed(2)} | GPU cost $${s.gpuCostUsd.toFixed(2)} (fixture forge)`);
  writeFileSync('web/public/cartoon/live-film.json', JSON.stringify(final.composition, null, 2));
  const file = `debug/s16/cartoon-${stamp}.json`;
  writeFileSync(file, JSON.stringify({ summary: s, events }, null, 2));
  log(`wrote ${file}. Open /stage-check.html?film=live and score the look 1-5 (keep the stage in the demo at 4 or above).`);
};
