import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { FilmState } from '@shared/composition';
import type { ChatResponse } from '@shared/ports';
import type { ToolCtx } from '@shared/tools';
import { setProductNoun } from '../authoring/api';
import { mugScene } from '../authoring/test-helpers';
import { resolveProductNoun, sanitizeNoun } from './product-noun';

const film = { brief: { text: 'A slow morning with a white ceramic mug', productAssetId: 'x' } } as unknown as FilmState;
const reply = (content: string): ChatResponse => ({ content, toolCalls: [], ms: 1, model: 'm' });

function ctxWith(chat: () => Promise<ChatResponse>) {
  const fn = vi.fn(chat);
  return { ctx: { filmId: 'film_3fa9c2d41b7e', meta: { spark: { chat: fn } }, ledger: { add: vi.fn() } } as unknown as ToolCtx, fn };
}
const cacheDir = () => mkdtempSync(join(tmpdir(), 'noun-'));

describe('sanitizeNoun', () => {
  it('lowercases, strips, trims to 3 words and falls back to product', () => {
    expect(sanitizeNoun('White Ceramic Mug.')).toBe('white ceramic mug');
    expect(sanitizeNoun('')).toBe('product');
    expect(sanitizeNoun('!!!')).toBe('product');
    expect(sanitizeNoun('one two three four five')).toBe('one two three');
  });
});

describe('resolveProductNoun', () => {
  it('uses the composition noun without calling Spark', async () => {
    const { ctx, fn } = ctxWith(async () => reply('{}'));
    expect(await resolveProductNoun(ctx, film, setProductNoun(mugScene(), 'mug'), { cacheDir: cacheDir() })).toBe('mug');
    expect(fn).not.toHaveBeenCalled();
  });

  it('asks Spark once, then reads the cache', async () => {
    const { ctx, fn } = ctxWith(async () => reply('{"noun":"White Ceramic Mug."}'));
    const dir = cacheDir();
    expect(await resolveProductNoun(ctx, film, mugScene(), { cacheDir: dir })).toBe('white ceramic mug');
    expect(await resolveProductNoun(ctx, film, mugScene(), { cacheDir: dir })).toBe('white ceramic mug');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('falls back to product on invalid JSON or an error', async () => {
    expect(await resolveProductNoun(ctxWith(async () => reply('nope')).ctx, film, mugScene(), { cacheDir: cacheDir() })).toBe('product');
    expect(await resolveProductNoun(ctxWith(async () => { throw new Error('down'); }).ctx, film, mugScene(), { cacheDir: cacheDir() })).toBe('product');
  });
});
