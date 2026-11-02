import { expect, it } from 'vitest';
import { lightValidate } from '../engine/light-validator';
import * as api from './api';
import { AuthoringError } from './errors';
import { MUG, threeSceneFilm } from './test-helpers';
import type { Comp } from './types';

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

it('200 random operations keep every result valid and never mutate the input', () => {
  const rnd = mulberry32(7);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const num = () => pick([-1, 0, 0.5, 1, 2, 3.3, 10, 99, Number.NaN]);
  let c: Comp = api.registerAsset(threeSceneFilm(), { id: MUG, kind: 'image', src: '/a.png', width: 384, height: 672 });
  const scenes = () => api.sceneInfo(c).map((s) => s.id).concat(['ghost']);
  const layers = () => Object.keys((c.meta as { director: { layers: object } }).director.layers).concat(['s1:ghost', 'nope']);
  const roles = ['bg', 'product', 'subject', 'headline', 'caption', 'clip'] as const;
  const props = ['x', 'y', 'scale', 'rotation', 'opacity'] as const;
  const eases = ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const;
  const moves = ['static', 'dolly-in', 'pan', 'orbit', 'parallax'] as const;

  const ops: Array<() => Comp> = [
    () => api.addScene(c, { id: pick(['a', 'b', 'c', 's1', 'bad:id']), durationSec: num(), mode: pick(['motion', 'generate'] as const) }),
    () => api.setSceneDuration(c, pick(scenes()), num()),
    () => api.swapScenes(c, pick(scenes()), pick(scenes())),
    () => api.removeScene(c, pick(scenes())),
    () => api.addLayer(c, { sceneId: pick(scenes()), role: pick([...roles]), kind: pick(['image', 'video', 'text', 'shape'] as const), assetId: pick([MUG, 'nope']), text: pick(['Hi', '', 'x'.repeat(130)]) }),
    () => api.removeLayer(c, pick(layers())),
    () => api.reorderLayer(c, pick(layers()), pick(['front', 'back', { above: pick(layers()) }, { below: pick(layers()) }] as const)),
    () => api.setLayerHidden(c, pick(layers()), rnd() > 0.5),
    () => api.setTransform(c, pick(layers()), { [pick([...props])]: num() }),
    () => api.setKeyframes(c, pick(layers()), pick([...props]), [[num(), num()], [num(), num()]], pick([...eases])),
    () => api.setText(c, pick(layers()), pick(['Words', '', 'y'.repeat(121)])),
    () => api.setCamera(c, pick(scenes()), pick([...moves]), pick([0, 0.5, 1, 2])),
  ];

  let valid = 0;
  for (let i = 0; i < 200; i++) {
    const before = structuredClone(c);
    let next: Comp | undefined;
    try {
      next = pick(ops)();
    } catch (e) {
      expect(e instanceof AuthoringError || e instanceof RangeError, String(e)).toBe(true);
    }
    expect(c, 'the input must be unchanged').toEqual(before);
    if (next) {
      const v = lightValidate(next);
      expect(v.ok, JSON.stringify(v)).toBe(true);
      c = next;
      valid++;
    }
  }
  expect(valid).toBeGreaterThan(20);
});
