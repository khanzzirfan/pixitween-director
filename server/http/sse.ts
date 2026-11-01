import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { isFilmId } from '@shared/composition';
import type { EventEnvelope } from '@shared/events';
import type { AppDeps } from './deps';

export const HEARTBEAT_MS = 15_000;

/** GET /api/films/:id/events: replay the log after Last-Event-ID (or ?after=), then stream live, with a 15 s ping. */
export function registerSseRoute(app: Hono, deps: AppDeps): void {
  app.get('/api/films/:id/events', async (c) => {
    const id = c.req.param('id');
    if (!isFilmId(id)) return c.json({ error: 'not_found' }, 404);
    try {
      await deps.films.get(id);
    } catch {
      return c.json({ error: 'not_found' }, 404);
    }
    const after = Number(c.req.header('last-event-id') ?? c.req.query('after') ?? 0) || 0;

    return streamSSE(c, async (stream) => {
      let last = after;
      let live = false;
      const buffered: EventEnvelope[] = [];
      let chain: Promise<unknown> = Promise.resolve();
      // writes stay in order and a write error ends the stream silently
      const write = (fn: () => Promise<void>) => (chain = chain.then(fn).catch(() => undefined));
      const send = (env: EventEnvelope) =>
        write(async () => {
          if (env.seq <= last) return;
          last = env.seq;
          await stream.writeSSE({ event: 'film', id: String(env.seq), data: JSON.stringify(env.event) });
        });

      // subscribe first and buffer, so nothing emitted during the replay is lost
      const unsubscribe = deps.bus.subscribe(id, (env) => (live ? void send(env) : void buffered.push(env)));
      const timer = setInterval(() => void write(() => stream.writeSSE({ event: 'ping', data: '{}' })), HEARTBEAT_MS);
      const done = new Promise<void>((resolve) =>
        stream.onAbort(() => {
          unsubscribe();
          clearInterval(timer);
          resolve();
        }),
      );

      for (const env of await deps.bus.replay(id, after)) send(env);
      live = true;
      for (const env of buffered) send(env);
      await done;
    });
  });
}
