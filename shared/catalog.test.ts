import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatPrice, parseFeed, parsePrice, shownPrice } from './catalog';

describe('price helpers', () => {
  it('formats and reads prices both ways', () => {
    expect(formatPrice(4.5)).toBe('$4.50');
    expect(formatPrice(19, 'CAD')).toBe('19.00 CAD');
    expect(parsePrice('$4.50')).toBe(4.5);
    expect(parsePrice('4,50 €')).toBe(4.5);
    expect(parsePrice('Free')).toBeUndefined();
  });
});

describe('parseFeed brand', () => {
  it('reads an optional brand column', () => {
    const r = parseFeed('id,title,price,image_link,category,brand\na,A,1,x.png,c,Hearth\nb,B,2,x.png,c,');
    expect(r.ok && r.products.map((p) => p.brand)).toEqual(['Hearth', undefined]);
  });
});

describe('parseFeed', () => {
  it('reads the 6-product fixture and shows the sale price when there is one', () => {
    const r = parseFeed(readFileSync(new URL('../fixtures/catalog/feed-6.csv', import.meta.url), 'utf8'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.products).toHaveLength(6);
    expect(shownPrice(r.products.find((p) => p.id === 'mug-stone')!)).toBe(19);
    expect(shownPrice(r.products[0]!)).toBe(4.5);
  });

  it('reports every bad row instead of guessing', () => {
    const r = parseFeed('id,title,price,image_link,category\na,A,1,x.png,c\na,B,2,x.png,c\nb,,3,x.png,c\nc,C,free,x.png,c');
    expect(r).toEqual({ ok: false, errors: expect.arrayContaining([expect.stringContaining("duplicate id 'a'"), expect.stringContaining('row 4'), expect.stringContaining('row 5: no price')]) });
  });

  it('names a missing header column', () => {
    expect(parseFeed('id,title\na,A')).toEqual({ ok: false, errors: ['the feed header is missing: price, img, cat'] });
  });

  it('handles quoted commas', () => {
    const r = parseFeed('id,title,price,image_link,category\na,"Mug, large",5,x.png,c');
    expect(r.ok && r.products[0]!.title).toBe('Mug, large');
  });
});
