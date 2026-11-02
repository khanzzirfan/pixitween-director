import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Product } from '@shared/catalog';
import { floorBoard } from '../authoring/beatsheet';
import type { Prepared3D } from '../product3d/prepare';
import { boardKey, createBoardCache, heroFilm, makeSetArt } from './hero';
import type { RowBuild, SetArt } from './row';

const product: Product = { id: 'p1', title: 'Wave Rider Longboard', category: 'surf', price: 429, currency: 'USD', imageUrl: 'x.jpg', brand: 'Saltline' } as Product;
const prepared: Prepared3D = {
  shape: 'other',
  texture: { id: 'ast_front', url: '/api/assets/ast_front', mime: 'image/png', width: 100, height: 340 } as unknown as Prepared3D['texture'],
  textureKind: 'front',
  side: '#d8d8d8',
  aspect: 3.4,
  contour: [[0, 0], [100, 0], [100, 300], [50, 340], [0, 300]],
};
const build = (o: Partial<RowBuild> = {}): RowBuild => ({
  aspect: '9:16',
  look: 'tabletop-hero',
  product: { id: 'ast_cut', src: '/api/assets/ast_cut', width: 100, height: 340 },
  title: product.title,
  price: 429,
  accent: '#2b6cb0',
  film: floorBoard({ title: product.title, category: product.category }),
  prepared,
  ...o,
});
const kinds = (c: any): string[] => Object.values(c.precomps as Record<string, any>).flatMap((p) => (p.layers as any[]).map((l) => l.kind));

it('plays the board in the 3D world when the product is prepared', () => {
  expect(kinds(heroFilm(build(), product))).toContain('stage3d');
});

it('falls back to the 2D film, and says so, when the 3D film cannot be built', () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const comp = heroFilm(build({ prepared: { ...prepared, contour: [] } }), product);
  expect(comp).toBeDefined();
  expect(kinds(comp)).not.toContain('stage3d');
  expect(err).toHaveBeenCalled();
  err.mockRestore();
});

it('has no film for a build with no board, or one that is not a board', () => {
  expect(heroFilm(build({ film: undefined }), product)).toBeUndefined();
  expect(heroFilm(build({ film: { nope: 1 } as never }), product)).toBeUndefined();
});

it('keys a board by the photo, the product, flat or round and the brief', () => {
  const a = boardKey('ph', product, true, 'summer sale');
  expect(boardKey('ph', product, true, '  summer sale ')).toBe(a);
  expect(boardKey('ph', product, true, 'winter sale')).not.toBe(a);
  expect(boardKey('ph', product, false, 'summer sale')).not.toBe(a);
  expect(boardKey('other', product, true, 'summer sale')).not.toBe(a);
});

it('keeps boards on disk, and ignores an old entry that is not a board', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'boards-'));
  mkdirSync(join(dir, 'catalogs'));
  writeFileSync(join(dir, 'catalogs', 'boards.json'), JSON.stringify({ old: { board: { concept: 'x', shots: [] }, source: 'muse' } }));
  const cache = createBoardCache(dir);
  expect(await cache.get('old')).toBeUndefined();
  const board = floorBoard({ title: 'Mug', category: 'home' });
  await cache.set('k', { board, source: 'muse' });
  expect((await createBoardCache(dir).get('k'))?.board.concept).toBe(board.concept);
});

const fakeAssets = () => {
  let n = 0;
  const puts: Array<{ role?: string }> = [];
  return {
    puts,
    store: {
      async put(_b: Buffer, _mime: string, meta: { role?: string }) {
        puts.push(meta);
        return { id: `ast_set${++n}` };
      },
    } as never,
  };
};

it('draws the set once per look and light, and nothing for a board with no set', async () => {
  const { puts, store } = fakeAssets();
  const memo = new Map<string, SetArt>();
  const board = { ...floorBoard({ title: 'Beach Towel', category: 'summer' }), tone: 'warm' as const, key: 'high' as const };
  const a = await makeSetArt(store, board, '9:16', memo);
  const b = await makeSetArt(store, board, '9:16', memo);
  expect(a).toBe(b);
  expect(puts).toHaveLength(1);
  expect(a?.backdrop.src).toBe('/api/assets/ast_set1');
  expect(a?.ground).toMatch(/^#[0-9a-f]{6}$/);
  expect(a?.dot).toBeUndefined();
  const wide = await makeSetArt(store, board, '16:9', memo);
  expect(wide).not.toBe(a);
  const bokeh = await makeSetArt(store, { ...board, set: { look: 'night', air: 'bokeh' } }, '9:16', memo);
  expect(bokeh?.dot?.width).toBe(128);
  expect(await makeSetArt(store, { ...board, set: undefined }, '9:16', memo)).toBeUndefined();
});

it('plays the set when the build carries its art, and without it plays on the plain field', () => {
  const art: SetArt = { backdrop: { id: 'ast_back', src: '/api/assets/ast_back', width: 1500, height: 1024 }, ground: '#d8b878' };
  const layers = (c: any): any[] => Object.values(c.precomps as Record<string, any>).flatMap((p) => p.layers as any[]);
  const withSet = heroFilm(build({ setArt: art }), product);
  expect(layers(withSet).find((l) => l.kind === 'stage3d').set.backdrop).toBe('ast_back');
  const without = heroFilm(build(), product);
  expect(layers(without).find((l) => l.kind === 'stage3d').set.ground).toBe('none');
});
