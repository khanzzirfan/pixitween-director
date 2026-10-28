import type { FilmEvent } from '@shared/events';
import { makeTestFilm } from './film';
import type { AppDeps } from '../http/deps';

/** AppDeps over temp-dir stores, for HTTP tests. */
/** `events` collects every event the bus delivers for the test film. */
export async function makeTestDeps(): Promise<AppDeps & { filmId: string; dir: string; events: FilmEvent[] }> {
  const t = await makeTestFilm();
  const deps: AppDeps = {
    films: t.films,
    assets: t.assets,
    meta: t.meta,
    ledger: t.ledger,
    bus: t.bus,
    makeToolCtx: () => t.ctx,
  };
  return { ...deps, filmId: t.filmId, dir: t.dir, events: t.events };
}
