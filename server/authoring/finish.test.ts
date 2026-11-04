import { describe, expect, it } from 'vitest';
import { ensurePrice, findPrice, finishComposition, fitText } from './finish';
import type { Comp } from './types';

const t = { position: [0, 0], anchor: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 };
const film = (): Comp =>
  ({
    version: '1.9.0', id: 'film', width: 1080, height: 1920, fps: 30, durationInFrames: 120, bgColor: '#000', assets: {},
    layers: [{ kind: 'precomp', id: 's1', inPoint: 0, outPoint: 120, compId: 's1', width: 1080, height: 1920, transform: t }],
    precomps: {
      s1: {
        version: '1.9.0', id: 's1', width: 1080, height: 1920, fps: 30, durationInFrames: 120, assets: {},
        layers: [
          { kind: 'image', id: 's1:product', inPoint: 0, outPoint: 120, assetId: 'a', transform: t },
          { kind: 'text', id: 's1:headline', inPoint: 0, outPoint: 120, source: '$4.50', style: { font: 'Inter', size: 100, fill: '#000' }, transform: t },
        ],
      },
    },
    meta: { director: { scenes: {}, layers: { 's1:product': { role: 'product' } } } },
  }) as unknown as Comp;

describe('finishComposition', () => {
  it('shades the product, grades under the type and adds the music bed', () => {
    const out = finishComposition(film(), { musicAssetId: 'bed' }) as any;
    const ls = out.precomps.s1.layers;
    expect(ls[0].effects[0].name).toBe('drop-shadow');
    expect(ls.map((l: any) => l.id)).toEqual(['s1:product', 'finish:s1:grade', 'finish:s1:flash', 's1:headline']);
    expect(ls[3].style.size).toBeGreaterThanOrEqual(168);
    expect(out.layers[0]).toMatchObject({ kind: 'audio', assetId: 'bed' });
  });

  it('is idempotent', () => {
    const once = finishComposition(film(), { musicAssetId: 'bed' });
    expect(finishComposition(once, { musicAssetId: 'bed' })).toEqual(once);
  });
});

const withScenes = (w: number, h: number, texts: string[]): Comp => {
  const c = film() as any;
  c.width = w; c.height = h;
  c.precomps.s1.width = w; c.precomps.s1.height = h;
  c.precomps.s1.layers = c.precomps.s1.layers.filter((l: any) => l.kind !== 'text');
  c.meta.director.scenes = { s1: { precompId: 's1', startFrame: 0, durationFrames: 120, mode: 'motion' } };
  texts.forEach((x, i) => c.precomps.s1.layers.push({ kind: 'text', id: `s1:t${i}`, inPoint: 0, outPoint: 120, source: x, style: { font: 'Inter', size: 96, fill: '#123456', weight: 700 }, transform: { ...t, position: [w / 2, 300] } }));
  return c;
};
const sources = (c: any) => c.precomps.s1.layers.filter((l: any) => l.kind === 'text').map((l: any) => l.source);

describe('findPrice', () => {
  it.each([['only $4.50 today', '$4.50'], ['now €19,90!', '€19,90'], ['just 12 EUR', '12 EUR'], ['£7', '£7']])('%s', (text, want) => expect(findPrice(text)).toBe(want));
  it('finds none in plain copy', () => expect(findPrice('a slow morning, 16 seconds')).toBeUndefined());
});

describe('ensurePrice', () => {
  it('adds a price the brief names but no text shows, to the last scene', () => {
    const out = ensurePrice(withScenes(1080, 1920, ['Cold brew']), 'an ad, end card with the price €19,90') as any;
    expect(sources(out)).toContain('€19,90');
  });
  it('leaves the film alone when the price is already shown, in any currency format', () => {
    const c = withScenes(1080, 1920, ['Only $4.50']);
    expect(ensurePrice(c, 'price $4.5')).toEqual(c);
  });
  it('leaves the film alone when the brief names no price', () => {
    const c = withScenes(1920, 1080, ['Hello']);
    expect(ensurePrice(c, 'a calm morning ad')).toEqual(c);
    expect(ensurePrice(c, undefined)).toEqual(c);
  });
});

describe('fitText', () => {
  const layer = (source: string, size = 96, extra: any = {}) => ({ kind: 'text', id: 'x', source, style: { font: 'Inter', size, weight: 700, ...extra }, transform: { scale: [1, 1] } }) as any;
  it('breaks a long line to fit a vertical frame', () => {
    const l = layer('Cold brew for slow mornings');
    fitText(l, 1080);
    expect(l.source.split('\n').length).toBeGreaterThan(1);
    for (const line of l.source.split('\n')) expect(line.length * 96 * 0.6).toBeLessThanOrEqual(1080 * 0.88);
  });
  it('keeps a short line and a wide frame as they are', () => {
    const l = layer('Cold brew', 96);
    fitText(l, 1080);
    expect(l.source).toBe('Cold brew');
    const m = layer('Cold brew for slow mornings', 96);
    fitText(m, 1920);
    expect(m.source).toBe('Cold brew for slow mornings');
  });
  it('shrinks the type for one word wider than the frame', () => {
    const l = layer('Extraordinarily', 160);
    fitText(l, 1080);
    expect(l.style.size).toBeLessThan(160);
    expect('Extraordinarily'.length * l.style.size * 0.6).toBeLessThanOrEqual(1080 * 0.88 + 1);
  });
  it('is stable on a second pass and keeps explicit line breaks', () => {
    const l = layer('Line one\nCold brew for slow mornings');
    fitText(l, 1080);
    const once = l.source;
    fitText(l, 1080);
    expect(l.source).toBe(once);
    expect(once.startsWith('Line one\n')).toBe(true);
  });
});
