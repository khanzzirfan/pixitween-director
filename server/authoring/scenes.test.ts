import { expect, it } from 'vitest';
import { lightValidate } from '../engine/light-validator';
import { newFilmComposition } from './composition';
import { readDirector } from './meta';
import { addScene } from './scenes';
import type { Comp, Obj } from './types';

const base = () => newFilmComposition({ aspect: '16:9' });
const two = (): Comp => addScene(addScene(base(), { id: 's1', durationSec: 4, mode: 'motion' }), { id: 's2', durationSec: 3, mode: 'generate', intent: 'pour' });

it('sequences two scenes on the root timeline', () => {
  const c = two();
  expect(c.durationInFrames).toBe(210);
  const [a, b] = c.layers as Obj[];
  expect([a!.inPoint, a!.outPoint, b!.inPoint, b!.outPoint]).toEqual([0, 120, 120, 210]);
  expect(readDirector(c).scenes.s2).toMatchObject({ startFrame: 120, durationFrames: 90, mode: 'generate', intent: 'pour' });
  expect((c.precomps as Obj).s1.durationInFrames).toBe(120);
  expect(lightValidate(c).ok).toBe(true);
});
it('validates scene input', () => {
  const c = two();
  expect(() => addScene(c, { id: 's1', durationSec: 2, mode: 'motion' })).toThrow(/duplicate_scene/);
  expect(() => addScene(c, { id: 'a:b', durationSec: 2, mode: 'motion' })).toThrow(/bad_value/);
  expect(() => addScene(c, { id: 's9', durationSec: 0.5, mode: 'motion' })).toThrow(/bad_duration/);
});
it('limits scenes and film length', () => {
  let c = base();
  for (let i = 0; i < 12; i++) c = addScene(c, { id: `s${i}`, durationSec: 1, mode: 'motion' });
  expect(() => addScene(c, { id: 'extra', durationSec: 1, mode: 'motion' })).toThrow(/scene_limit/);
  let d = base();
  for (let i = 0; i < 3; i++) d = addScene(d, { id: `s${i}`, durationSec: 20, mode: 'motion' });
  expect(() => addScene(d, { id: 'x', durationSec: 1, mode: 'motion' })).toThrow(/film_too_long/);
});
