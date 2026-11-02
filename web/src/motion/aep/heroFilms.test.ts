import { describe, expect, it } from 'vitest';
import { buildBoardClip } from '../../../../server/authoring/board-clip';
import { floorBoard } from '../../../../server/authoring/beatsheet';
import { buildCinematicFilm } from '../../../../server/authoring/cinematic-film';
import { floorCatalogBoard } from '../../../../server/authoring/catalog-board';
import type { AepCompositionJson } from '@shared/aep';
import { aepToMotion } from './index';

// The catalog hero films (server/authoring/board-clip.ts) cut by keeping each shot's layers inside the shot's own frames; the player
// times keys from a layer's in-point, so a key outside the shot breaks the film. Every floor board, in every aspect, must convert.

describe('catalog hero films convert to a valid MotionDoc', () => {
  for (const title of ['A', 'Wave Rider Longboard', 'Stone Mug', 'Beach Towel'])
    for (const aspect of ['9:16', '16:9', '1:1'] as const)
      for (const sale of [true, false])
        it(`${title}, ${aspect}${sale ? ', on sale' : ''}`, () => {
          const board = floorCatalogBoard({ title, category: 'beach summer', price: 429, ...(sale ? { salePrice: 349 } : {}) }, { hasPlate: true });
          const comp = buildBoardClip({
            aspect,
            board,
            product: { id: 'ast_board', src: '/api/assets/ast_board', width: 300, height: 900 },
            plate: { id: 'ast_plate', src: '/api/assets/ast_plate', width: 1024, height: 1536 },
            title,
            price: sale ? 349 : 429,
            ...(sale ? { wasPrice: 429 } : {}),
            brand: 'Saltline',
            accent: '#2b6cb0',
          });
          expect(() => aepToMotion(comp as unknown as AepCompositionJson)).not.toThrow();
        });
});

describe('catalog 3D hero films convert to a valid MotionDoc', () => {
  const contour: Array<[number, number]> = [[0, 0], [100, 0], [100, 300], [50, 340], [0, 300]];
  for (const [title, productAspect] of [['Wave Rider Longboard', 3.4], ['Beach Towel', 0.6], ['Sun Cooler', 1]] as const)
    for (const aspect of ['9:16', '16:9', '1:1'] as const)
      it(`${title}, ${aspect}`, () => {
        const board = floorBoard({ title, category: 'beach summer' });
        const comp = buildCinematicFilm({
          aspect,
          sheet: board.sheet,
          texture: { id: 'ast_front', src: '/api/assets/ast_front', width: 100, height: 340, kind: 'front' },
          shape: 'other',
          contour,
          side: '#d8d8d8',
          productAspect,
          title,
          price: 349,
          wasPrice: 429,
          brand: 'Saltline',
          accent: '#2b6cb0',
        });
        expect(() => aepToMotion(comp as unknown as AepCompositionJson)).not.toThrow();
      });
});

describe('catalog 3D hero films with a set convert without losing anything', () => {
  const contour: Array<[number, number]> = [[0, 0], [100, 0], [100, 300], [50, 340], [0, 300]];
  for (const air of ['none', 'dust', 'bokeh', 'spray'] as const)
    for (const aspect of ['9:16', '16:9'] as const)
      it(`${air}, ${aspect}`, () => {
        const board = floorBoard({ title: 'Beach Towel', category: 'summer' });
        const comp = buildCinematicFilm({
          aspect,
          sheet: board.sheet,
          texture: { id: 'ast_front', src: '/api/assets/ast_front', width: 100, height: 340, kind: 'front' },
          shape: 'other',
          contour,
          side: '#d8d8d8',
          productAspect: 1.4,
          title: 'Beach Towel',
          price: 29,
          accent: '#d08a1c',
          set: { look: 'beach', air, ground: '#d8b878', backdrop: { id: 'ast_back', src: '/api/assets/ast_back', width: 1500, height: 1024 }, dot: { id: 'ast_dot', src: '/api/assets/ast_dot', width: 128, height: 128 } },
        });
        const out = aepToMotion(comp as unknown as AepCompositionJson);
        // nothing the film asked for is dropped or cut: no object over the limit, no tween over the engine's 64
        expect(out.warnings.filter((w) => /dropped|exceed|not supported/.test(w))).toEqual([]);
      });
});

describe('a film with every camera move keeps the world within the engine limits', () => {
  const walk = (node: any, out: any[] = []): any[] => {
    if (node && typeof node === 'object') {
      if (node.type === 'three') out.push(node);
      for (const v of Object.values(node)) walk(v, out);
    }
    return out;
  };
  for (const n of [7, 10])
    it(`${n} shots`, () => {
      const moves = ['push', 'truck', 'crane', 'whip', 'rack', 'orbit', 'pull', 'truck', 'crane'];
      const beats = Array.from({ length: n - 1 }, (_, i) => ({ size: (['wide', 'medium', 'close'] as const)[i % 3]!, move: moves[i % moves.length] as any, seconds: 0.8, angle: (['low', 'eye', 'high'] as const)[i % 3]!, phase: (i === 0 ? 'hook' : 'build') as any, product: (i === 0 ? 'drop' : i % 2 ? 'turn' : 'still') as any }));
      beats.push({ size: 'medium', move: 'hold', seconds: 2, angle: 'eye', phase: 'close', product: 'still' } as any);
      const comp = buildCinematicFilm({
        aspect: '9:16',
        sheet: { beats },
        texture: { id: 'ast_front', src: '/api/assets/ast_front', width: 100, height: 340, kind: 'front' },
        shape: 'other',
        contour: [[0, 0], [100, 0], [100, 300], [50, 340], [0, 300]],
        side: '#d8d8d8',
        productAspect: 1.4,
        title: 'Beach Towel',
        price: 29,
        accent: '#d08a1c',
        handheld: true,
      });
      const out = aepToMotion(comp as unknown as AepCompositionJson);
      expect(out.warnings.filter((w) => /exceed|dropped/.test(w))).toEqual([]);
      const world = walk(out.doc)[0];
      expect(world.tweens.length).toBeLessThanOrEqual(64);
    });
});

describe('a 3D hero film with words and a tagline converts', () => {
  for (const aspect of ['9:16', '16:9', '1:1'] as const)
    it(aspect, () => {
      const board = floorBoard({ title: 'Beach Towel', category: 'summer' });
      const comp = buildCinematicFilm({
        aspect,
        sheet: { beats: board.sheet.beats.map((b, i) => (i === 0 ? { ...b, text: 'Pack the car' } : i === 3 ? { ...b, text: 'Feel summer' } : b)) },
        texture: { id: 'ast_front', src: '/api/assets/ast_front', width: 100, height: 340, kind: 'front' },
        shape: 'other',
        contour: [[0, 0], [100, 0], [100, 300], [50, 340], [0, 300]],
        side: '#d8d8d8',
        productAspect: 1.4,
        title: 'Beach Towel',
        price: 29,
        accent: '#d08a1c',
        tagline: 'Summer, packed.',
      });
      const out = aepToMotion(comp as unknown as AepCompositionJson);
      expect(out.warnings.filter((w) => /exceed|dropped/.test(w))).toEqual([]);
    });
});

describe('a 3D hero film keeps its product on the last frame', () => {
  const walk = (node: any, out: any[] = []): any[] => {
    if (node && typeof node === 'object') {
      if (node.life && node.geometry) out.push(node);
      for (const v of Object.values(node)) walk(v, out);
    }
    return out;
  };
  it('the product lives past the film\'s end', () => {
    const board = floorBoard({ title: 'Beach Towel', category: 'summer' });
    const comp = buildCinematicFilm({
      aspect: '9:16',
      sheet: board.sheet,
      texture: { id: 'ast_front', src: '/api/assets/ast_front', width: 100, height: 340, kind: 'front' },
      shape: 'other',
      contour: [[0, 0], [100, 0], [100, 300], [50, 340], [0, 300]],
      side: '#d8d8d8',
      productAspect: 1.4,
      title: 'Beach Towel',
      price: 29,
      accent: '#d08a1c',
    });
    const out = aepToMotion(comp as unknown as AepCompositionJson);
    const objects = walk(out.doc);
    const product = objects.find((o) => o.id === 'cine:product' || /product/.test(String(o.id)));
    expect(product, JSON.stringify(objects.map((o) => o.id))).toBeTruthy();
    expect(product.life.end).toBeGreaterThan(out.doc.duration);
  });
});
