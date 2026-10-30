import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { fixturePath } from '../test-utils/fixtures';
import { lightValidate } from '../engine/light-validator';
import { parseModel3D } from './types';

const load = (f: string) => JSON.parse(readFileSync(fixturePath('s13a', f), 'utf8')) as { layers: Array<Record<string, unknown>> };
const layer = () => structuredClone(load('valid-model3d.json').layers[0]!);

it('parses the design example layer', () => {
  const r = parseModel3D(layer());
  expect(r.ok, JSON.stringify(r)).toBe(true);
});

it("fails an extrude contour of two points with a message naming contour", () => {
  const l = { ...layer(), source: { type: 'extrude', contour: [[0, 0], [1, 1]], depth: 10 } };
  const r = parseModel3D(l);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.issues.map((i) => i.path).join(' ')).toContain('contour');
});

it("fails an extra top-level key 'spin' (strict)", () => {
  const r = parseModel3D({ ...layer(), spin: 1 });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(JSON.stringify(r.issues)).toContain('spin');
});

it('fails values the engine would reject', () => {
  expect(parseModel3D({ ...layer(), viewport: { width: 8, height: 100 } }).ok).toBe(false);
  expect(parseModel3D({ ...layer(), textures: { side: 'red' } }).ok).toBe(false);
  expect(parseModel3D({ ...layer(), source: { type: 'primitive', shape: 'sphere' } }).ok).toBe(false);
  expect(parseModel3D({ ...layer(), lighting: { preset: 'disco' } }).ok).toBe(false);
});

it('light validator accepts the model3d fixture', () => {
  const r = lightValidate(load('valid-model3d.json'));
  expect(r.ok, JSON.stringify(r)).toBe(true);
});

it("rejects a model3d layer under schema 1.3.0 with a message naming '1.4.0'", () => {
  const r = lightValidate(load('model3d-old-version.json'));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.issues.map((i) => i.message).join(' ')).toContain('1.4.0');
});

it("rejects a label texture that names an undeclared asset, naming 'assetId'", () => {
  const r = lightValidate(load('model3d-unknown-texture.json'));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.issues.map((i) => i.message).join(' ')).toContain('assetId');
});

it('also checks a model3d layer inside a scene precomp against that precomp\'s own assets', () => {
  const c = load('valid-model3d.json') as unknown as Record<string, unknown>;
  const inner = structuredClone(c);
  (inner as { assets: Record<string, unknown> }).assets = {};
  const outer = { ...c, layers: [], precomps: { s1: inner } };
  const r = lightValidate(outer);
  expect(r.ok).toBe(false);
});
