import { describe, expect, it } from 'vitest';
import {
  CATALOG_ID_RE,
  catalogRowSchema,
  catalogRunSchema,
  isFinal,
  newCatalogId,
  summarize,
  type CatalogRow,
} from './catalog-run';
import { filmEventSchema, makeEvent } from './events';

const filmId = 'film_3fa9c2d41b7e';
const catalogId = 'cat_0123456789ab';

const product = {
  id: 'mug-stone',
  title: 'Stone Mug',
  price: 24,
  salePrice: 19,
  currency: 'USD',
  imageUrl: 'fixtures/s13/can-product.png',
  category: 'home',
  brand: 'Hearth',
};

const row = (status: CatalogRow['status']): CatalogRow => catalogRowSchema.parse({ product, status });

const run = (overrides: Record<string, unknown> = {}) =>
  catalogRunSchema.parse({
    id: catalogId,
    filmId,
    aspect: '9:16',
    createdAt: '2026-11-01T00:00:00.000Z',
    state: 'running',
    costUsd: 0,
    rows: [row('queued')],
    ...overrides,
  });

describe('catalogRunSchema', () => {
  it('accepts a run with one queued row and fills the row defaults', () => {
    const parsed = run();
    expect(parsed.id).toBe(catalogId);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.status).toBe('queued');
    expect(parsed.rows[0]!.clipVersion).toBe(0);
    expect(parsed.rows[0]!.check).toBeNull();
  });

  it('rejects a bad id', () => {
    expect(catalogRunSchema.safeParse(run({ id: 'x1' })).success).toBe(false);
    const bad = catalogRunSchema.safeParse(run({ id: 'x1' }));
    expect(!bad.success && bad.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects a run with no rows and a row with a bad status', () => {
    expect(catalogRunSchema.safeParse(run({ rows: [] })).success).toBe(false);
    expect(catalogRowSchema.safeParse({ product, status: 'polishing' }).success).toBe(false);
  });

  it('keeps a check verbatim: rounds, the applied move and the blocking kinds', () => {
    const checked = catalogRowSchema.parse({
      product,
      status: 'fixed',
      look: 'tabletop-hero',
      check: { ok: true, rounds: 2, applied: ['baseY 0.5 -> 0.7347'], blocking: [], warnings: ['TINY_TEXT caption_price'] },
    });
    expect(checked.check?.rounds).toBe(2);
    expect(checked.check?.applied[0]).toBe('baseY 0.5 -> 0.7347');
    expect(checked.check?.warnings).toEqual(['TINY_TEXT caption_price']);
  });
});

describe('newCatalogId', () => {
  it('makes a cat_ id of 12 hex chars', () => {
    const id = newCatalogId();
    expect(id).toMatch(CATALOG_ID_RE);
    expect(id).toMatch(/^cat_[0-9a-f]{12}$/);
    expect(newCatalogId()).not.toBe(id);
  });
});

describe('isFinal', () => {
  it('is true for the four final statuses and false while the row still works', () => {
    expect(isFinal('ready')).toBe(true);
    expect(isFinal('fixed')).toBe(true);
    expect(isFinal('flagged')).toBe(true);
    expect(isFinal('failed')).toBe(true);
    expect(isFinal('checking')).toBe(false);
    expect(isFinal('queued')).toBe(false);
    expect(isFinal('cutting')).toBe(false);
    expect(isFinal('building')).toBe(false);
  });
});

describe('summarize', () => {
  it('counts one row of each final status plus one queued', () => {
    const rows = ['ready', 'fixed', 'flagged', 'failed', 'queued'].map((status) => row(status as CatalogRow['status']));
    expect(summarize(rows)).toEqual({ total: 5, final: 4, ready: 1, fixed: 1, flagged: 1, failed: 1 });
  });

  it('counts nothing for an empty wall', () => {
    expect(summarize([])).toEqual({ total: 0, final: 0, ready: 0, fixed: 0, flagged: 0, failed: 0 });
  });
});

describe('catalog events', () => {
  it('parses a catalog.row event made with makeEvent', () => {
    const e = makeEvent(filmId, { type: 'catalog.row', catalogId, row: row('queued') });
    expect(filmEventSchema.safeParse(e).success).toBe(true);
  });

  it('parses a catalog.done event made with makeEvent', () => {
    const e = makeEvent(filmId, { type: 'catalog.done', catalogId, costUsd: 0.02, ms: 1234 });
    expect(filmEventSchema.safeParse(e).success).toBe(true);
  });

  it('rejects a catalog.row whose row is not a row', () => {
    const e = makeEvent(filmId, { type: 'catalog.row', catalogId, row: { product, status: 'nope' } as never });
    expect(filmEventSchema.safeParse(e).success).toBe(false);
  });
});
