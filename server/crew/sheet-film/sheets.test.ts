import { describe, expect, it } from 'vitest';
import { buildCinematicFilm, type CinematicInput } from '../../authoring/cinematic-film';
import { defaultBeatSheet, type Beat } from '../../authoring/beatsheet';
import { floorElements, type IngredientAsset } from '../../authoring/ingredients';
import { aepCompositionSchema } from '@shared/aep/composition';
import { lightValidate } from '../../engine/light-validator';
import type { Obj } from '../../authoring/types';
import { aepToMotion } from '../../../web/src/motion/aep';
import { elementSheetComp, panelTimes, productSheetComp, setSheetComp, sheetLabels } from './sheets';

const pic = (id: string, w = 128, h = 64) => ({ id, src: `/api/assets/${id}`, width: w, height: h });
const base: CinematicInput = { aspect: '9:16', sheet: defaultBeatSheet(floorElements('Coffee Co. Cold Brew', 'drinks')), texture: { ...pic('ast_label', 2048, 1024), kind: 'label' }, shape: 'can', side: '#e8e0ce', productAspect: 3, title: 'Coffee Co. Cold Brew', accent: '#c27a3a' };
const beat = (extra: Partial<Beat> = {}): Beat => ({ size: 'medium', move: 'push', seconds: 2, angle: 'eye', phase: 'build', product: 'still', blur: 0.3, ...extra });
const ingredients: Record<string, IngredientAsset> = {
  raspberry: { kind: 'raspberry', use: 'solid', sizeM: 0.02, frames: [pic('ast_rasp')], contour: [[0, 10], [60, 0], [120, 10], [60, 60]], side: '#8a1c3c' },
  honey: { kind: 'honey', use: 'card', sizeM: 0.3, frames: [pic('ast_honey', 512, 512)] },
};
const withElements = (): CinematicInput => ({
  ...base,
  ingredients,
  sheet: { beats: [beat({ phase: 'hook', size: 'wide' }), beat({ ingredient: { kind: 'raspberry', action: 'fall', scale: 1 } }), beat({ ingredient: { kind: 'honey', action: 'drift', scale: 1 } }), beat({ phase: 'close', move: 'hold' })] },
});
const layers = (c: unknown): Obj[] => (c as Obj).layers;
const props = (c: unknown) => layers(c).filter((l) => l.kind === 'prop3d');

describe('productSheetComp', () => {
  const film = buildCinematicFilm(base);
  const sheet = productSheetComp(film)!;
  it('is four frames of a square, with the product turned 0, 45, 90 and 180 degrees on hold keys', () => {
    expect(sheet.durationInFrames).toBe(4);
    expect(sheet.width).toBe(sheet.height);
    const product = props(sheet).find((p) => p.role === 'product')!;
    expect(product.rotation.map((k: Obj) => [k.t, k.v[1], k.hold])).toEqual([[0, 0, true], [1, 45, true], [2, 90, true], [3, 180, true]]);
  });
  it('has no grade and no set, and the validator accepts it', () => {
    const world = layers(sheet).find((l) => l.kind === 'stage3d')!;
    expect(world.post).toBeUndefined();
    expect(world.style.exposure).toBe(1);
    expect(world.set.ground).toBe('none');
    expect(lightValidate(sheet).ok).toBe(true);
  });
  it('is undefined for a film without a product', () => {
    const copy = structuredClone(film) as Obj;
    copy.precomps.cine.layers = copy.precomps.cine.layers.filter((l: Obj) => l.role !== 'product');
    expect(productSheetComp(copy as typeof film)).toBeUndefined();
  });
});

describe('elementSheetComp and setSheetComp', () => {
  const film = buildCinematicFilm(withElements());
  it('gives one panel per element, drawn halfway through its two frames, each holding exactly one element', () => {
    const sheet = elementSheetComp(film)!;
    expect(sheet.durationInFrames).toBe(4);
    const ps = props(sheet);
    expect(ps).toHaveLength(2);
    expect(ps.map((p) => [p.inPoint, p.outPoint])).toEqual([[0, 2], [2, 4]]);
    // a splash is timed by its prop's life: drawn at its first instant it is a flat disc (the cream of 4 Nov)
    expect(panelTimes(sheet)).toEqual([0.5, 1.5]);
    expect(panelTimes(setSheetComp(film))).toEqual([0, 1]);
    expect(lightValidate(sheet).ok).toBe(true);
    expect(sheetLabels(film).elements).toEqual(['raspberry: fall', 'honey: drift']);
  });
  it('is undefined when the film has no elements', () => {
    expect(elementSheetComp(buildCinematicFilm(base))).toBeUndefined();
  });
  it('shows the empty set under the film grade: two frames, the post kept, no prop', () => {
    const sheet = setSheetComp(film);
    expect(sheet.durationInFrames).toBe(2);
    const world = layers(sheet).find((l) => l.kind === 'stage3d')!;
    const original = (film as Obj).precomps.cine.layers.find((l: Obj) => l.id === 'cine:world');
    expect(world.post).toBeDefined();
    expect(Object.keys(world.post)).toEqual(Object.keys(original.post));
    // a 2-frame sheet cannot hold the film's keyframes: none are carried over
    expect(JSON.stringify(world.post)).not.toContain('"t":');
    expect(props(sheet)).toHaveLength(0);
    expect(lightValidate(sheet).ok).toBe(true);
    expect(sheetLabels(film).set).toEqual(['wide', 'reverse']);
  });
});

describe('the element and set sheets show what a still frame can', () => {
  it('shows each element as one piece, not its swarm (a swarm starts high and falls, so a still of it is empty)', () => {
    const sheet = elementSheetComp(buildCinematicFilm(withElements()))!;
    expect(props(sheet).length).toBeGreaterThan(0);
    for (const p of props(sheet)) expect(p.swarm).toBeUndefined();
  });
  it("keeps the set's air (the bokeh) in the set sheet, still", () => {
    const set = { look: 'night' as const, air: 'bokeh' as const, backdrop: pic('ast_bd', 1080, 1920), ground: '#111111', dot: pic('ast_dot', 64, 64) };
    const film = buildCinematicFilm({ ...base, set });
    const air = props(setSheetComp(film)).filter((p) => /air-/.test(String(p.id)));
    expect(air.length).toBeGreaterThan(0);
    expect(JSON.stringify(air)).not.toContain('"t":');
    expect(() => aepToMotion(setSheetComp(film) as never)).not.toThrow();
  });
});

describe('the engine adapter', () => {
  it('accepts the set sheet of a film whose world is animated (the live run failed here: tweens past the 2-frame layer)', () => {
    const film = buildCinematicFilm(base);
    expect(() => aepToMotion(setSheetComp(film) as never)).not.toThrow();
  });
});

describe('the real schema', () => {
  it('accepts every sheet', () => {
    const film = buildCinematicFilm(withElements());
    for (const sheet of [productSheetComp(film), elementSheetComp(film), setSheetComp(film)]) {
      const r = aepCompositionSchema.safeParse(sheet);
      expect(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))).toBe(true);
    }
  });
});

describe('an element used in two shots', () => {
  it('is one panel', () => {
    const i = withElements();
    const film = buildCinematicFilm({ ...i, sheet: { beats: [...i.sheet.beats.slice(0, 3), beat({ ingredient: { kind: 'raspberry', action: 'burst', scale: 1 } }), ...i.sheet.beats.slice(3)] } });
    expect(elementSheetComp(film)!.durationInFrames).toBe(4);
    expect(sheetLabels(film).elements).toEqual(['raspberry: fall', 'honey: drift']);
  });
});
