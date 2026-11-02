import { expect, it } from 'vitest';
import { buildBoardClip, type BoardClipInput } from './board-clip';
import { floorCatalogBoard } from './catalog-board';
import type { Obj } from './types';

const input = (over: Partial<BoardClipInput> = {}): BoardClipInput => ({
  aspect: '9:16',
  board: floorCatalogBoard({ title: 'Wave Rider Longboard', category: 'beach summer', price: 429, salePrice: 349 }, { hasPlate: true }),
  product: { id: 'ast_board', src: '/api/assets/ast_board', width: 300, height: 900 },
  plate: { id: 'ast_plate', src: '/api/assets/ast_plate', width: 1024, height: 1536 },
  title: 'Wave Rider Longboard',
  price: 349,
  wasPrice: 429,
  currency: 'USD',
  brand: 'Saltline',
  accent: '#2b6cb0',
  ...over,
});

const layers = (c: Obj): Obj[] => ((c.precomps as Record<string, Obj>).hero!.layers as Obj[]) ?? [];
const texts = (c: Obj): string[] =>
  layers(c)
    .filter((l) => l.kind === 'text')
    .map((l) => {
      const source = l.source as unknown;
      return typeof source === 'string' ? source : String((source as Array<{ v?: string }> | undefined)?.[0]?.v ?? '');
    });

it('plays every shot of the board in one scene as long as the board', () => {
  const i = input();
  const c = buildBoardClip(i) as Obj;
  const seconds = i.board.shots.reduce((s, x) => s + x.seconds, 0);
  expect(Math.abs((c.durationInFrames as number) / (c.fps as number) - seconds)).toBeLessThan(0.1);
  // one product layer per shot: a cut is a switch to the next shot's own layers
  expect(layers(c).filter((l) => (l as Obj).assetId === 'ast_board' || ((l.source as Obj | undefined)?.assetId === 'ast_board')).length).toBe(i.board.shots.length);
});

it('lands the price, the old price, the name, the brand and the tagline on the end card', () => {
  const i = input();
  const all = texts(buildBoardClip(i) as Obj).join(' ');
  expect(all).toContain('$349.00');
  expect(all).toContain('$429.00');
  expect(all).toContain('Wave Rider Longboard');
  expect(all).toContain('Saltline');
  for (const w of i.board.tagline.split(/\s+/)) expect(all).toContain(w);
});

it('builds every floor board, with or without a plate, in every aspect', () => {
  for (const title of ['A', 'Stone Mug', 'Beach Towel'])
    for (const aspect of ['9:16', '16:9', '1:1'] as const)
      for (const plate of [true, false]) {
        const board = floorCatalogBoard({ title, category: 'home', price: 24 }, { hasPlate: plate });
        expect(() => buildBoardClip(input({ aspect, board, ...(plate ? {} : { plate: undefined }) }))).not.toThrow();
      }
});
