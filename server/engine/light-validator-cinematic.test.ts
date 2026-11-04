import { describe, expect, it } from 'vitest';
import { defaultBeatSheet } from '../authoring/beatsheet';
import { buildCinematicFilm } from '../authoring/cinematic-film';
import { floorElements } from '../authoring/ingredients';
import { lightValidate } from './light-validator';

const els = floorElements('Cold Brew', 'drinks');
const base = () =>
  JSON.parse(
    JSON.stringify(
      buildCinematicFilm({
        aspect: '9:16',
        sheet: defaultBeatSheet(els),
        texture: { id: 'ast_label', src: '/l.png', width: 2048, height: 1024, kind: 'label' },
        shape: 'can',
        side: '#e8e0ce',
        productAspect: 3,
        title: 'Cold Brew',
        price: 4.5,
        accent: '#c27a3a',
        ingredients: {},
      }),
    ),
  );
const issues = (c: unknown): string => {
  const v = lightValidate(c);
  return v.ok ? '' : JSON.stringify(v.issues);
};
const layers = (c: any): any[] => c.precomps.cine.layers;
const prop = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'prop3d', stage: 'cine:world', inPoint: 0, outPoint: 30, source: { type: 'primitive', shape: 'box' }, ...extra });

describe('light validator, cinematic stage (schema 1.12.0)', () => {
  it('accepts an animated camera, ground none and wall false at 1.12.0', () => {
    expect(issues(base())).toBe('');
  });
  it('rejects them below 1.12.0', () => {
    const c = base();
    c.version = '1.11.0';
    c.precomps.cine.version = '1.11.0';
    expect(issues(c)).toMatch(/camera/);
    expect(issues(c)).toMatch(/1\.12\.0/);
  });
  it('rejects a camera that is neither a vector nor keyframes of vectors', () => {
    const c = base();
    layers(c).find((l) => l.kind === 'stage3d').camera.position = [{ t: 0, v: [0, 1] }];
    expect(issues(c)).toMatch(/\[x, y, z\] or keyframes/);
  });
  it('allows 12 props but not 13', () => {
    const c = base();
    const ls = layers(c);
    // the product world's own props (the titles live in a world of their own)
    const have = ls.filter((l) => l.kind === 'prop3d' && l.stage === 'cine:world').length;
    for (let n = have; n < 12; n++) ls.push(prop(`p${n}`));
    expect(issues(c)).not.toMatch(/holds at most/);
    ls.push(prop('p13'));
    expect(issues(c)).toMatch(/holds at most 12 props/);
  });
  it('limits a swarm to 200 copies and a world to 400', () => {
    const c = base();
    layers(c).push(prop('s1', { swarm: { count: 201 } }));
    expect(issues(c)).toMatch(/holds 1 to 200 copies/);
    const d = base();
    layers(d).push(prop('s1', { swarm: { count: 200 } }), prop('s2', { swarm: { count: 200 } }));
    expect(issues(d)).toMatch(/at most 400 prop copies/);
  });
  it('wants a card to have a picture that exists', () => {
    const c = base();
    layers(c).push(prop('card', { source: { type: 'card' } }));
    expect(issues(c)).toMatch(/needs textures.front or source.frames/);
    const d = base();
    layers(d).push(prop('card', { source: { type: 'card', frames: ['ast_nope', 'ast_nope2'] } }));
    expect(issues(d)).toMatch(/unknown assetId 'ast_nope'/);
  });
  it('a rounded box needs 1.12.0, a round between 0 and 0.5, and a box', () => {
    const ok = base();
    layers(ok).push(prop('ice', { source: { type: 'primitive', shape: 'box', round: 0.2 } }));
    expect(issues(ok)).toBe('');
    const low = base();
    low.version = '1.11.0';
    low.precomps.cine.version = '1.11.0';
    layers(low).push(prop('ice', { source: { type: 'primitive', shape: 'box', round: 0.2 } }));
    expect(issues(low)).toMatch(/source\.round need schema >= 1\.12\.0/);
    const big = base();
    layers(big).push(prop('ice', { source: { type: 'primitive', shape: 'box', round: 0.9 } }));
    expect(issues(big)).toMatch(/corner radius from 0 to 0\.5/);
    const can = base();
    layers(can).push(prop('ice', { source: { type: 'primitive', shape: 'can', round: 0.2 } }));
    expect(issues(can)).toMatch(/round is only valid for a box/);
  });
  it('wants caustics and a reflection to have a ground, and a smoke form it knows', () => {
    const c = base();
    const w = layers(c).find((l) => l.kind === 'stage3d');
    w.set = { ground: 'none', wall: false, caustics: { strength: 0.5 } };
    expect(issues(c)).toMatch(/set\.caustics needs a ground/);
    const d = base();
    layers(d).push(prop('fog', { source: { type: 'smoke', form: 'fog' } }));
    expect(issues(d)).toMatch(/form is steam, cloud or powder/);
  });
  it('rejects a swarm, a material, a card, a liquid and a smoke below 1.12.0', () => {
    for (const extra of [{ swarm: { count: 4 } }, { material: { roughness: 0.2 } }, { source: { type: 'liquid', form: 'crown' } }, { source: { type: 'smoke', form: 'steam' } }]) {
      const c = base();
      c.version = '1.11.0';
      c.precomps.cine.version = '1.11.0';
      // the animated camera also fails; the prop's own message is what this test looks for
      layers(c).push(prop('x', extra));
      expect(issues(c)).toMatch(/swarm, material, card, liquid, smoke and source\.round need schema >= 1\.12\.0/);
    }
  });
  it('wants a body\'s textures.back to name an asset of the composition', () => {
    const c = base();
    const body = { source: { type: 'extrude', contour: [[0, 0], [10, 0], [10, 20]], depth: 5, section: 2 }, textures: { front: 'ast_label', back: 'ast_nope', side: '#ffffff' } };
    layers(c).push(prop('cine:body', body));
    expect(issues(c)).toMatch(/textures\.back/);
    c.assets.ast_back = { type: 'image', src: '/b.png', width: 10, height: 20 };
    c.precomps.cine.assets = { ...(c.precomps.cine.assets ?? {}), ast_back: c.assets.ast_back };
    layers(c).find((l: any) => l.id === 'cine:body').textures.back = 'ast_back';
    expect(issues(c)).not.toMatch(/textures\.back/);
  });
});
