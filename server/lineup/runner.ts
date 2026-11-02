// Runs a line-up: LINEUP_CONCURRENCY product films at a time, started in order. The state lives in director.db, so a restart
// calls `resumeLineups` and carries on; a film that was being made re-enters the crew, which resumes from its checkpoint.
import { runDirector, bindDirector } from '../agent/director';
import { bindCrew, runCrew } from '../crew/run-crew';
import { loadEnv } from '../env';
import type { AppDeps } from '../http/deps';
import { createLineupStore, unfinishedLineupIds, type LineupStore } from './store';

const running = new Set<string>();

/** Make every product of the line-up that is not done, in order. Resolves when the line-up has ended. */
export async function runLineup(
  deps: AppDeps,
  lineupId: string,
  store: LineupStore = createLineupStore({ dir: deps.dataDir ?? loadEnv().DATA_DIR }),
): Promise<void> {
  if (running.has(lineupId)) return;
  running.add(lineupId);
  try {
    const env = loadEnv();
    bindDirector(deps);
    if (env.CREW_ENABLED) bindCrew(deps);
    const lineup = await store.get(lineupId);
    if (!lineup) return;
    const todo = lineup.items.filter((item) => item.filmId && (item.state === 'waiting' || item.state === 'making'));
    // each line-up film runs on a tighter clock than a single film: the owner waits for all of them
    const limits = { deadlineMs: env.LINEUP_FILM_DEADLINE_MS, maxFixes: env.LINEUP_MAX_FIXES_PER_SCENE, maxCritiques: env.LINEUP_MAX_AUTO_CRITIQUES };
    const runOne = async (item: (typeof todo)[number]) => {
      await store.setItem(lineupId, item.product.id, { state: 'making' });
      try {
        await (env.CREW_ENABLED ? runCrew(item.filmId!, limits) : runDirector(item.filmId!));
        const film = await deps.films.get(item.filmId!);
        await store.setItem(lineupId, item.product.id, film.status === 'failed' ? { state: 'failed', error: 'the film did not finish' } : { state: 'done' });
      } catch (e) {
        console.error(`lineup ${lineupId} film ${item.filmId} failed:`, e);
        await store.setItem(lineupId, item.product.id, { state: 'failed', error: e instanceof Error ? e.message.slice(0, 200) : 'the film failed' });
      }
    };
    // LINEUP_CONCURRENCY films at once, started in line-up order: a free slot takes the next product
    let next = 0;
    const slot = async () => {
      while (next < todo.length) await runOne(todo[next++]!);
    };
    await Promise.all(Array.from({ length: Math.min(env.LINEUP_CONCURRENCY, todo.length) }, slot));
  } finally {
    running.delete(lineupId);
  }
}

/** On boot: pick up every line-up that still has a product waiting or being made. Returns the ids it restarted. */
export function resumeLineups(deps: AppDeps): string[] {
  const ids = unfinishedLineupIds(deps.dataDir ?? loadEnv().DATA_DIR);
  for (const id of ids) void runLineup(deps, id).catch((e) => console.error(`lineup ${id} could not resume:`, e));
  return ids;
}
