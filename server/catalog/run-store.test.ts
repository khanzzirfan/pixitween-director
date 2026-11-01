import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import type { AepCompositionJson } from '@shared/aep';
import { newCatalogId } from '@shared/catalog-run';
import { createRunStore, type RunStore } from './run-store';

const comp = (id: string): AepCompositionJson => ({
  version: '1.12.0',
  id,
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 120,
  layers: [],
  assets: {},
});

const product = (id: string) => ({ id, title: `Product ${id}`, price: 10, imageUrl: `fixtures/${id}.png`, category: 'drinks' });

const makeRun = (rows: number, createdAt = new Date().toISOString()) => ({
  id: newCatalogId(),
  filmId: 'film_0123456789ab',
  aspect: '9:16' as const,
  createdAt,
  state: 'running' as const,
  costUsd: 0,
  rows: Array.from({ length: rows }, (_, i) => ({ product: product(`p${i}`), status: 'queued' as const })),
});

let dir: string;
let store: RunStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'catalog-'));
  store = createRunStore({ dir });
});

it('creates a run and reads it back', async () => {
  const run = makeRun(2);
  await store.create(run);
  const got = await store.get(run.id);
  expect(got?.id).toBe(run.id);
  expect(got?.rows.map((r) => r.product.id)).toEqual(['p0', 'p1']);
  expect(got?.rows[0]?.status).toBe('queued');
  expect(got?.rows[0]?.clipVersion).toBe(0);
  expect(existsSync(join(dir, 'catalogs', run.id, 'run.json'))).toBe(true);
  expect(await store.get('cat_00000000')).toBeUndefined();
});

it('refuses to create the same run twice', async () => {
  const run = makeRun(1);
  await store.create(run);
  await expect(store.create(run)).rejects.toThrow(/exists/);
});

it('keeps all 20 concurrent row updates', async () => {
  const run = makeRun(20);
  await store.create(run);
  await Promise.all(run.rows.map((r, i) => store.updateRow(run.id, r.product.id, { status: 'ready', ms: i })));
  const got = await store.get(run.id);
  expect(got?.rows.map((r) => r.status)).toEqual(Array.from({ length: 20 }, () => 'ready'));
  expect(got?.rows.map((r) => r.ms)).toEqual(Array.from({ length: 20 }, (_, i) => i));
});

it('bumps the clip version on every saved clip and keeps the last one', async () => {
  const run = makeRun(1);
  await store.create(run);
  await store.saveClip(run.id, 'p0', comp('first'));
  const row = await store.saveClip(run.id, 'p0', comp('second'));
  expect(row.clipVersion).toBe(2);
  const got = await store.get(run.id);
  expect(got?.rows[0]?.clipVersion).toBe(2);
  const clip = await store.readClip(run.id, 'p0');
  expect(clip?.id).toBe('second');
  expect(await store.readClip(run.id, 'nope')).toBeUndefined();
});

it('stores the build input next to the clip', async () => {
  const run = makeRun(1);
  await store.create(run);
  await store.saveBuild(run.id, 'p0', { aspect: '9:16', price: 10 });
  expect(await store.readBuild<{ price: number }>(run.id, 'p0')).toEqual({ aspect: '9:16', price: 10 });
  expect(await store.readBuild(run.id, 'nope')).toBeUndefined();
});

it('refuses a product id that would leave the catalog dir', async () => {
  const run = makeRun(1);
  await store.create(run);
  await expect(store.updateRow(run.id, '../x', { status: 'ready' })).rejects.toThrow(RangeError);
  await expect(store.saveClip(run.id, '../x', comp('nope'))).rejects.toThrow(RangeError);
  await expect(store.readClip(run.id, '../x')).rejects.toThrow(RangeError);
  await expect(store.saveBuild(run.id, '../x', {})).rejects.toThrow(RangeError);
  await expect(store.readBuild(run.id, '../x')).rejects.toThrow(RangeError);
  expect(readdirSync(dir)).toEqual(['catalogs']);
  expect(existsSync(join(dir, 'x.json'))).toBe(false);
  expect(existsSync(join(dir, 'catalogs', 'x.json'))).toBe(false);
  expect((await store.get(run.id))?.rows[0]?.status).toBe('queued');
});

it('validates the patched row and leaves the run alone when it does not fit', async () => {
  const run = makeRun(1);
  await store.create(run);
  await expect(store.updateRow(run.id, 'p0', { status: 'nope' as never })).rejects.toThrow();
  await expect(store.updateRow(run.id, 'nope', { status: 'ready' })).rejects.toThrow(/row not found/);
  const got = await store.get(run.id);
  expect(got?.rows[0]?.status).toBe('queued');
  expect(got?.rows[0]?.clipVersion).toBe(0);
});

it('patches a row from the row as it is now', async () => {
  const run = makeRun(1);
  await store.create(run);
  const row = await store.updateRow(run.id, 'p0', (r) => ({ clipVersion: r.clipVersion + 3 }));
  expect(row.clipVersion).toBe(3);
  expect((await store.get(run.id))?.rows[0]?.clipVersion).toBe(3);
});

it('lists the runs newest first', async () => {
  const older = makeRun(1, '2026-01-01T00:00:00.000Z');
  const newer = makeRun(1, '2026-06-01T00:00:00.000Z');
  await store.create(older);
  await store.create(newer);
  expect((await store.list()).map((r) => r.id)).toEqual([newer.id, older.id]);
});

it('sets the state and the cost of a run', async () => {
  const run = makeRun(1);
  await store.create(run);
  const done = await store.setRun(run.id, { state: 'done', costUsd: 0.02 });
  expect(done.state).toBe('done');
  expect(done.costUsd).toBe(0.02);
  expect((await store.get(run.id))?.costUsd).toBe(0.02);
});
