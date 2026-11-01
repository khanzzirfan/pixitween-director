import { describe, expect, it } from 'vitest';
import type { Obj } from './types';
import { buildVariantFilm, inkOn, tint, type VariantFilmInput } from './variant-film';

const can = { id: 'ast_can', src: '/c.png', width: 256, height: 752 };
const input = (o: Partial<VariantFilmInput> = {}): VariantFilmInput => ({
  aspect: '9:16',
  brand: 'Coffee Co.',
  tagline: 'Pick your cold brew',
  accent: '#7a3b12',
  variants: [
    { product: can, name: 'Original', color: '#3b2314', price: 4.5 },
    { product: can, name: 'Vanilla Cream', color: '#e8c872', price: 4.75 },
    { product: can, name: 'Mocha', color: '#8a4b2a', price: 4.75 },
  ],
  ...o,
});
const scene = (c: any, id: string): Obj[] => c.precomps[id].layers;
const times = (kf: any) => (Array.isArray(kf) ? kf.map((k: any) => k.t) : []);

describe('buildVariantFilm', () => {
  it('one act per variant then the lineup, in order, and the end card holds at least 30 % of the film', () => {
    const c = buildVariantFilm(input()) as any;
    const scenes = c.meta.director.scenes;
    expect(Object.keys(scenes)).toEqual(['v1', 'v2', 'v3', 'end']);
    expect(scenes.v2.startFrame).toBe(scenes.v1.startFrame + scenes.v1.durationFrames);
    expect(scenes.end.durationFrames / c.durationInFrames).toBeGreaterThanOrEqual(0.29);
  });

  it('is deterministic and registers a shared cut-out once', () => {
    expect(buildVariantFilm(input())).toEqual(buildVariantFilm(input()));
    expect(Object.keys((buildVariantFilm(input()) as any).assets)).toEqual(['ast_can']);
  });

  it('each act: the field is the variant colour, the pack tumbles in tilted and settles upright, then punches into the label', () => {
    const c = buildVariantFilm(input()) as any;
    ['v1', 'v2'].forEach((sid, n) => {
      const ls = scene(c, sid);
      expect(ls.some((l) => l.kind === 'shape' && l.fill === input().variants[n]!.color && l.path.size[0] === 1080)).toBe(true);
      const pack = ls.find((l) => l.kind === 'image')!;
      const rot = pack.transform.rotation.map((k: any) => k.v);
      expect(Math.abs(rot[0])).toBeGreaterThan(0.2); // about 22 degrees, in radians
      expect(rot[rot.length - 1]).toBe(0);
      const sc = pack.transform.scale.map((k: any) => k.v[0]);
      expect(sc[0]).toBe(0);
      expect(sc[sc.length - 1] / sc[2]).toBeGreaterThan(2); // the label macro
    });
    // consecutive acts tilt opposite ways
    const r1 = scene(c, 'v1').find((l) => l.kind === 'image')!.transform.rotation[0].v;
    const r2 = scene(c, 'v2').find((l) => l.kind === 'image')!.transform.rotation[0].v;
    expect(Math.sign(r1)).toBe(-Math.sign(r2));
  });

  it('after the first act the field whips in from the right in a few frames', () => {
    const c = buildVariantFilm(input()) as any;
    const f1 = scene(c, 'v1').find((l) => l.kind === 'shape' && l.path.size[0] === 1080)!;
    const f2 = scene(c, 'v2').find((l) => l.kind === 'shape' && l.path.size[0] === 1080)!;
    expect(Array.isArray(f1.transform.position[0])).toBe(false);
    expect(f2.transform.position[0].v[0]).toBeGreaterThan(1080);
    expect(f2.transform.position[1].t).toBeLessThanOrEqual(5);
  });

  it('types the name in word by word, readable on the field colour', () => {
    const c = buildVariantFilm(input()) as any;
    const words = scene(c, 'v2').filter((l) => l.kind === 'text');
    expect(words.map((w) => w.source)).toEqual(['Vanilla', 'Cream']);
    expect(words[1]!.style.weight).toBe(800);
    expect(words[0]!.style.fill ?? words[0]!.style.color).toBe('#1a1a1a'); // dark ink on the light vanilla field
    const starts = words.map((w) => times(w.transform.opacity)[1]);
    expect(starts[1]).toBeGreaterThan(starts[0]);
  });

  it('the lineup shows every variant with its price, dropping in one after another, and the tagline', () => {
    const c = buildVariantFilm(input()) as any;
    const ls = scene(c, 'end');
    const packs = ls.filter((l) => l.kind === 'image');
    expect(packs).toHaveLength(3);
    const lands = packs.map((p) => p.transform.position[1].t);
    expect(lands[1]).toBeGreaterThan(lands[0]);
    const texts = ls.filter((l) => l.kind === 'text').map((l) => l.source);
    expect(texts).toEqual(expect.arrayContaining(['$4.50', '$4.75', 'Pick', 'your', 'cold', 'brew', 'Coffee Co.']));
    const xs = packs.map((p) => (Array.isArray(p.transform.position[0]) || typeof p.transform.position[0] === 'object' ? p.transform.position[0].v[0] : p.transform.position[0]));
    expect(xs[0]).toBeLessThan(xs[1]);
  });

  it('fits any aspect and caps at six acts', () => {
    for (const aspect of ['16:9', '1:1'] as const) expect(() => buildVariantFilm(input({ aspect }))).not.toThrow();
    const many = input({ variants: Array.from({ length: 8 }, (_, n) => ({ product: can, name: `V${n}`, color: '#336699', price: 1 })) });
    expect(Object.keys((buildVariantFilm(many) as any).meta.director.scenes)).toHaveLength(7);
    expect(() => buildVariantFilm(input({ variants: [] }))).toThrow();
  });

  it('adds a music bed under the whole film when given', () => {
    const c = buildVariantFilm(input({ music: { id: 'ast_bed', src: '/bed.wav' } })) as any;
    const bed = c.layers.find((l: Obj) => l.kind === 'audio')!;
    expect(bed.outPoint).toBe(c.durationInFrames);
  });
});

describe('colour helpers', () => {
  it('tints toward white and picks readable ink', () => {
    expect(tint('#000000', 0.5)).toBe('#808080');
    expect(inkOn('#ffffff')).toBe('#1a1a1a');
    expect(inkOn('#3b2314')).toBe('#ffffff');
  });
});

describe('variant naming and colour', () => {
  it('names each variant by the words only it has', async () => {
    const { variantNames } = await import('./variant-film');
    expect(variantNames(['Coffee Co. Cold Brew', 'Coffee Co. Vanilla Cold Brew', 'Coffee Co. Mocha Cold Brew'])).toEqual(['Original', 'Vanilla', 'Mocha']);
    expect(variantNames(['Stone Mug', 'Sage Mug'])).toEqual(['Stone', 'Sage']);
  });
  it('colours by name, then by position', async () => {
    const { colorFor } = await import('./variant-film');
    expect(colorFor('Vanilla', 0)).toBe('#e8c872');
    expect(colorFor('Mocha', 1)).toBe('#6b3e26');
    expect(colorFor('Zesty', 0)).not.toBe(colorFor('Zesty', 1));
  });
});

describe('a sale in the lineup', () => {
  it('shows the old price struck through above the new one', () => {
    const c = buildVariantFilm(input({ variants: [{ product: can, name: 'Mocha', color: '#6b3e26', price: 3.99, wasPrice: 4.75 }, { product: can, name: 'Original', color: '#3b2314', price: 4.5 }] })) as any;
    const ls = scene(c, 'end');
    const was = ls.find((l) => l.source === '$4.75')!;
    const now = ls.find((l) => l.source === '$3.99')!;
    expect(was).toBeTruthy();
    expect(ls.filter((l) => l.source === '$4.50')).toHaveLength(1);
    const y = (l: Obj) => (Array.isArray(l.transform.position[0]) || typeof l.transform.position[0] === 'object' ? l.transform.position[0].v[1] : l.transform.position[1]);
    expect(y(was)).toBeLessThan(y(now));
  });
});

describe('tagline from the line name', () => {
  it('names the line from the shared words, without the brand', async () => {
    const { lineName, taglineFor } = await import('./variant-film');
    expect(lineName(['Coffee Co. Cold Brew', 'Coffee Co. Vanilla Cold Brew'], 'Coffee Co.')).toBe('cold brew');
    expect(taglineFor(['Stone Mug', 'Sage Mug'], 'Hearth')).toBe('Pick your mug');
    expect(taglineFor(['Alpha', 'Beta'])).toBe('Pick your favourite');
  });
});
