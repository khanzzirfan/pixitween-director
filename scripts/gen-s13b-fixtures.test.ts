import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { lightValidate } from '../server/engine/light-validator';
import { parseModel3D } from '../server/product3d/types';
import { buildFilm, buildLabel, serialise } from './gen-s13b-fixtures';

const url = (p: string) => new URL(`../${p}`, import.meta.url);

it('the committed fixture passes the light validator and holds one valid 3D can', () => {
  const comp = JSON.parse(readFileSync(url('fixtures/s13b/three-check.json'), 'utf8'));
  const r = lightValidate(comp);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const layers = comp.precomps.s1.layers as Array<Record<string, unknown>>;
  const three = layers.filter((l) => l.kind === 'model3d');
  expect(three).toHaveLength(1);
  expect(parseModel3D(three[0]).ok).toBe(true);
  // the headline is drawn before the can, so the can covers it; the caption after
  const order = layers.map((l) => l.id);
  expect(order.indexOf('s1:headline')).toBeLessThan(order.indexOf('s1:product3d'));
  expect(order.indexOf('s1:caption')).toBeGreaterThan(order.indexOf('s1:product3d'));
});

it('regenerating in memory equals the committed files', async () => {
  const label = await buildLabel();
  expect(readFileSync(url('fixtures/s13b/three-check.json'), 'utf8')).toBe(serialise(buildFilm(label.side, label.aspect)));
  expect(readFileSync(url('web/public/dev/can-label.png')).equals(label.png)).toBe(true);
});
