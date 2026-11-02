import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { isFinal, newCatalogId, type CatalogRow, type CatalogRun } from '@shared/catalog-run';
import type { FilmEvent } from '@shared/events';
import { fakeArt } from '../../catalog/art';
import { createRunStore } from '../../catalog/run-store';
import { makeTestDeps } from '../../test-utils/deps';
import { createApp } from '../app';
import { registerCatalogRoutes } from './catalogs';

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.DIRECTOR_PASSCODE;
  process.env.DIRECTOR_FAKE = '1';
});
afterEach(() => {
  process.env = { ...saved };
});

/** An app over temp-dir stores, with the free fake art and a plates file of its own. */
async function setup() {
  const deps = await makeTestDeps();
  const art = fakeArt(deps.assets);
  const app = new Hono();
  const platesFile = join(mkdtempSync(join(tmpdir(), 'plates-')), 'look-plates.json');
  registerCatalogRoutes(app, deps, { art: () => art, platesFile });
  return { deps, art, app, store: createRunStore({ dir: deps.dir }) };
}

/** Waits for a run to finish, the way the wall polls it. */
async function waitFor(store: ReturnType<typeof createRunStore>, catalogId: string): Promise<CatalogRun> {
  const deadline = Date.now() + 10_000;
  let run = await store.get(catalogId);
  while (run?.state !== 'done' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
    run = await store.get(catalogId);
  }
  return run!;
}

/** Starts a run from the demo feed and waits for it to finish. */
async function startDemo(app: Hono, store: ReturnType<typeof createRunStore>): Promise<CatalogRun> {
  const form = new FormData();
  form.set('demo', 'feed-6');
  const res = await app.request('/api/catalogs', { method: 'POST', body: form });
  expect(res.status).toBe(202);
  const { catalogId } = (await res.json()) as { catalogId: string };
  return waitFor(store, catalogId);
}

/** Every text a composition shows: the layers of the scene and of every precomp in it. */
function textsOf(comp: unknown): string[] {
  const out: string[] = [];
  const walk = (c: any): void => {
    for (const layer of c?.layers ?? []) {
      if (layer.kind !== 'text') continue;
      const source = layer.source;
      out.push(typeof source === 'string' ? source : (source?.[0]?.v ?? ''));
    }
    for (const sub of Object.values(c?.precomps ?? {})) walk(sub);
  };
  walk(comp);
  return out;
}

/** The texts of a row's clip, read back the way the wall reads them. */
async function clipTexts(app: Hono, catalogId: string, productId: string): Promise<string[]> {
  const res = await app.request(`/api/catalogs/${catalogId}/clips/${productId}`);
  expect(res.status).toBe(200);
  return textsOf(await res.json());
}

/** A price edit of one product of a run. */
function edit(app: Hono, catalogId: string, productId: string, body: unknown) {
  return app.request(`/api/catalogs/${catalogId}/products/${productId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Waits for the wall to hear about a row, the way the browser's stream does. */
async function waitForRow(events: FilmEvent[], seen: number, productId: string): Promise<CatalogRow> {
  type RowEvent = Extract<FilmEvent, { type: 'catalog.row' }>;
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const event = events
      .slice(seen)
      .find((e): e is RowEvent => e.type === 'catalog.row' && e.row.product.id === productId);
    if (event) return event.row;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`no catalog.row event for ${productId}`);
}

it('starts a run from the demo feed and answers 202 with a catalog id and a film id', async () => {
  const { app } = await setup();

  const form = new FormData();
  form.set('demo', 'feed-6');
  const res = await app.request('/api/catalogs', { method: 'POST', body: form });

  expect(res.status).toBe(202);
  const body = (await res.json()) as { catalogId: string; filmId: string };
  expect(body.catalogId).toMatch(/^cat_/);
  expect(typeof body.filmId).toBe('string');
  expect(body.filmId.length).toBeGreaterThan(0);
});

it('refuses a feed whose header is missing columns, and says which ones', async () => {
  const { app } = await setup();

  const form = new FormData();
  form.set('csv', 'id,title\nx,y');
  const res = await app.request('/api/catalogs', { method: 'POST', body: form });

  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string; errors: string[] };
  expect(body.error).toBe('bad_feed');
  expect(body.errors.length).toBeGreaterThan(0);
  expect(body.errors.join(' ')).toContain('price');
});

it('takes a feed sent as a file, not only as text', async () => {
  const { app, store } = await setup();

  const form = new FormData();
  form.set('csv', new File(['id,title,price,image_link,category\nx,Test,4.50,fixtures/s13/can-product.png,drinks'], 'feed.csv'));
  const res = await app.request('/api/catalogs', { method: 'POST', body: form });

  expect(res.status).toBe(202);
  const { catalogId } = (await res.json()) as { catalogId: string };
  const run = await waitFor(store, catalogId);
  expect(run.rows).toHaveLength(1);
  expect(run.rows[0]?.status).not.toBe('failed');
});

it('refuses a feed with more products than a run may carry', async () => {
  const { app } = await setup();

  const rows = Array.from({ length: 51 }, (_, i) => `p${i},Product ${i},4.50,fixtures/s13/can-product.png,drinks`).join('\n');
  const form = new FormData();
  form.set('csv', `id,title,price,image_link,category\n${rows}`);
  const res = await app.request('/api/catalogs', { method: 'POST', body: form });

  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe('too_many_products');
});

it('asks for a feed when neither a CSV nor the demo feed came with the request', async () => {
  const { app } = await setup();

  const res = await app.request('/api/catalogs', { method: 'POST', body: new FormData() });

  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe('feed_required');
});

it('refuses a demo feed it does not know', async () => {
  const { app } = await setup();

  const form = new FormData();
  form.set('demo', 'feed-99');
  const res = await app.request('/api/catalogs', { method: 'POST', body: form });

  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe('bad_demo');
});

it('builds every product of the demo feed and hands the run back with its final rows', async () => {
  const { app, store } = await setup();

  const run = await startDemo(app, store);

  expect(run.state).toBe('done');
  expect(run.rows).toHaveLength(6);
  expect(run.rows.every((row) => isFinal(row.status))).toBe(true);
  const res = await app.request(`/api/catalogs/${run.id}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as CatalogRun;
  expect(body.rows).toHaveLength(6);
  expect(body.rows.every((row) => isFinal(row.status))).toBe(true);
});

it('hands back a clip with a frame rate and a length once the row is final', async () => {
  const { app, store } = await setup();

  const run = await startDemo(app, store);

  const res = await app.request(`/api/catalogs/${run.id}/clips/cb-original`);
  expect(res.status).toBe(200);
  const clip = (await res.json()) as { fps: number; durationInFrames: number; layers: unknown[] };
  expect(clip.fps).toBe(30);
  expect(clip.durationInFrames).toBeGreaterThan(0);
  expect(clip.layers.length).toBeGreaterThan(0);
});

it('lists the runs it knows, newest first', async () => {
  const { app, store } = await setup();

  const run = await startDemo(app, store);

  const res = await app.request('/api/catalogs');
  expect(res.status).toBe(200);
  const body = (await res.json()) as { runs: { id: string; total: number; final: number; state: string }[] };
  expect(body.runs[0]).toMatchObject({ id: run.id, state: 'done', total: 6, final: 6 });
});

it('answers 404 for a run that is not there and for a clip that was never built', async () => {
  const { app, store } = await setup();

  const run = await startDemo(app, store);

  const missing = await app.request('/api/catalogs/cat_0123456789ab');
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: 'not_found' });
  const noClip = await app.request(`/api/catalogs/${run.id}/clips/nope`);
  expect(noClip.status).toBe(404);
});

it('is registered by the app itself, so the studio reaches it without the CLI', async () => {
  const deps = await makeTestDeps();

  const res = await createApp(deps).request('/api/catalogs');

  expect(res.status).toBe(200);
  expect((await res.json()).runs).toEqual([]);
});

it('answers 503 when the real art is asked for and no meta key is configured', async () => {
  delete process.env.DIRECTOR_FAKE;
  delete process.env.META_API_KEY;
  delete process.env.MODEL_API_KEY;
  const deps = await makeTestDeps();
  const app = new Hono();
  registerCatalogRoutes(app, deps);

  const form = new FormData();
  form.set('demo', 'feed-6');
  const res = await app.request('/api/catalogs', { method: 'POST', body: form });

  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: 'meta_key_missing' });
});

it('rebuilds a clip with the new price, for nothing', async () => {
  const { app, store, art } = await setup();

  const run = await startDemo(app, store);
  const before = { ...art.calls };
  const version = run.rows.find((r) => r.product.id === 'mug-stone')!.clipVersion;

  const res = await edit(app, run.id, 'mug-stone', { price: 21, salePrice: null });

  expect(res.status).toBe(200);
  const body = (await res.json()) as { row: CatalogRow };
  expect(body.row.product.price).toBe(21);
  expect(body.row.product.salePrice).toBeUndefined();
  expect(body.row.clipVersion).toBe(version + 1);
  expect(typeof body.row.ms).toBe('number');
  expect(body.row.ms).toBeLessThan(2000);

  // the clip now shows the new price and no longer the old one
  const texts = await clipTexts(app, run.id, 'mug-stone');
  expect(texts).toContain('$21.00');
  expect(texts.some((t) => t.includes('$24.00'))).toBe(false);
  expect(texts.some((t) => t.includes('$19.00'))).toBe(false);

  // the edit spent nothing: no cut-out and no plate were asked for
  expect(before.cut).toBeGreaterThan(0);
  expect(before.plate).toBeGreaterThan(0);
  expect(art.calls).toEqual(before);
});

it('tells the wall about the new row', async () => {
  const { app, store, deps } = await setup();

  const run = await startDemo(app, store);
  const seen = deps.events.length;

  await edit(app, run.id, 'mug-stone', { price: 21, salePrice: null });

  const row = await waitForRow(deps.events, seen, 'mug-stone');
  expect(row.product.price).toBe(21);
  expect(row.status).not.toBe('queued');
});

it('keeps the sale on and shows the old price beside it', async () => {
  const { app, store } = await setup();

  const run = await startDemo(app, store);

  const res = await edit(app, run.id, 'mug-sage', { salePrice: 19 });

  expect(res.status).toBe(200);
  const body = (await res.json()) as { row: CatalogRow };
  expect(body.row.product.price).toBe(24);
  expect(body.row.product.salePrice).toBe(19);
  const texts = await clipTexts(app, run.id, 'mug-sage');
  expect(texts).toContain('$19.00');
  expect(texts).toContain('$24.00');
});

it('refuses an edit that is not a price, a sale price or a title', async () => {
  const { app, store } = await setup();

  const run = await startDemo(app, store);

  const negative = await edit(app, run.id, 'mug-stone', { price: -1 });
  expect(negative.status).toBe(400);
  expect(await negative.json()).toEqual({ error: 'bad_edit' });

  const emptyTitle = await edit(app, run.id, 'mug-stone', { title: '' });
  expect(emptyTitle.status).toBe(400);
  expect(await emptyTitle.json()).toEqual({ error: 'bad_edit' });

  const nonsense = await edit(app, run.id, 'mug-stone', { price: 'free' });
  expect(nonsense.status).toBe(400);
  expect(await nonsense.json()).toEqual({ error: 'bad_edit' });
});

it('answers 404 for a run that is not there and for a product that is not in it', async () => {
  const { app, store } = await setup();

  const run = await startDemo(app, store);

  const noRun = await edit(app, 'cat_0123456789ab', 'mug-stone', { price: 21 });
  expect(noRun.status).toBe(404);
  expect(await noRun.json()).toEqual({ error: 'not_found' });

  const noProduct = await edit(app, run.id, 'nope', { price: 21 });
  expect(noProduct.status).toBe(404);
  expect(await noProduct.json()).toEqual({ error: 'not_found' });
});

/** A build input a row could have been built from, so a row that is not ready still has one. */
const aBuild = (price: number) => ({
  aspect: '9:16',
  look: 'lifestyle-room',
  product: { id: 'ast_cut', src: '/api/assets/ast_cut', width: 400, height: 400 },
  title: 'Stone Mug',
  price,
  accent: '#cfaa86',
});

it('refuses to edit a row whose build is gone', async () => {
  const { app, store } = await setup();

  const id = newCatalogId();
  await store.create({
    id,
    filmId: 'film_test',
    aspect: '9:16',
    createdAt: new Date().toISOString(),
    state: 'done',
    costUsd: 0,
    rows: [
      {
        product: { id: 'mug-stone', title: 'Stone Mug', price: 24, imageUrl: 'fixtures/seed/mug-product.png', category: 'home' },
        status: 'ready',
      },
    ],
  });

  const res = await edit(app, id, 'mug-stone', { price: 21 });

  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: 'not_ready' });
});

it('refuses to edit a row whose build is not the one the clip is built from', async () => {
  const { app, store } = await setup();

  const id = newCatalogId();
  await store.create({
    id,
    filmId: 'film_test',
    aspect: '9:16',
    createdAt: new Date().toISOString(),
    state: 'done',
    costUsd: 0,
    rows: [
      {
        product: { id: 'mug-stone', title: 'Stone Mug', price: 24, imageUrl: 'fixtures/seed/mug-product.png', category: 'home' },
        status: 'ready',
      },
    ],
  });
  // a build without the colour the clip is drawn in: it cannot be rebuilt from
  await store.saveBuild(id, 'mug-stone', { ...aBuild(24), accent: undefined });

  const res = await edit(app, id, 'mug-stone', { price: 21 });

  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: 'not_ready' });
  // and the row was left alone
  const run = await store.get(id);
  expect(run!.rows[0]!.product.price).toBe(24);
  expect(run!.rows[0]!.clipVersion).toBe(0);
});

it('refuses to edit a row that is not ready', async () => {
  const { app, store } = await setup();

  const id = newCatalogId();
  await store.create({
    id,
    filmId: 'film_test',
    aspect: '9:16',
    createdAt: new Date().toISOString(),
    state: 'running',
    costUsd: 0,
    rows: [
      {
        product: { id: 'mug-stone', title: 'Stone Mug', price: 24, imageUrl: 'fixtures/seed/mug-product.png', category: 'home' },
        status: 'checking',
      },
    ],
  });
  // the row has a build, so only its state can stop the edit
  await store.saveBuild(id, 'mug-stone', aBuild(24));

  const res = await edit(app, id, 'mug-stone', { price: 21 });

  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: 'not_ready' });
});

it('refuses to edit a row that failed', async () => {
  const { app, store } = await setup();

  const id = newCatalogId();
  await store.create({
    id,
    filmId: 'film_test',
    aspect: '9:16',
    createdAt: new Date().toISOString(),
    state: 'done',
    costUsd: 0,
    rows: [
      {
        product: { id: 'mug-stone', title: 'Stone Mug', price: 24, imageUrl: 'fixtures/seed/mug-product.png', category: 'home' },
        status: 'failed',
        error: 'photo not found: fixtures/seed/mug-product.png',
      },
    ],
  });
  await store.saveBuild(id, 'mug-stone', aBuild(24));

  const res = await edit(app, id, 'mug-stone', { price: 21 });

  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: 'not_ready' });
});


it('refuses a sale price that is not below the price', async () => {
  const { app, store } = await setup();
  const run = await startDemo(app, store);

  const res = await edit(app, run.id, 'mug-stone', { price: 19, salePrice: 21 });

  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toBe('bad_edit');
  const row = (await store.get(run.id))!.rows.find((r) => r.product.id === 'mug-stone')!;
  expect(row.product.price).toBe(24);
});

it('settles a run whose runner is gone, so its wall finishes', async () => {
  const { app, store } = await setup();

  // a run left `running` by a server that stopped mid-run: one row done, one still moving
  const id = newCatalogId();
  await store.create({
    id,
    filmId: 'film_test',
    aspect: '9:16',
    createdAt: new Date().toISOString(),
    state: 'running',
    costUsd: 0,
    rows: [
      { product: { id: 'mug-stone', title: 'Stone Mug', price: 24, imageUrl: 'fixtures/seed/mug-product.png', category: 'home' }, status: 'ready' },
      { product: { id: 'mug-sage', title: 'Sage Mug', price: 24, imageUrl: 'fixtures/seed/mug-product.png', category: 'home' }, status: 'building' },
    ],
  });

  const res = await app.request(`/api/catalogs/${id}`);
  const run = (await res.json()) as CatalogRun;

  expect(run.state).toBe('done');
  expect(run.rows[0]!.status).toBe('ready');
  expect(run.rows[1]!.status).toBe('failed');
  expect(run.rows[1]!.error).toMatch(/server restarted/);
  expect((await store.get(id))!.state).toBe('done');
});

it('leaves a run that is still being built alone', async () => {
  const { app } = await setup();
  const form = new FormData();
  form.set('demo', 'feed-6');
  const { catalogId } = (await (await app.request('/api/catalogs', { method: 'POST', body: form })).json()) as { catalogId: string };

  // read at once, while the runner is still on its first rows
  const run = (await (await app.request(`/api/catalogs/${catalogId}`)).json()) as CatalogRun;
  expect(run.rows.some((r) => r.status === 'failed')).toBe(false);
});

it('keeps a fake run out of the cut-out cache a real run reads', async () => {
  const { app, store, deps } = await setup();
  await startDemo(app, store);
  expect(existsSync(join(deps.dir, 'catalogs', 'cutouts.json'))).toBe(false);
});

it('cuts a line film per brand when the run ends, and hands it back', async () => {
  const { app, store } = await setup();
  const run = await startDemo(app, store);

  expect(run.films?.map((f) => [f.id, f.productIds.length, f.version])).toEqual([
    ['line-coffee-co', 3, 1],
    ['line-hearth', 3, 1],
  ]);
  const res = await app.request(`/api/catalogs/${run.id}/films/line-hearth`);
  expect(res.status).toBe(200);
  const texts = textsOf(await res.json());
  expect(texts).toContain('$19.00');
  expect((await app.request(`/api/catalogs/${run.id}/films/line-nope`)).status).toBe(404);
});

it('cuts the line film again after a price edit, with the new price', async () => {
  const { app, store } = await setup();
  const run = await startDemo(app, store);

  const res = await edit(app, run.id, 'mug-stone', { price: 21, salePrice: null });
  expect(res.status).toBe(200);

  const after = await store.get(run.id);
  expect(after!.films!.find((f) => f.id === 'line-hearth')!.version).toBe(2);
  expect(after!.films!.find((f) => f.id === 'line-coffee-co')!.version).toBe(1);
  const texts = textsOf(await (await app.request(`/api/catalogs/${run.id}/films/line-hearth`)).json());
  expect(texts).toContain('$21.00');
  expect(texts).not.toContain('$19.00');
});

it('cuts a hero film for every finished row, and hands it back', async () => {
  const { app, store, art } = await setup();
  const run = await startDemo(app, store);

  expect(run.rows.every((r) => r.hero?.version === 1 && r.hero.source === 'floor')).toBe(true);
  expect(art.calls.direct).toBe(run.rows.length);
  const res = await app.request(`/api/catalogs/${run.id}/heroes/mug-stone`);
  expect(res.status).toBe(200);
  const texts = textsOf(await res.json());
  expect(texts).toContain('$19.00');
  expect(texts).toContain('$24.00');
  expect((await app.request(`/api/catalogs/${run.id}/heroes/nope`)).status).toBe(404);
});

it('cuts the hero film again after a price edit, from its stored board, without asking Muse', async () => {
  const { app, store, art } = await setup();
  const run = await startDemo(app, store);
  const directed = art.calls.direct;

  const res = await edit(app, run.id, 'mug-stone', { price: 21, salePrice: null });
  const body = (await res.json()) as { row: CatalogRow };
  expect(body.row.hero?.version).toBe(2);
  expect(art.calls.direct).toBe(directed);
  const texts = textsOf(await (await app.request(`/api/catalogs/${run.id}/heroes/mug-stone`)).json());
  expect(texts).toContain('$21.00');
  expect(texts).not.toContain('$19.00');
});

it('hands the campaign brief to every film, keeps it on the run, and refuses one that is too long', async () => {
  const { app, store, art } = await setup();
  const form = new FormData();
  form.set('demo', 'feed-6');
  form.set('brief', '  Summer holiday sale: beach, surf, swim.  ');
  const res = await app.request('/api/catalogs', { method: 'POST', body: form });
  expect(res.status).toBe(202);
  const run = await waitFor(store, ((await res.json()) as { catalogId: string }).catalogId);

  expect(run.brief).toBe('Summer holiday sale: beach, surf, swim.');
  expect(art.directed).toHaveLength(run.rows.length);
  expect(art.directed.every((d) => d.brief === run.brief)).toBe(true);

  const long = new FormData();
  long.set('demo', 'feed-6');
  long.set('brief', 'x'.repeat(601));
  expect((await app.request('/api/catalogs', { method: 'POST', body: long })).status).toBe(400);
});

it('plays every hero film in the 3D world, a flat product as its own extruded cut-out', async () => {
  const { app, store } = await setup();
  const run = await startDemo(app, store);
  const comp = (await (await app.request(`/api/catalogs/${run.id}/heroes/mug-stone`)).json()) as any;
  const layers = Object.values(comp.precomps as Record<string, any>).flatMap((p) => p.layers as any[]);
  expect(layers.some((l) => l.kind === 'stage3d')).toBe(true);
  const product = layers.find((l) => l.role === 'product' && l.kind === 'prop3d');
  expect(product?.source.type === 'extrude' || product?.source.type === 'primitive').toBe(true);
});
