import { describe, expect, it } from 'vitest';
import { buildHero3DClip, HERO3D_BEATS, type Hero3DInput } from './hero3d-clip';
import type { Obj } from './types';

const input = (o: Partial<Hero3DInput> = {}): Hero3DInput => ({
  aspect: '9:16',
  texture: { id: 'ast_label', src: '/l.png', width: 2048, height: 1024, kind: 'label' },
  shape: 'can',
  side: '#e8e0ce',
  productAspect: 3,
  title: 'Coffee Co. Cold Brew',
  brand: 'Coffee Co.',
  price: 4.5,
  currency: 'USD',
  accent: '#c27a3a',
  ...o,
});
const layers = (c: any): Obj[] => c.precomps.hero.layers;
const model = (c: any): Obj => layers(c).find((l) => l.kind === 'model3d')!;
const at = (ks: any[], t: number) => ks.find((k) => k.t === t);

describe('buildHero3DClip', () => {
  it('is deterministic and puts the product in as a model3d can wearing the label', () => {
    expect(buildHero3DClip(input())).toEqual(buildHero3DClip(input()));
    const m = model(buildHero3DClip(input()));
    expect(m.source).toEqual({ type: 'primitive', shape: 'can', proportions: { width: 1, height: 3 } });
    expect(m.textures.label).toBe('ast_label');
    expect(layers(buildHero3DClip(input())).some((l) => l.kind === 'image')).toBe(false);
  });

  it('tumbles in from above tilted and spinning, lands upright, then turns slowly and ends near the front', () => {
    const c = buildHero3DClip(input()) as any;
    const m = model(c);
    const fps = c.fps;
    const ys = m.transform.position.map((k: any) => k.v[1]);
    expect(ys[0]).toBeLessThan(0);
    expect(Math.abs(m.transform.rotation[0].v)).toBeGreaterThan(0.3); // about 24 degrees, in radians
    expect(m.transform.rotation.at(-1).v).toBe(0);
    const rot = m.view.rotation;
    expect(rot[0].v[1]).toBeLessThan(-180); // a fast spin as it falls
    expect(at(rot, Math.round(HERO3D_BEATS.land * fps)).v[1]).toBeGreaterThanOrEqual(-35);
    expect(Math.abs(rot.at(-1).v[1])).toBeLessThanOrEqual(35); // the label faces the camera at the end
  });

  it('runs the key light across the label during the turn', () => {
    const m = model(buildHero3DClip(input()));
    const az = m.lighting.key.azimuth.map((k: any) => k.v);
    expect(az[0]).toBeLessThan(0);
    expect(az.at(-1)).toBeGreaterThan(0);
  });

  it('dolly zoom: the lens widens while the can keeps its place and size, and the halo grows', () => {
    const c = buildHero3DClip(input()) as any;
    const fps = c.fps;
    const m = model(c);
    const f0 = at(m.camera.fov, Math.round(HERO3D_BEATS.dollyStart * fps)).v;
    const f1 = at(m.camera.fov, Math.round(HERO3D_BEATS.dollyEnd * fps)).v;
    expect(f1).toBeGreaterThan(f0 * 2);
    expect(f1).toBeLessThanOrEqual(90);
    expect(typeof m.transform.scale[0]).toBe('number'); // the can is not scaled to fake it
    expect(m.view.position).toBeUndefined();
    const halo = layers(c).find((l) => l.kind === 'shape' && l.path?.kind === 'ellipse' && Array.isArray(l.transform.scale) && l.transform.scale.length > 3)!;
    expect(halo.transform.scale.at(-1).v[0]).toBeGreaterThan(1.3);
  });

  it("turns off the engine's clipped 3D shadow and draws a 2D contact shadow", () => {
    const c = buildHero3DClip(input());
    expect(model(c).shadow.opacity).toBe(0);
    expect(layers(c).some((l) => l.kind === 'shape' && l.fill === '#000000' && l.path?.kind === 'ellipse')).toBe(true);
  });

  it('copy: brand, the name without the brand word by word, and the price in a disc clear of the can', () => {
    const c = buildHero3DClip(input()) as any;
    const texts = layers(c).filter((l) => l.kind === 'text').map((l) => l.source);
    expect(texts).toEqual(expect.arrayContaining(['COFFEE CO.', 'Cold', 'Brew', '$4.50']));
    const m = model(c);
    const canRight = m.transform.position.at(-1).v[0] + (m.viewport.width * m.transform.scale[0]) / 1.5 / 2;
    const disc = layers(c).find((l) => l.kind === 'shape' && l.fill === '#c27a3a')!;
    const dx = disc.transform.position[0] - disc.path.size[0] / 2;
    expect(dx).toBeGreaterThan(canRight - 1);
  });

  it('a sale shows the old price struck through in the disc', () => {
    const c = buildHero3DClip(input({ price: 3.99, wasPrice: 4.75 }));
    const texts = layers(c).filter((l) => l.kind === 'text').map((l) => l.source);
    expect(texts).toEqual(expect.arrayContaining(['$3.99', '$4.75']));
    expect(layers(c).some((l) => l.fill === '#ff5a6e')).toBe(true);
  });

  it('fits other aspects', () => {
    for (const aspect of ['16:9', '1:1'] as const) expect(() => buildHero3DClip(input({ aspect }))).not.toThrow();
  });
});
