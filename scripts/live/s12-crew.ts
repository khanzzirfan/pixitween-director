import { readFileSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createDirector } from '../../server/agent/director';
import { directShowrunner, bindCrew, createCrew } from '../../server/crew/run-crew';
import { buildDeps } from '../../server/main';
import type { FilmEvent } from '../../shared/events';
import type { LiveScript } from './run';

const BRIEF = 'A 15 second film for Coffee Co., a fictional cold-brew coffee can: calm early-morning light, the pour, a close look at the label, and an end card.';
export const MID_BUILD_MESSAGE = 'add a sunset scene after the second one, and warmer light everywhere';
const MESSAGE_DELAY_MS = 6000;
const FILM_TIMEOUT_MS = 8 * 60_000;

export const describe: LiveScript['describe'] = () =>
  'MG-2 / MG-3: one real crew film on the Coffee Co. brief, with the message "' + MID_BUILD_MESSAGE + '" sent 6 s after the first job starts. With --ab it also runs the sequential director and a Spark-led crew and prints the 08 section 7 table.';

export const estimateUsd: LiveScript['estimateUsd'] = (args = []) => (args.includes('--ab') ? 3 : 1);

export interface Metrics {
  wallTimeSec: number;
  showrunnerTurns: number;
  jobsByKind: Record<string, number>;
  superseded: number;
  toolCalls: number;
  toolCallsOk: number;
  findings: number;
  costUsd: number;
  scenes: number;
  hasNewScene: boolean;
}

/** Everything the table needs, read from a film's event log. */
export function computeMetrics(events: readonly FilmEvent[]): Metrics {
  const times = events.map((e) => Date.parse(e.at)).filter((t) => !Number.isNaN(t));
  const jobs = new Map<string, Extract<FilmEvent, { type: 'job.update' }>['job']>();
  let scenes: string[] = [];
  let hasNewScene = false;
  for (const e of events) {
    if (e.type === 'job.update') jobs.set(e.job.id, e.job);
    if (e.type === 'storyboard.revised' || e.type === 'director.storyboard') scenes = e.storyboard.scenes.map((s) => s.id);
    if (e.type === 'storyboard.revised' && e.ops.some((o) => o.op === 'add') && e.rev > 1) hasNewScene = true;
  }
  const calls = events.filter((e): e is Extract<FilmEvent, { type: 'tool.call' }> => e.type === 'tool.call');
  const jobsByKind: Record<string, number> = {};
  for (const j of jobs.values()) jobsByKind[j.kind] = (jobsByKind[j.kind] ?? 0) + 1;
  return {
    wallTimeSec: times.length ? (Math.max(...times) - Math.min(...times)) / 1000 : 0,
    showrunnerTurns: events.filter((e) => e.type === 'crew.agent' && e.lane === 'showrunner' && e.state === 'thinking').length,
    jobsByKind,
    superseded: [...jobs.values()].filter((j) => j.status === 'superseded').length,
    toolCalls: calls.length,
    toolCallsOk: calls.filter((c) => c.ok).length,
    findings: events.filter((e) => e.type === 'review.finding').length,
    costUsd: events.reduce((n, e) => n + (e.type === 'cost' ? e.usd : 0), 0),
    scenes: scenes.length,
    hasNewScene,
  };
}

const kinds = (m: Metrics) => Object.entries(m.jobsByKind).map(([k, n]) => `${n} ${k}`).join(', ') || '-';
const pct = (m: Metrics) => (m.toolCalls ? `${Math.round((m.toolCallsOk / m.toolCalls) * 100)} %` : '-');

/** The 08 section 7 table, one column per arrangement, plus the crew-only rows. */
export function renderTable(columns: Array<{ name: string; metrics: Metrics }>): string {
  const rows: Array<[string, (m: Metrics) => string]> = [
    ['Wall time to a finished film', (m) => `${m.wallTimeSec.toFixed(1)} s`],
    ['Valid tool calls on first try', pct],
    ['Style consistency (owner score 1-5)', () => '(owner)'],
    ['Issues found per film', (m) => String(m.findings)],
    ['Cost per film', (m) => `$${m.costUsd.toFixed(2)}`],
    ['Showrunner turns', (m) => String(m.showrunnerTurns || '-')],
    ['Jobs', kinds],
    ['Superseded jobs', (m) => String(m.superseded)],
    ['Scenes in the final film', (m) => `${m.scenes}${m.hasNewScene ? ' (new scene added)' : ''}`],
  ];
  const head = `| Metric | ${columns.map((c) => c.name).join(' | ')} |`;
  const rule = `|---|${columns.map(() => '---').join('|')}|`;
  return [head, rule, ...rows.map(([label, fn]) => `| ${label} | ${columns.map((c) => fn(c.metrics)).join(' | ')} |`)].join('\n');
}

type Deps = Awaited<ReturnType<typeof buildDeps>>;

async function newFilm(deps: Deps, crew: boolean) {
  const photo = readFileSync(new URL('../../fixtures/seed/mug-product.png', import.meta.url));
  const asset = await deps.assets.put(photo, 'image/png', { role: 'product-photo' });
  return deps.films.create({ aspect: '16:9', title: 'Coffee Co.', brief: { text: BRIEF, productAssetId: asset.id }, assets: [asset], ...(crew ? { crew: true } : {}) });
}

async function collect(deps: Deps, filmId: string, run: () => Promise<void>): Promise<FilmEvent[]> {
  const events: FilmEvent[] = [];
  const stop = deps.bus.subscribe(filmId, (e) => events.push(e.event));
  try {
    await run();
  } finally {
    stop();
  }
  return events;
}

export async function crewFilm(deps: Deps, log: (l: string) => void, showrunnerModel: string): Promise<FilmEvent[]> {
  process.env.SHOWRUNNER_MODEL = showrunnerModel;
  const film = await newFilm(deps, true);
  bindCrew(deps, { idleEndMs: FILM_TIMEOUT_MS });
  const crew = createCrew(deps, { idleEndMs: FILM_TIMEOUT_MS });
  return collect(deps, film.id, async () => {
    const session = await crew.start(film.id);
    const t0 = Date.now();
    let sent = false;
    let firstRunning: number | undefined;
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      const jobs = session.crew.board.list();
      if (firstRunning === undefined && jobs.some((j) => j.status === 'running')) firstRunning = Date.now();
      if (!sent && firstRunning !== undefined && Date.now() - firstRunning >= MESSAGE_DELAY_MS) {
        sent = true;
        log(`  sending: "${MID_BUILD_MESSAGE}"`);
        await directCrew(deps, film.id);
      }
      const now = await deps.films.get(film.id);
      const quiet = jobs.every((j) => ['done', 'failed', 'cancelled', 'superseded'].includes(j.status));
      if (sent && now.status === 'ready' && quiet && (now.storyboardRev ?? 0) >= 2) break;
      if (now.status === 'failed') throw new Error('the crew film failed');
      if (Date.now() - t0 > FILM_TIMEOUT_MS) throw new Error('the crew film did not finish in time');
    }
    session.stop();
    await session.done;
  });
}

async function directCrew(deps: Deps, filmId: string): Promise<void> {
  await directShowrunner(deps, filmId, MID_BUILD_MESSAGE);
}

async function sequentialFilm(deps: Deps): Promise<FilmEvent[]> {
  const film = await newFilm(deps, false);
  return collect(deps, film.id, () => createDirector(deps).runDirector(film.id));
}

export const run: LiveScript['run'] = async ({ env, log, args = [] }) => {
  if (!env.metaApiKey) throw new Error('META_API_KEY is required for s12-crew');
  const deps = await buildDeps(env);
  const ab = args.includes('--ab');
  const columns: Array<{ name: string; metrics: Metrics }> = [];
  const dump: Record<string, FilmEvent[]> = {};

  if (ab) {
    log('A: the sequential director...');
    dump.A = await sequentialFilm(deps);
    columns.push({ name: 'A sequential', metrics: computeMetrics(dump.A) });
    log('B: the crew with a Spark showrunner...');
    dump.B = await crewFilm(deps, log, 'muse-spark-1.3-contributor');
    columns.push({ name: 'B crew + Spark', metrics: computeMetrics(dump.B) });
  }
  log(`${ab ? 'C' : 'The'} crew with a Wonder showrunner...`);
  dump.C = await crewFilm(deps, log, process.env.WONDER_MODEL ?? 'muse-wonder-1.0');
  columns.push({ name: ab ? 'C crew + Wonder' : 'Crew + Wonder', metrics: computeMetrics(dump.C) });

  log('');
  log(renderTable(columns));
  mkdirSync('debug/s12b', { recursive: true });
  const file = `debug/s12b/crew-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(file, JSON.stringify({ columns, events: dump }, null, 2));
  log(`wrote ${file}`);
};
