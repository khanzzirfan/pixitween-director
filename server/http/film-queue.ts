// Owned by S8b. Runs only as many films at once as the Meta key's request budget allows, and queues the rest.
import type { FilmAdmission } from '@shared/ports';
import { createRateLimiter } from './rate-limit';

export interface FilmQueueOptions {
  maxInFlight: number;
  maxQueued: number;
  startsPerWindow: number;
  windowMs: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  log?: (line: string) => void;
}

type Queued = { filmId: string; run: () => Promise<void> };
const KEY = 'starts';

export function createFilmQueue(opts: FilmQueueOptions): FilmAdmission & { dispose(): void } {
  const now = opts.now ?? Date.now;
  const setTimer = opts.setTimer ?? ((fn, ms) => {
    const h = setTimeout(fn, ms);
    h.unref?.();
    return h;
  });
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));
  const log = opts.log ?? ((line: string) => console.log(line));
  const starts = createRateLimiter({ windowMs: opts.windowMs, max: opts.startsPerWindow, now });
  const running = new Set<string>();
  const queue: Queued[] = [];
  let timer: unknown;

  /** One start interval: the spacing the budget gives each film once the window is full. */
  const intervalSec = Math.ceil(opts.windowMs / opts.startsPerWindow / 1000);
  const startsUsed = (): number => {
    const p = starts.peek(KEY);
    return p.allowed ? opts.startsPerWindow - p.remaining - 1 : opts.startsPerWindow;
  };
  const line = (filmId: string, state: string) =>
    log(`[queue] film=${filmId} state=${state} inFlight=${running.size}/${opts.maxInFlight} queued=${queue.length}/${opts.maxQueued} starts=${startsUsed()}/${opts.startsPerWindow}`);
  const queuedState = (filmId: string) => {
    const i = queue.findIndex((q) => q.filmId === filmId);
    return i === -1 ? undefined : ({ state: 'queued', position: i + 1, etaSec: (i + 1) * intervalSec } as const);
  };
  const rejectAfterSec = () => Math.max(intervalSec, starts.peek(KEY).retryAfterSec);

  function start(item: Queued): void {
    running.add(item.filmId);
    line(item.filmId, 'running');
    void Promise.resolve()
      .then(item.run)
      .catch((e: unknown) => log(`[queue] film=${item.filmId} run failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        running.delete(item.filmId);
        line(item.filmId, 'done');
        pump();
      });
  }

  function pump(): void {
    while (queue.length && running.size < opts.maxInFlight) {
      const g = starts.check(KEY);
      if (!g.allowed) {
        if (timer !== undefined) clearTimer(timer);
        timer = setTimer(() => {
          timer = undefined;
          pump();
        }, g.retryAfterSec * 1000);
        return;
      }
      start(queue.shift()!);
    }
  }

  const canStartNow = () => queue.length === 0 && running.size < opts.maxInFlight && starts.peek(KEY).allowed;

  return {
    canAccept() {
      if (queue.length < opts.maxQueued || canStartNow()) return { ok: true };
      return { ok: false, retryAfterSec: rejectAfterSec() };
    },

    submit(filmId, run) {
      if (running.has(filmId)) return { state: 'running' };
      const waiting = queuedState(filmId);
      if (waiting) return waiting;
      if (canStartNow()) {
        starts.check(KEY);
        start({ filmId, run });
        return { state: 'running' };
      }
      if (queue.length < opts.maxQueued) {
        queue.push({ filmId, run });
        line(filmId, 'queued');
        pump(); // a free slot with no start budget needs a timer
        return queuedState(filmId) ?? { state: 'running' };
      }
      line(filmId, 'rejected');
      return { state: 'rejected', retryAfterSec: rejectAfterSec() };
    },

    position: (filmId) => (running.has(filmId) ? { state: 'running' } : (queuedState(filmId) ?? { state: 'unknown' })),

    stats: () => ({
      inFlight: running.size,
      queued: queue.length,
      maxInFlight: opts.maxInFlight,
      maxQueued: opts.maxQueued,
      startsInWindow: startsUsed(),
      startsPerWindow: opts.startsPerWindow,
      windowSec: opts.windowMs / 1000,
    }),

    dispose() {
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
    },
  };
}
