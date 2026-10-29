import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { FilmStore } from '@shared/ports';
import { lightValidator } from '../engine/validate';
import { fixturePath } from '../test-utils/fixtures';
import { FilmNotFoundError, createFilmStore } from './film-store';

const load = (dir: string, f: string) => JSON.parse(readFileSync(fixturePath('s02', `${dir}/${f}.json`), 'utf8')) as AepCompositionJson;
const shape = load('valid', 'shape-only');
const text = load('valid', 'text');
const dup = load('invalid', 'dup-id');

let store: FilmStore;
let id: string;
const brief = { aspect: '16:9' as const, brief: { text: 'x', productAssetId: 'ast_' + '0'.repeat(32) }, assets: [] };

beforeEach(async () => {
  store = createFilmStore({ dir: mkdtempSync(join(tmpdir(), 'films-')), validator: lightValidator });
  id = (await store.create(brief)).id;
});

const withLayer = (c: AepCompositionJson, n: number): AepCompositionJson => ({
  ...c,
  layers: [...c.layers, { ...c.layers[0]!, id: `extra-${n}` }],
});

it('creates a film', async () => {
  const f = await store.get(id);
  expect(f).toMatchObject({ id, status: 'new', version: 0, costUsd: 0, clippyCredits: 0 });
  expect(f.composition).toBeUndefined();
  expect(id).toMatch(/^film_[a-f0-9]{12}$/);
});

it('round-trips the crew fields and loads a film written before them', async () => {
  const child = await store.create({ ...brief, parentId: 'film_aaaaaaaaaaaa', crew: false });
  expect((await store.get(child.id)).parentId).toBe('film_aaaaaaaaaaaa');
  await store.update(id, { storyboardRev: 3 });
  expect((await store.get(id)).storyboardRev).toBe(3);
  const bible = { palette: ['#111111', '#222222'], light: 'l', camera: 'c', type: { font: 'Inter', weight: 700, case: 'upper' as const }, productLine: 'p', mood: 'm' };
  await store.update(id, { styleBible: bible });
  expect((await store.get(id)).styleBible).toEqual(bible);
  const old = await store.create(brief);
  expect((await store.get(old.id)).crew).toBeUndefined();
});

it('commits versions, rejects invalid ones, and lists them', async () => {
  expect(await store.commit(id, shape, 'director')).toEqual({ ok: true, version: 1 });
  expect(await store.commit(id, text, 'chat', 'note')).toEqual({ ok: true, version: 2 });
  const f = await store.get(id);
  expect(f.version).toBe(2);
  expect(f.composition).toEqual(text);
  const bad = await store.commit(id, dup, 'director');
  expect(bad.ok).toBe(false);
  expect((await store.versions(id)).map((v) => v.version)).toEqual([1, 2]);
  expect((await store.versions(id))[1]).toMatchObject({ source: 'chat', note: 'note' });
});

it('undo, redo, and a commit after undo discards the redo tail', async () => {
  await store.commit(id, shape, 'director');
  await store.commit(id, text, 'director');
  expect(await store.undo(id)).toBe(1);
  expect(await store.redo(id)).toBe(2);
  expect(await store.undo(id)).toBe(1);
  expect(await store.commit(id, withLayer(shape, 1), 'user')).toEqual({ ok: true, version: 3 });
  expect(await store.redo(id)).toBe(3);
  expect(await store.undo(id)).toBe(1); // version 3's parent is 1
  expect((await store.versions(id)).map((v) => v.version)).toEqual([1, 2, 3]);
  expect(await store.undo(id)).toBe(1); // at the root
});

it('serialises 10 concurrent commits', async () => {
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => store.commit(id, withLayer(shape, i), 'director')));
  expect(rs.map((r) => (r.ok ? r.version : -1)).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

it('mutate: 20 concurrent adds lose no update', async () => {
  await store.commit(id, shape, 'director');
  const rs = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      store.mutate(id, (f) => ({ next: withLayer(f.composition!, i), data: i }), 'director'),
    ),
  );
  expect(rs.every((r) => r.ok)).toBe(true);
  const f = await store.get(id);
  expect(f.composition!.layers).toHaveLength(21);
  expect(f.version).toBe(21);
  expect((await store.versions(id)).map((v) => v.version)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
});

it('mutate: a throwing fn stores nothing and does not block', async () => {
  await store.commit(id, shape, 'director');
  await expect(store.mutate(id, () => { throw new Error('boom'); }, 'director')).rejects.toThrow('boom');
  expect((await store.versions(id)).length).toBe(1);
  expect((await store.mutate(id, (f) => ({ next: withLayer(f.composition!, 1), data: 1 }), 'director')).ok).toBe(true);
});

it('mutate: an invalid result returns ok false and stores nothing', async () => {
  await store.commit(id, shape, 'director');
  const r = await store.mutate(id, () => ({ next: dup, data: 0 }), 'director');
  expect(r.ok).toBe(false);
  expect((await store.versions(id)).length).toBe(1);
});

it('mutate: passes an undefined composition before the first commit', async () => {
  let seen: unknown = 'unset';
  await store.mutate(id, (f) => { seen = f.composition; return { next: shape, data: null }; }, 'director');
  expect(seen).toBeUndefined();
});

it('refuses malformed ids and sums the ledger', async () => {
  await expect(store.get('film_../x')).rejects.toBeInstanceOf(FilmNotFoundError);
  await expect(store.get('film_000000000000')).rejects.toBeInstanceOf(FilmNotFoundError);
});

it('lists newest first', async () => {
  const second = await store.create({ ...brief, createdAt: new Date(Date.now() + 5000).toISOString() });
  expect((await store.list()).map((f) => f.id)).toEqual([second.id, id]);
});

it('derives cost from ledger.jsonl', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'films-'));
  const s = createFilmStore({ dir, validator: lightValidator });
  const f = await s.create(brief);
  const { createLedger } = await import('../ledger');
  const l = createLedger({ dir, emit: () => undefined });
  l.add(f.id, 'm', 'u', 0.25);
  l.addCredits(f.id, 25, 'n');
  expect(await s.get(f.id)).toMatchObject({ costUsd: 0.25, clippyCredits: 25 });
});
