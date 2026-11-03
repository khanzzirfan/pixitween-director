import { describe, expect, it } from 'vitest';
import { boardPrompt } from '../authoring/beatsheet';
import sharp from 'sharp';
import { isProductTitle, isReadName, isStraightCylinder, otherNouns, pricesIn, productNoun, topLuma } from './cinematic-cut';

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
