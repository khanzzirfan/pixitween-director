// Owned by S8b. Installs the real film queue at boot, exposes its state, and picks up films that were waiting at a restart.
import type { BootHook } from '../boot';
import type { AppDeps } from './deps';
import { createFilmQueue } from './film-queue';
import { getLimits } from './limits-config';

type DirectorModule = { bindDirector?: (deps: AppDeps) => void; runDirector?: (filmId: string) => Promise<void> };

export function createInstallFilmQueue(opts: { loadDirector?: () => Promise<DirectorModule>; log?: (line: string) => void } = {}): BootHook {
  const loadDirector = opts.loadDirector ?? (() => import('../agent/director'));
  const log = opts.log ?? ((line: string) => console.log(line));

  return async ({ app, deps }) => {
    const limits = getLimits();
    const queue = createFilmQueue({
      maxInFlight: limits.filmsInFlightMax,
      maxQueued: limits.filmsQueueMax,
      startsPerWindow: limits.filmsStartsPerWindow,
      windowMs: limits.filmsWindowSec * 1000,
      log,
    });
    deps.admission = queue; // replaces the direct admission main.ts started with

    // public reads: the passcode middleware only guards mutating methods, and no CORS headers are set
    app.get('/api/queue', (c) => c.json(queue.stats()));
    app.get('/api/queue/:filmId', (c) => c.json(queue.position(c.req.param('filmId'))));

    let director: DirectorModule | undefined;
    try {
      director = await loadDirector();
    } catch (e) {
      log(`[queue] director failed to load: ${e instanceof Error ? e.message : String(e)}`);
      director = undefined;
    }
    const runDirector = director?.runDirector;
    if (!runDirector) {
      log('[queue] director not available; skipping requeue');
      return;
    }
    director?.bindDirector?.(deps);
    const waiting = (await deps.films.list()).filter((f) => f.status === 'new').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const film of waiting) queue.submit(film.id, () => runDirector(film.id));
    log(`[queue] requeued ${waiting.length} film(s)`);
  };
}

export const installFilmQueue = createInstallFilmQueue();
