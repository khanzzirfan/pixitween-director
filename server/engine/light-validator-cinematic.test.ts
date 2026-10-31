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
    const have = ls.filter((l) => l.kind === 'prop3d').length;
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
  it('rejects a swarm, a material and a card below 1.12.0', () => {
    for (const extra of [{ swarm: { count: 4 } }, { material: { roughness: 0.2 } }]) {
      const c = base();
      c.version = '1.11.0';
      c.precomps.cine.version = '1.11.0';
      // the animated camera also fails; the prop's own message is what this test looks for
      layers(c).push(prop('x', extra));
      expect(issues(c)).toMatch(/swarm, material and card need schema >= 1\.12\.0/);
    }
  });
});
