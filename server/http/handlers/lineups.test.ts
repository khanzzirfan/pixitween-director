import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Lineup } from '@shared/lineup';
import { makeTestDeps } from '../../test-utils/deps';

let inFlight = 0;
let maxInFlight = 0;
const order: string[] = [];
const runCrew = vi.fn(async (id: string) => {
  order.push(id);
  maxInFlight = Math.max(maxInFlight, ++inFlight);
  await new Promise((r) => setTimeout(r, 10));
  inFlight--;
});
vi.mock('../../crew/run-crew', () => ({ runCrew: (id: string) => runCrew(id), bindCrew: () => undefined, getCrewSession: () => undefined }));
vi.mock('../../agent/director', () => ({ runDirector: vi.fn(), bindDirector: () => undefined }));

const { createApp } = await import('../app');
const { productBrief } = await import('./lineups');

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.DIRECTOR_PASSCODE;
  process.env.DIRECTOR_FAKE = '1';
  process.env.CREW_ENABLED = 'true';
  inFlight = 0;
  maxInFlight = 0;
  order.length = 0;
});
afterEach(() => {
  process.env = { ...saved };
});

async function start(form: FormData) {
  const deps = await makeTestDeps();
  process.env.DATA_DIR = deps.dir;
  const app = createApp(deps);
  const res = await app.request('/api/lineups', { method: 'POST', body: form });
  return { deps, app, res };
}

const settled = async (app: ReturnType<typeof createApp>, id: string): Promise<Lineup> => {
  for (let i = 0; i < 200; i++) {
    const l = (await (await app.request(`/api/lineups/${id}`)).json()) as Lineup;
    if (l.items.every((x) => x.state === 'done' || x.state === 'failed' || x.state === 'stopped')) return l;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('line-up did not finish');
};

it('a catalogue is one crew film per product, started in feed order, LINEUP_CONCURRENCY at a time', async () => {
  const form = new FormData();
  form.set('demo', 'feed-6');
  form.set('brief', 'warm and fast');
  const { deps, app, res } = await start(form);
  expect(res.status).toBe(202);
  const { lineupId, filmIds } = (await res.json()) as { lineupId: string; filmIds: string[] };
  expect(filmIds.length).toBeGreaterThan(1);
  const lineup = await settled(app, lineupId);
  expect(lineup.items.every((i) => i.state === 'done')).toBe(true);
  expect(order).toEqual(filmIds); // started in the feed's order
  expect(maxInFlight).toBe(2); // LINEUP_CONCURRENCY, default 2
  const first = await deps.films.get(filmIds[0]!);
  expect(first.crew).toBe(true);
  expect(first.brief.text).toContain('warm and fast');
  expect(first.brief.text).toContain(lineup.items[0]!.product.title);
});

it('a failed film does not stop the next one', async () => {
  runCrew.mockImplementationOnce(async () => {
    throw new Error('boom');
  });
  const form = new FormData();
  form.set('demo', 'feed-6');
  const { app, res } = await start(form);
  const { lineupId, filmIds } = (await res.json()) as { lineupId: string; filmIds: string[] };
  const lineup = await settled(app, lineupId);
  expect(lineup.items[0]!.state).toBe('failed');
  expect(lineup.items[1]!.state).toBe('done');
  expect(order).toEqual(filmIds.slice(1)); // the failing film threw before it was recorded; every other one still ran
});

it('stop ends the films in progress and leaves the rest unstarted', async () => {
  // LINEUP_CONCURRENCY defaults to 2: hold both slots' films until after the stop
  const releases: Array<() => void> = [];
  const hold = (id: string) => {
    order.push(id);
    return new Promise<void>((r) => {
      releases.push(() => r());
    });
  };
  runCrew.mockImplementationOnce(hold).mockImplementationOnce(hold);
  const form = new FormData();
  form.set('demo', 'feed-6');
  const { app, res } = await start(form);
  const { lineupId, filmIds } = (await res.json()) as { lineupId: string; filmIds: string[] };
  for (let i = 0; i < 50 && order.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  const stop = await app.request(`/api/lineups/${lineupId}/stop`, { method: 'POST' });
  expect(stop.status).toBe(200);
  expect(await stop.json()).toMatchObject({ ok: true, stopped: true });
  for (const release of releases) release();
  const lineup = await settled(app, lineupId);
  expect(order).toEqual(filmIds.slice(0, 2));
  expect(lineup.items.every((i) => i.state === 'stopped')).toBe(true);
  expect((await app.request(`/api/lineups/${lineupId}/stop`)).status).toBe(404);
  expect((await app.request(`/api/lineups/${lineupId}/stop`, { method: 'POST' })).status).toBe(200);
});

it('refuses a feed that is not a feed, and an unknown line-up is 404', async () => {
  const form = new FormData();
  form.set('csv', 'nope');
  const { app, res } = await start(form);
  expect(res.status).toBe(400);
  expect((await app.request('/api/lineups/lin_00000000')).status).toBe(404);
});

it('makes 9:16 reels only', async () => {
  const form = new FormData();
  form.set('demo', 'feed-6');
  form.set('aspect', '16:9');
  const { res } = await start(form);
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toBe('bad_aspect');
});

it('tells the crew the feed facts and the owner words', () => {
  const text = productBrief({ id: 'a', title: 'Forest Oud', price: 95, salePrice: 80, currency: 'USD', imageUrl: 'x.png', category: 'perfume', brand: 'Acme' }, 'moody');
  expect(text).toContain('Forest Oud');
  expect(text).toContain('$80.00');
  expect(text).toContain('$95.00');
  expect(text).toContain('moody');
});

it('a restart resumes a line-up: the film being made re-enters the crew, waiting ones follow, done ones are left alone', async () => {
  const { createLineupStore } = await import('../../lineup/store');
  const { resumeLineups } = await import('../../lineup/runner');
  const deps = await makeTestDeps();
  process.env.DATA_DIR = deps.dir;
  const store = createLineupStore({ dir: deps.dir });
  const product = (id: string) => ({ id, title: id, category: 'mug', price: 10, currency: 'USD', imageUrl: `${id}.png`, link: 'https://x.test' }) as never;
  const film = async () => (await deps.films.create({ aspect: '9:16', brief: { text: 't', productAssetId: 'ast_x' }, assets: [] })).id;
  const [a, b, c] = [await film(), await film(), await film()];
  await store.create({
    id: 'lin_resume0001',
    aspect: '9:16',
    brief: '',
    createdAt: new Date().toISOString(),
    items: [
      { product: product('p1'), filmId: a, state: 'done' },
      { product: product('p2'), filmId: b, state: 'making' },
      { product: product('p3'), filmId: c, state: 'waiting' },
    ],
  });
  expect(resumeLineups(deps)).toEqual(['lin_resume0001']);
  for (let i = 0; i < 200 && (await store.get('lin_resume0001'))!.items.some((x) => x.state !== 'done'); i++) await new Promise((r) => setTimeout(r, 20));
  expect(order).toEqual([b, c]);
  expect((await store.get('lin_resume0001'))!.items.map((x) => x.state)).toEqual(['done', 'done', 'done']);
  expect(resumeLineups(deps)).toEqual([]);
});
