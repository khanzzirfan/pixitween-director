import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { HEARTBEAT_MS } from './sse';
import { makeTestFilm } from '../test-utils/film';

interface Frame { id?: string; event?: string; data?: string }

async function open(path: string, headers: Record<string, string> = {}) {
  const t = await makeTestFilm();
  let subscribers = 0;
  const bus = { ...t.bus, subscribe: ((id: string, fn: never) => {
    subscribers++;
    const off = t.bus.subscribe(id, fn);
    return () => (subscribers--, off());
  }) as typeof t.bus.subscribe };
  const app = createApp({ films: t.films, assets: t.assets, meta: t.meta, ledger: t.ledger, bus, makeToolCtx: () => t.ctx });
  return { t, app, subscribers: () => subscribers, path: path.replace('FILM', t.filmId), headers };
}

function reader(res: Response) {
  const r = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  return {
    async frame(): Promise<Frame> {
      for (;;) {
        const i = buf.indexOf('\n\n');
        if (i >= 0) {
          const raw = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const f: Frame = {};
          for (const line of raw.split('\n')) {
            const [k, ...v] = line.split(':');
            (f as Record<string, string>)[k!.trim()] = v.join(':').trim();
          }
          return f;
        }
        const { value, done } = await r.read();
        if (done) throw new Error('stream ended');
        buf += dec.decode(value);
      }
    },
    cancel: () => r.cancel(),
  };
}

const status = (filmId: string, n: number) => ({ filmId, at: new Date().toISOString(), type: 'listener.transcript' as const, text: `t${n}` });

beforeEach(() => void vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
afterEach(() => vi.useRealTimers());

it('replays, honours Last-Event-ID, streams live, pings, and unsubscribes on abort', async () => {
  const s = await open('/api/films/FILM/events');
  for (let i = 1; i <= 3; i++) await s.t.bus.emit(s.t.filmId, status(s.t.filmId, i));

  const full = reader(await s.app.request(s.path));
  const frames = [await full.frame(), await full.frame(), await full.frame()];
  expect(frames.map((f) => f.id)).toEqual(['1', '2', '3']);
  expect(frames.every((f) => f.event === 'film')).toBe(true);

  await s.t.bus.emit(s.t.filmId, status(s.t.filmId, 4));
  expect((await full.frame()).id).toBe('4');

  await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
  expect((await full.frame()).event).toBe('ping');

  const resumed = reader(await s.app.request(s.path, { headers: { 'Last-Event-ID': '2' } }));
  expect((await resumed.frame()).id).toBe('3');
  expect((await resumed.frame()).id).toBe('4');

  expect(s.subscribers()).toBe(2);
  await full.cancel();
  await resumed.cancel();
  await vi.advanceTimersByTimeAsync(10);
  expect(s.subscribers()).toBe(0);
});

it('answers 404 for an unknown film', async () => {
  const s = await open('/api/films/film_000000000000/events');
  expect((await s.app.request(s.path)).status).toBe(404);
});
