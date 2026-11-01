import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@shared/tools';
import { lintPrompt } from '../art/lint';
import { FLOOR, elementCostUsd, elementKey, elementPrompt, floorElements, glassAsset, ingredientsFor, makeElement, samNouns, sanitizeElements } from './ingredients';

describe('floor library', () => {
  it('gives a coffee drink beans, ice, a splash and milk, led by the coffee group', () => {
    expect(ingredientsFor('Coffee Co. Cold Brew', 'drinks')).toEqual(['bean', 'ice', 'splash', 'milk']);
    expect(floorElements('Coffee Co. Mocha Cold Brew').map((e) => e.id)).toEqual(['bean', 'ice', 'splash', 'milk', 'cocoa']);
    expect(ingredientsFor('Stone Mug', 'home')).toEqual(['ice', 'splash']);
  });
  it('has prompts that pass the lint, keep text out and ask for a plain backdrop', () => {
    for (const e of Object.values(FLOOR)) {
      const p = elementPrompt(e);
      if (e.glass) {
        expect(p).toBeNull();
        continue;
      }
      expect(lintPrompt(p!.prompt).ok).toBe(true);
      expect(p!.prompt).toMatch(/No text, no logos/);
      expect(p!.prompt).toMatch(/plain white studio backdrop/);
    }
  });
  it('asks for a row of stages on a wide picture for a flipbook and one centred piece otherwise', () => {
    expect(elementPrompt(FLOOR.splash!)).toMatchObject({ size: '1536x1024' });
    expect(elementPrompt(FLOOR.splash!)!.prompt).toMatch(/4 stages of .* in one horizontal row from left to right/);
    expect(elementPrompt(FLOOR.bean!)).toMatchObject({ size: '1024x1024' });
    expect(elementPrompt(FLOOR.bean!)!.prompt).toMatch(/^One roasted coffee bean, glossy .*, centred on a plain white studio backdrop/);
  });
});

describe('sanitizeElements', () => {
  const good = { id: 'honey', name: 'honey ribbon', use: 'card', look: 'a thick golden ribbon of honey pouring, glossy', pieces: 2, sizeM: 0.25 };
  it('keeps a good element, rounds its size and caps a card to 1-6 stages', () => {
    const r = sanitizeElements([good]);
    expect(r.elements).toEqual([good]);
    expect(r.dropped).toEqual([]);
  });
  it('drops duplicates, brand words, bad ids and anything past five elements', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ ...good, id: `e${i}` }));
    const r = sanitizeElements([good, good, { ...good, id: 'x1', look: 'a Nike shoe on a table, glossy leather' }, { ...good, id: 'Bad Id' }, ...many]);
    expect(r.elements).toHaveLength(5);
    expect(r.dropped.join('|')).toMatch(/honey: duplicate id/);
    expect(r.dropped.join('|')).toMatch(/x1: brand-name "nike"/);
    expect(r.dropped.join('|')).toMatch(/over the limit of 5/);
  });
  it('treats non-arrays as no elements', () => {
    expect(sanitizeElements(undefined).elements).toEqual([]);
  });
});

describe('costs and keys', () => {
  it('a picture costs a Muse image and a SAM call; glass and made elements cost nothing', () => {
    const els = floorElements('Coffee Co. Cold Brew', 'drinks');
    expect(elementCostUsd(els)).toBeCloseTo(3 * 0.0125, 4); // bean, splash, milk; ice is glass
    expect(elementCostUsd(els, new Set([elementKey(FLOOR.splash!), elementKey(FLOOR.milk!)]))).toBeCloseTo(0.0125, 4);
  });
  it('the key changes when the description changes', () => {
    expect(elementKey(FLOOR.bean!)).not.toBe(elementKey({ ...FLOOR.bean!, look: 'a green coffee bean, matte' }));
    expect(elementKey(FLOOR.bean!)).toBe(elementKey({ ...FLOOR.bean! }));
  });
});

describe('makeElement', () => {
  it('draws glass without a picture', async () => {
    const a = await makeElement({} as ToolCtx, FLOOR.ice!);
    expect(a).toEqual(glassAsset(FLOOR.ice!));
    expect(a.frames).toEqual([]);
  });
  it('makes one Muse picture and refuses a prompt that fails the lint', async () => {
    const image = vi.fn(async () => sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).png().toBuffer());
    const ledger = { add: vi.fn() };
    const ctx = { filmId: 'f', ledger, emit: vi.fn(), meta: { sam: { segmentImage: vi.fn(async () => []) } }, assets: {} } as unknown as ToolCtx;
    await expect(makeElement(ctx, { ...FLOOR.bean!, look: 'a Nike branded bean in a glossy shell' }, { image })).rejects.toThrow(/brand-name/);
    expect(image).not.toHaveBeenCalled();
    await expect(makeElement(ctx, FLOOR.bean!, { image })).rejects.toThrow(/no coffee bean found/);
    expect(image).toHaveBeenCalledTimes(1);
    expect(ledger.add).toHaveBeenCalledWith('f', 'muse-image-1.0', '1 image', 0.01);
  });
  it('asks SAM for a simpler word, then keys the white out, on the same picture before giving up', async () => {
    expect(samNouns('cold brew splash')).toEqual(['cold brew splash', 'splash']);
    expect(samNouns('splash')).toEqual(['splash']);
    const image = vi.fn(async () => sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).png().toBuffer());
    const segmentImage = vi.fn(async () => []);
    const ctx = { filmId: 'f', ledger: { add: vi.fn() }, emit: vi.fn(), meta: { sam: { segmentImage } }, assets: {} } as unknown as ToolCtx;
    await expect(makeElement(ctx, { ...FLOOR.splash!, name: 'cold brew splash' }, { image })).rejects.toThrow(/no cold brew splash found in the sheet \(tried "cold brew splash", "splash" and a white key\)/);
    expect(image).toHaveBeenCalledTimes(1);
    expect(segmentImage.mock.calls.map((c) => (c as unknown[])[1])).toEqual(['cold brew splash', 'splash']);
  });
  it('stops at the first word SAM finds', async () => {
    const W = 64;
    const png = await sharp({ create: { width: W, height: W, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const alpha = new Uint8Array(W * W).fill(0);
    for (let y = 10; y < 40; y++) for (let x = 10; x < 40; x++) alpha[y * W + x] = 255;
    const found = [{ objectId: 'a', confidence: 0.9, bounds: { left: 10, top: 10, right: 40, bottom: 40 }, alpha }];
    const segmentImage = vi.fn(async (_b: unknown, noun: string) => (noun === 'splash' ? found : []));
    let n = 0;
    const assets = { put: vi.fn(async () => ({ id: `ast_${++n}` })) };
    const ctx = { filmId: 'f', ledger: { add: vi.fn() }, emit: vi.fn(), meta: { sam: { segmentImage } }, assets } as unknown as ToolCtx;
    const a = await makeElement(ctx, { ...FLOOR.splash!, name: 'cold brew splash', pieces: 1 }, { image: async () => png });
    expect(segmentImage).toHaveBeenCalledTimes(2);
    expect(a.frames).toHaveLength(1);
  });
});
