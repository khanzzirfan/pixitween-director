import type { FilmAdmission } from '@shared/ports';
import { loadEnv } from './env';

/** The default admission: a cap on films running at once, no queue. S8b replaces it with the real queue at boot. */
export function createDirectAdmission(opts: { maxInFlight: number }): FilmAdmission {
  const running = new Set<string>();
  const full = () => running.size >= opts.maxInFlight;
  return {
    canAccept: () => (full() ? { ok: false, retryAfterSec: 30 } : { ok: true }),
    submit(filmId, run) {
      if (running.has(filmId)) return { state: 'running' };
      if (full()) return { state: 'rejected', retryAfterSec: 30 };
      running.add(filmId);
      void run()
        .catch((e: unknown) => console.error(`film ${filmId} run failed:`, e))
        .finally(() => running.delete(filmId));
      return { state: 'running' };
    },
    position: (filmId) => (running.has(filmId) ? { state: 'running' } : { state: 'unknown' }),
    stats: () => ({ inFlight: running.size, queued: 0, maxInFlight: opts.maxInFlight, maxQueued: 0, startsInWindow: 0, startsPerWindow: 0, windowSec: 0 }),
  };
}

let fallback: FilmAdmission | undefined;

/** Handlers call this at request time and never cache the result: S8b swaps `deps.admission` at boot. */
export function getAdmission(deps: { admission?: FilmAdmission }): FilmAdmission {
  return deps.admission ?? (fallback ??= createDirectAdmission({ maxInFlight: loadEnv().FILMS_IN_FLIGHT_MAX }));
}
