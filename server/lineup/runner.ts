// Runs a line-up: one product's film after another, strictly in order. The state lives in director.db, so a restart
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
    for (const item of lineup.items) {
      if (!item.filmId || (item.state !== 'waiting' && item.state !== 'making')) continue;
      await store.setItem(lineupId, item.product.id, { state: 'making' });
      try {
        await (env.CREW_ENABLED ? runCrew(item.filmId) : runDirector(item.filmId));
        const film = await deps.films.get(item.filmId);
        await store.setItem(lineupId, item.product.id, film.status === 'failed' ? { state: 'failed', error: 'the film did not finish' } : { state: 'done' });
      } catch (e) {
        console.error(`lineup ${lineupId} film ${item.filmId} failed:`, e);
        await store.setItem(lineupId, item.product.id, { state: 'failed', error: e instanceof Error ? e.message.slice(0, 200) : 'the film failed' });
      }
    }
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
