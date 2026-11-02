import { expect, it } from 'vitest';
import type { CatalogRow, RowStatus } from '@shared/catalog-run';
import { lineGroups, shortNames } from './line-film';

const row = (id: string, title: string, status: RowStatus, over: Partial<CatalogRow['product']> = {}): CatalogRow => ({
  product: { id, title, price: 10, currency: 'USD', imageUrl: `fixtures/${id}.png`, category: 'beach', ...over },
  status,
  clipVersion: 1,
  check: null,
});

it('groups the finished rows by brand, else by category, in the run order', () => {
  const groups = lineGroups([
    row('a', 'Wave Rider Longboard', 'ready', { brand: 'Saltline' }),
    row('b', 'Coffee Mug', 'ready', { category: 'home' }),
    row('c', 'Beach Towel', 'fixed', { brand: 'Saltline' }),
    row('d', 'Tea Mug', 'flagged', { category: 'home' }),
  ]);
  expect(groups.map((g) => [g.id, g.title, g.rows.map((r) => r.product.id)])).toEqual([
    ['line-saltline', 'Saltline', ['a', 'c']],
    ['line-home', 'home', ['b', 'd']],
  ]);
});

it('leaves out rows that failed or are still moving, and lines of one', () => {
  const groups = lineGroups([
    row('a', 'One', 'ready', { brand: 'Solo' }),
    row('b', 'Two', 'failed', { brand: 'Solo' }),
    row('c', 'Three', 'building', { brand: 'Solo' }),
  ]);
  expect(groups).toEqual([]);
});

it('cuts a line of more than six into films of six', () => {
  const rows = Array.from({ length: 8 }, (_, n) => row(`p${n}`, `Thing ${n}`, 'ready', { brand: 'Big Line' }));
  const groups = lineGroups(rows);
  expect(groups.map((g) => [g.id, g.rows.length])).toEqual([
    ['line-big-line', 6],
    ['line-big-line-2', 2],
  ]);
});

it('names each product by the last words of what its title does not share, so the noun stays', () => {
  expect(shortNames(['Sun Stripe Beach Towel', 'Clear Water Swim Goggles', 'Ice Cold Beach Cooler'])).toEqual(['Beach Towel', 'Swim Goggles', 'Beach Cooler']);
  expect(shortNames(['Coffee Co. Cold Brew', 'Coffee Co. Vanilla Cold Brew'])).toEqual(['Original', 'Vanilla']);
});
