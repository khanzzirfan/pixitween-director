import { describe, expect, it } from 'vitest';
import { boardPrompt, floorBoard } from '../authoring/beatsheet';
import sharp from 'sharp';
import { bodyFor, buildCinematic, formFromPhoto, isProductTitle, isReadName, quotedName, isStraightCylinder, otherNouns, pricesIn, productNoun, topLuma } from './cinematic-cut';
import type { ToolCtx } from '@shared/tools';

describe('pricesIn', () => {
  it('shows the lowest price and keeps the highest as the one it was', () => {
    expect(pricesIn('COLD BREW NOW $3.50 IN STORE — WAS $5.00 $5.00 → $3.50')).toEqual({ price: 3.5, was: 5 });
  });
  it('has no was-price when only one price is named', () => {
    expect(pricesIn('Grab yours for $4')).toEqual({ price: 4 });
  });
  it('is undefined when no price is named', () => {
    expect(pricesIn('a calm morning can')).toBeUndefined();
  });
});

describe('boardPrompt', () => {
  it('hands the director the client brief and the craft rules, so a cold brief is enriched, not copied', () => {
    const p = boardPrompt({ title: 'Cold Brew', brief: 'cold brew can now $3.50', seconds: 8 });
    expect(p.user).toContain('cold brew can now $3.50');
    expect(p.system).toContain("DIRECTOR'S CRAFT");
  });
  it('asks without a brief line when there is none', () => {
    expect(boardPrompt({ title: 'Cold Brew', seconds: 8 }).user).not.toContain("client's brief");
  });
});

describe('otherNouns', () => {
  it('gives the rest of the name from its end back, never the first word or a repeat', () => {
    expect(otherNouns('Clear Water Swim Goggles', 'goggles')).toEqual(['swim', 'water', 'clear']);
    expect(otherNouns('Cooler Cooler Box', 'box')).toEqual(['cooler']);
    expect(otherNouns('X1', 'product')).toEqual([]);
  });
});

describe('productNoun', () => {
  it('looks for the last word of the product name', () => {
    expect(productNoun('Clear Water Swim Goggles')).toBe('goggles');
    expect(productNoun('Sun Cooler 24L')).toBe('cooler');
  });
  it('falls back to "product" when the name has no word to look for', () => {
    expect(productNoun('X1')).toBe('product');
  });
});

describe('topLuma', () => {
  it('measures the top third, where the end card words sit', async () => {
    const png = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#000000' } })
      .composite([{ input: await sharp({ create: { width: 30, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer(), left: 0, top: 0 }])
      .png()
      .toBuffer();
    expect(await topLuma(png)).toBeCloseTo(1, 2);
  });
});

describe('isStraightCylinder', () => {
  const shape = (svg: string) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="300">${svg}</svg>`)).png().toBuffer();
  it('takes a can, straight from top to bottom', async () => {
    expect(await isStraightCylinder(await shape('<rect x="10" y="0" width="80" height="300" rx="8" fill="#123"/>'))).toBe(true);
  });
  it('refuses a bottle with a neck and cap, so it keeps its own outline', async () => {
    expect(await isStraightCylinder(await shape('<rect x="38" y="0" width="24" height="70" fill="#a80"/><rect x="10" y="70" width="80" height="230" fill="#123"/>'))).toBe(false);
  });
});

describe('quotedName', () => {
  it('takes the product name the brief puts in quotes, and nothing from a brief without one', () => {
    expect(quotedName('Cinematic 10s vertical (9:16) yoghurt ad for the "Pure Spoonful" mixed-berry tub, built from the tub photo')).toBe('Pure Spoonful');
    expect(quotedName('A soda ad, tagline \u201cFizz Up\u201d')).toBe('Fizz Up');
    expect(quotedName('Cold brew for energy, VO: "Thick. Creamy. Real."')).toBeUndefined();
    expect(quotedName('Cold brew for energy')).toBeUndefined();
  });
});

describe('isProductTitle', () => {
  it('takes a short real name and refuses a title that is the brief, or a sentence with a price', () => {
    const brief = 'Cold brew for energy, excitment, refreshment. $4.00 as $5.50 before,';
    expect(isProductTitle('Coffee Co. Cold Brew', brief)).toBe(true);
    expect(isProductTitle(brief, brief)).toBe(false);
    expect(isProductTitle('Cold brew for energy, excitment, refreshment', brief)).toBe(false);
    expect(isProductTitle('', brief)).toBe(false);
    expect(isProductTitle(undefined, brief)).toBe(false);
    expect(isProductTitle('Cold Brew', 'Cold brew for energy')).toBe(true);
  });
  it('takes a product name the brief opens with, up to five words, and not a clause of it', () => {
    const brief = 'Clear Water Swim Goggles. swim summer by Saltline. price $14.00 (was $18.00). Summer sale for swim goggles.';
    expect(isProductTitle('Clear Water Swim Goggles', brief)).toBe(true);
    expect(isProductTitle('Clear Water Swim Goggles. swim summer by Saltline', brief)).toBe(false);
    expect(isProductTitle('Cold brew for energy, excitment', 'Cold brew for energy, excitment, refreshment')).toBe(false);
  });
});

describe('isReadName', () => {
  it('takes a name and refuses a reading that says it found none', () => {
    expect(isReadName('Esky Cooler')).toBe(true);
    expect(isReadName('Lattafa Habik')).toBe(true);
    for (const no of ['NOT VISIBLE', 'Not readable', 'Unknown', 'N/A', 'No name on the pack', 'None', '---', 'Unable to read']) expect(isReadName(no)).toBe(false);
  });
});

describe('formFromPhoto', () => {
  const ctxWith = (reply: unknown) => {
    const lines: number[] = [];
    const ctx = { filmId: 'f1', meta: { spark: { reviewImages: async () => { if (reply instanceof Error) throw reply; return reply; } } }, ledger: { add: (_f: string, _m: string, _u: string, usd: number) => lines.push(usd) } } as unknown as ToolCtx;
    return { ctx, lines };
  };
  it("takes Muse's form for the product and charges one look", async () => {
    const { ctx, lines } = ctxWith({ form: 'round' });
    expect(await formFromPhoto(ctx, Buffer.from('x'), 'Pure Spoonful')).toBe('round');
    expect(lines).toEqual([0.005]);
  });
  it('is undefined for a form it does not know, or when the look fails', async () => {
    expect(await formFromPhoto(ctxWith({ form: 'blob' }).ctx, Buffer.from('x'), 'X')).toBeUndefined();
    expect(await formFromPhoto(ctxWith(new Error('down')).ctx, Buffer.from('x'), 'X')).toBeUndefined();
  });
});

describe('bodyFor', () => {
  it('the form seen in the photo wins over the board (the tub the board called a slab, 4 Nov)', () => {
    expect(bodyFor('round', { form: 'slab', depth: 0.25, section: 5 })).toEqual({ form: 'round', depth: 0.95, section: 2 });
  });
  it("keeps the board's depth when its form agrees, inside the form's range", () => {
    expect(bodyFor('round', { form: 'round', depth: 0.8, section: 2 })!.depth).toBe(0.8);
  });
  it("is the board's body when no form was seen", () => {
    expect(bodyFor(undefined, { form: 'boxy', depth: 0.6, section: 4.5 })).toEqual({ form: 'boxy', depth: 0.6, section: 4.5 });
    expect(bodyFor(undefined, undefined)).toBeUndefined();
  });
});

describe('buildCinematic body', () => {
  const ctx = { assets: { url: (id: string) => `/api/assets/${id}` } } as unknown as ToolCtx;
  const parts = (form?: 'round') => ({
    title: 'Pure Spoonful',
    aspect: '9:16' as const,
    accent: '#cc6688',
    prep: { shape: 'other' as const, texture: { id: 'ast_t', width: 800, height: 1000 }, textureKind: 'front' as const, side: '#eeeeee', aspect: 1.25, contour: [[0, 0], [800, 0], [760, 1000], [40, 1000]] as Array<[number, number]> },
    board: floorBoard({ title: 'Pure Spoonful' }),
    ingredients: {},
    set: undefined,
    ...(form ? { form } : {}),
  });
  const productOf = (comp: unknown) => ((comp as { precomps: { cine: { layers: Array<{ id: string; source: { depth: number; section?: number } }> } } }).precomps.cine.layers.find((l) => l.id === 'cine:product')!.source);
  it('builds the product from the form seen in the photo, even when a revised board names another', () => {
    const p = parts('round');
    const seen = productOf(buildCinematic(ctx, p as never, p.board));
    expect(seen.section).toBe(2);
    expect(seen.depth).toBe(760);
    const slab = productOf(buildCinematic(ctx, p as never, { ...p.board, body: { form: 'slab', depth: 0.25, section: 5 } }));
    expect(slab.section).toBe(2);
  });
  it("takes the board's form when no form was seen, and the old default with neither", () => {
    const boxy = productOf(buildCinematic(ctx, parts() as never, { ...parts().board, body: { form: 'boxy', depth: 0.6, section: 4.5 } }));
    expect(boxy.section).toBe(4.5);
    const none = productOf(buildCinematic(ctx, parts() as never, parts().board));
    expect(none.section).toBe(2.6);
  });
});
