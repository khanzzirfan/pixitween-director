import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@shared/tools';
import { floorElements } from '../../authoring/ingredients';
import { defaultBeatSheet, type CinematicBoard } from '../../authoring/beatsheet';
import { checkSheets, parseSheetCheck, sheetCheckPrompt } from './check';

const elements = floorElements('Coffee Co. Cold Brew', 'drinks');
const board: CinematicBoard = { concept: 'cold brew', mood: 'dark', locks: ['the can is matte black with a gold label'], elements, sheet: defaultBeatSheet(elements) };
const ids = elements.map((e) => e.id);

describe('parseSheetCheck', () => {
  it('keeps only element ids the board has, and trims the problems', () => {
    const r = parseSheetCheck({ fine: false, problems: ['tub is brown'], dropElements: ['raspberry', 'ghost'] }, ['raspberry', 'honey']);
    expect(r).toEqual({ fine: false, problems: ['tub is brown'], dropElements: ['raspberry'] });
  });
  it('counts an unreadable reply as fine', () => {
    expect(parseSheetCheck('not json', [])).toEqual({ fine: true, problems: [], dropElements: [] });
    expect(parseSheetCheck(undefined, [])).toEqual({ fine: true, problems: [], dropElements: [] });
  });
  it('caps problems at 6 of 300 characters', () => {
    const r = parseSheetCheck({ fine: false, problems: Array.from({ length: 9 }, () => 'x'.repeat(400)) }, []);
    expect(r.problems).toHaveLength(6);
    expect(r.problems[0]).toHaveLength(300);
  });
});

describe('sheetCheckPrompt', () => {
  it('names the lock lines, the element ids and the sheets', () => {
    const p = sheetCheckPrompt({ board, title: 'Cold Brew', sheets: ['the product sheet'] });
    expect(p).toContain('matte black with a gold label');
    for (const id of ids) expect(p).toContain(id);
    expect(p).toContain('dropElements');
  });
});

describe('checkSheets', () => {
  it('makes one image call with the photo then the sheets present, and one ledger line', async () => {
    const reviewImages = vi.fn(async () => ({ fine: true, problems: [] }));
    const add = vi.fn();
    const ctx = { filmId: 'f', meta: { spark: { reviewImages } }, ledger: { add } } as unknown as ToolCtx;
    const photo = Buffer.from('photo');
    const product = Buffer.from('product');
    const set = Buffer.from('set');
    const r = await checkSheets(ctx, { photo, sheets: { product, set, assetIds: [], skipped: [] }, board, title: 'Cold Brew' });
    expect(r.fine).toBe(true);
    expect(reviewImages).toHaveBeenCalledTimes(1);
    expect((reviewImages.mock.calls[0] as unknown[])[0]).toEqual([photo, product, set]);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0]![3]).toBe(0.005);
  });
});
