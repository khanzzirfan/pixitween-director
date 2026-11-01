import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFeed, type Product } from '@shared/catalog';
import { isFinal, newCatalogId, type CatalogRun } from '@shared/catalog-run';
import { filmEventSchema, makeEvent } from '@shared/events';
import { makeTestFilm } from '../test-utils/film';
import { fakeArt } from './art';
import { createCutoutCache } from './photos';
import { createRunStore } from './run-store';
import { nounOf, runCatalog, type CatalogEvent, type PlateRef } from './runner';

// The demo feed: six products, two photos, two categories. Every photo is a repo path, so the
// run reads them from the disk and spends nothing on the fake art.
const FEED = 'fixtures/catalog/feed-6.csv';

const feed = (): Product[] => {
  const parsed = parseFeed(readFileSync(FEED, 'utf8'));
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  return parsed.products;
};

const rowEvents = (events: CatalogEvent[]) =>
  events.filter((e): e is Extract<CatalogEvent, { type: 'catalog.row' }> => e.type === 'catalog.row');

/** A run over the given products, on a temp dir with the fake art and its own cut-out cache. */
async function setup(products: Product[]) {
  const film = await makeTestFilm();
  const store = createRunStore({ dir: film.dir });
  const art = fakeArt(film.assets);
  const cutCache = createCutoutCache(film.dir);
  const plates = new Map<string, PlateRef>();
  const emitted: CatalogEvent[] = [];
  const run: CatalogRun = await store.create({
    id: newCatalogId(),
    filmId: film.filmId,
    aspect: '9:16',
    createdAt: new Date().toISOString(),
    state: 'running',
    costUsd: 0,
    rows: products.map((product) => ({ product, status: 'queued' })),
  });
  const go = () =>
    runCatalog({
      run,
      store,
      art,
      assets: film.assets,
      uploads: new Map(),
      cutCache,
      plates,
      emit: (e) => emitted.push(e),
    });
  return { filmId: film.filmId, assets: film.assets, store, art, cutCache, plates, emitted, run, go };
}

describe('runCatalog', () => {
  it('builds every product of the feed and ends the run once', async () => {
    const t = await setup(feed());

    await t.go();

    const run = await t.store.get(t.run.id);
    expect(run?.rows).toHaveLength(6);
    expect(run?.rows.every((r) => isFinal(r.status))).toBe(true);
    expect(run?.state).toBe('done');
    const done = t.emitted.filter((e) => e.type === 'catalog.done');
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ catalogId: t.run.id, costUsd: 0 });
  });

  it('takes a row through cutting, building and checking to its verdict', async () => {
    const t = await setup(feed());

    await t.go();

    const statuses = rowEvents(t.emitted)
      .filter((e) => e.row.product.id === 'cb-original')
      .map((e) => e.row.status);
    expect(statuses.slice(0, 3)).toEqual(['cutting', 'building', 'checking']);
    expect(['ready', 'fixed', 'flagged']).toContain(statuses.at(-1));
  });

  it('saves the clip and the build input of every row, so a price edit can rebuild them', async () => {
    const t = await setup(feed());

    await t.go();

    const clip = await t.store.readClip(t.run.id, 'cb-original');
    expect(clip?.layers.length).toBeGreaterThan(0);
    const build = await t.store.readBuild<{ title: string; price: number }>(t.run.id, 'cb-original');
    expect(build?.title).toBe('Coffee Co. Cold Brew');
    expect(build?.price).toBe(4.5);
  });

  it('emits events the film event log accepts, so the wall can watch them', async () => {
    const t = await setup(feed());

    await t.go();

    // every row's four states, plus the run's end
    expect(t.emitted).toHaveLength(25);
    const events = t.emitted.map((e) => makeEvent(t.filmId, e));
    expect(events.every((e) => filmEventSchema.safeParse(e).success)).toBe(true);
    expect(events.filter((e) => e.type === 'catalog.done')).toHaveLength(1);
  });

  it('cuts one photo once, and a second run that shares the cache cuts nothing', async () => {
    const t = await setup(feed());

    await t.go();

    // two distinct photos in the feed, so two cut-outs
    expect(t.art.calls.cut).toBe(2);

    const second: CatalogRun = { ...t.run, id: newCatalogId(), createdAt: new Date().toISOString() };
    await t.store.create(second);
    const fresh = fakeArt(t.assets);
    await runCatalog({
      run: second,
      store: t.store,
      art: fresh,
      assets: t.assets,
      uploads: new Map(),
      cutCache: t.cutCache,
      plates: t.plates,
      emit: () => undefined,
    });

    // the cut-outs and the plate were paid for already, so the second run asks for none
    expect(fresh.calls).toEqual({ cut: 0, plate: 0 });
    const again = await t.store.get(second.id);
    expect(again?.costUsd).toBe(0);
    // and it is a run that worked, not a run that failed before it needed a cut-out
    expect(again?.rows.every((r) => isFinal(r.status) && r.status !== 'failed')).toBe(true);
  });

  it('fails the row whose photo is not there, and finishes the others', async () => {
    const products = feed().map((p) => (p.id === 'cb-mocha' ? { ...p, imageUrl: 'fixtures/nope.png' } : p));
    const t = await setup(products);

    await t.go();

    const run = await t.store.get(t.run.id);
    const failed = run?.rows.find((r) => r.product.id === 'cb-mocha');
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('photo not found: fixtures/nope.png');
    const others = run?.rows.filter((r) => r.product.id !== 'cb-mocha') ?? [];
    expect(others).toHaveLength(5);
    expect(others.every((r) => isFinal(r.status) && r.status !== 'failed')).toBe(true);
    expect(t.emitted.filter((e) => e.type === 'catalog.done')).toHaveLength(1);
  });
});

describe('nounOf', () => {
  const product = (title: string, category: string) => ({ id: 'x', title, price: 10, imageUrl: 'fixtures/x.png', category }) as Product;

  it('keeps the category nouns of the demo feed', () => {
    expect(nounOf(product('Coffee Co. Cold Brew', 'drinks'))).toBe('can');
    expect(nounOf(product('Stone Mug', 'home'))).toBe('mug');
  });

  it('names the thing from the category or title words', () => {
    expect(nounOf(product("Wave Rider 9'0 Longboard", 'beach summer surfboard'))).toBe('surfboard');
    expect(nounOf(product('Clear Water Swim Goggles', 'swim summer'))).toBe('goggles');
    expect(nounOf(product('Ice Cold Beach Cooler', 'beach summer drinks'))).toBe('cooler');
  });

  it('falls back to the last word of the title, then to product', () => {
    expect(nounOf(product('Reef Sandals', 'beach'))).toBe('sandals');
    expect(nounOf(product('A1', 'misc'))).toBe('product');
  });
});
