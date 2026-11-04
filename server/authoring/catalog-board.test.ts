import { describe, expect, it } from 'vitest';
import type { ToolCtx } from '@shared/tools';
import { BOARD_USD, catalogBoardPrompt, checkCatalogBoard, floorCatalogBoard, parseCatalogBoard, planCatalogBoard, type CatalogBoard } from './catalog-board';

const product = { title: 'Wave Rider Longboard', brand: 'Saltline', category: 'beach summer surfboard', price: 429, salePrice: 349, currency: 'USD' };

/** A board that passes every rule, to break one rule at a time. */
const good = (): CatalogBoard => ({
  concept: 'small in a big summer, then the board up close',
  mood: 'bright',
  tone: 'warm',
  key: 'high',
  tagline: 'Paddle out this summer',
  shots: [
    { size: 'wide', move: 'push', seconds: 1.0, phase: 'hook', entrance: 'drop', cut: 'hard', world: 'halo', air: 'dust', text: 'Summer is calling' },
    { size: 'macro', move: 'push', seconds: 0.7, phase: 'build', entrance: 'none', cut: 'flash', world: 'field', air: 'none' },
    { size: 'medium', move: 'sway', seconds: 1.0, phase: 'build', entrance: 'tumble', cut: 'whip', world: 'halo', air: 'bokeh' },
    { size: 'close', move: 'push', seconds: 0.8, phase: 'peak', entrance: 'none', cut: 'hard', world: 'field', air: 'none' },
    { size: 'wide', move: 'pull', seconds: 1.0, phase: 'reveal', entrance: 'none', cut: 'hard', world: 'halo', air: 'none' },
    { size: 'medium', move: 'hold', seconds: 2.0, phase: 'close', entrance: 'none', cut: 'hard', world: 'halo', air: 'none' },
  ],
});

describe('checkCatalogBoard', () => {
  it('passes a board cut like the reference films', () => {
    expect(checkCatalogBoard(good())).toEqual([]);
  });

  it('passes every floor board, sale or not, plate or not', () => {
    for (const title of ['A', 'Wave Rider Longboard', 'Stone Mug', 'Beach Towel', 'Swim Goggles', 'Cooler'])
      for (const sale of [true, false])
        for (const hasPlate of [true, false]) {
          const p = { ...product, title, ...(sale ? {} : { salePrice: undefined }) };
          expect(checkCatalogBoard(floorCatalogBoard(p, { hasPlate }))).toEqual([]);
        }
  });

  it('names the slideshow, the missing macro, the short end hold and text on the end card', () => {
    const b = good();
    b.shots[1] = { ...b.shots[1]!, size: 'wide', move: 'push' };
    b.shots[5] = { ...b.shots[5]!, seconds: 0.5, text: 'Buy now' };
    const v = checkCatalogBoard(b);
    expect(v.some((x) => x.includes('same size and move'))).toBe(true);
    expect(v.some((x) => x.includes('macro'))).toBe(true);
    expect(v.some((x) => x.includes('last shot holds'))).toBe(true);
    expect(v.some((x) => x.includes('carries no text'))).toBe(true);
  });
});

describe('parseCatalogBoard', () => {
  it('reads JSON text in a code fence and drops nulls', () => {
    const raw = '```json\n' + JSON.stringify({ ...good(), shots: good().shots.map((s) => ({ ...s, text: null })) }) + '\n```';
    const r = parseCatalogBoard(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.board.shots[0]!.text).toBeUndefined();
  });

  it('says why when the reply is not a board', () => {
    expect(parseCatalogBoard('nope')).toEqual({ ok: false, reason: 'not JSON' });
    expect(parseCatalogBoard({ shots: [] }).ok).toBe(false);
  });
});

it('the prompt names the product, the sale and the plate rule', () => {
  const p = catalogBoardPrompt(product, { hasPlate: false });
  expect(p.user).toContain('Wave Rider Longboard by Saltline');
  expect(p.user).toContain('on sale: 349 USD, was 429');
  expect(p.system).toContain('there is no painted plate');
});

/** A ctx whose Spark answers with the given replies in turn. */
function ctxWith(replies: unknown[]) {
  const spent: number[] = [];
  const ctx = {
    filmId: 'film_test',
    meta: { spark: { reviewImages: async () => replies.shift() } },
    ledger: { add: (_f: string, _m: string, _u: string, usd: number) => spent.push(usd) },
  } as unknown as ToolCtx;
  return { ctx, spent };
}

describe('planCatalogBoard', () => {
  it('takes the board Muse wrote when it passes, and charges one call', async () => {
    const { ctx, spent } = ctxWith([good()]);
    const planned = await planCatalogBoard(ctx, product, Buffer.from('photo'), { hasPlate: true });
    expect(planned.source).toBe('muse');
    expect(planned.board.tagline).toBe('Paddle out this summer');
    expect(spent).toEqual([BOARD_USD]);
  });

  it('asks again with the broken rules, then falls back to the floor board', async () => {
    const bad = { ...good(), shots: good().shots.slice(0, 2) };
    const { ctx, spent } = ctxWith([bad, bad]);
    const planned = await planCatalogBoard(ctx, product, Buffer.from('photo'), { hasPlate: false });
    expect(planned.source).toBe('floor');
    expect(planned.violations.length).toBeGreaterThan(0);
    expect(spent).toHaveLength(2);
    expect(checkCatalogBoard(planned.board)).toEqual([]);
  });

  it('never uses a plate it does not have', async () => {
    const withPlate = { ...good(), shots: good().shots.map((s) => ({ ...s, world: 'plate' as const })) };
    const { ctx } = ctxWith([withPlate]);
    const planned = await planCatalogBoard(ctx, product, Buffer.from('photo'), { hasPlate: false });
    expect(planned.board.shots.every((s) => s.world !== 'plate')).toBe(true);
  });
});
