import { expect, it } from 'vitest';
import { lightValidate } from '../engine/light-validator';
import { setCamera } from './camera';
import { mugScene } from './test-helpers';
import type { Comp, Obj } from './types';

const layer = (c: Comp, id: string) => ((c.precomps as Obj).s1.layers as Obj[]).find((l) => l.id === id)!;
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 3);

it('pan moves nearer layers further', () => {
  const c = setCamera(mugScene(), 's1', 'pan');
  const p = layer(c, 's1:product').transform.position;
  close(p[0].v[0], 1011.2);
  close(p[1].v[0], 908.8);
  expect(p[0].t).toBe(0);
  expect(p[1].t).toBe(120);
  expect(p[0].easeOut).toEqual([0.42, 0, 0.58, 1]);
  const b = layer(c, 's1:bg').transform.position;
  close(b[0].v[0], 972.8);
  close(b[1].v[0], 947.2);
  expect(lightValidate(c).ok).toBe(true);
});
it('dolly-in grows the product and leaves HUD alone', () => {
  const before = mugScene();
  const c = setCamera(before, 's1', 'dolly-in');
  const s = layer(c, 's1:product').transform.scale;
  close(s[0].v[0], 0.9964);
  close(s[1].v[0], 1.09604);
  close(layer(c, 's1:product').transform.position[1].v[1], 563.76);
  close(layer(c, 's1:bg').transform.scale[1].v[0], 1.025);
  expect(layer(c, 's1:bg').transform.position).toEqual([960, 540]); // static: no keyframes for a centred bg
  expect(layer(c, 's1:headline').transform).toEqual(layer(before, 's1:headline').transform);
});
it('is idempotent and static restores the base', () => {
  const once = setCamera(mugScene(), 's1', 'pan');
  expect(setCamera(once, 's1', 'pan')).toEqual(once);
  const back = setCamera(once, 's1', 'static');
  expect(layer(back, 's1:product').transform.position).toEqual([960, 561.6]);
  expect(layer(back, 's1:product').transform.scale).toEqual([0.9964, 0.9964]);
});
it('strength 1 doubles the travel', () => {
  const p = layer(setCamera(mugScene(), 's1', 'pan', 1), 's1:product').transform.position;
  close(p[0].v[0] - p[1].v[0], 204.8);
});
it('orbit and parallax', () => {
  const o = layer(setCamera(mugScene(), 's1', 'orbit'), 's1:product').transform;
  expect(o.rotation[0].v).toBeLessThan(0);
  expect(o.rotation[1].v).toBeGreaterThan(0);
  const par = layer(setCamera(mugScene(), 's1', 'parallax'), 's1:product').transform;
  expect(par.scale[1].v[0]).toBeGreaterThan(par.scale[0].v[0]);
});
it('rejects unknown scenes', () => expect(() => setCamera(mugScene(), 'nope', 'pan')).toThrow(/unknown_scene/));
