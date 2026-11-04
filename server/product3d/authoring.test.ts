import { expect, it } from 'vitest';
import { layerIdsByRole } from '../authoring/api';
import { AuthoringError } from '../authoring/errors';
import { readDirector } from '../authoring/meta';
import { deepFreeze, mugScene } from '../authoring/test-helpers';
import type { Comp, Obj } from '../authoring/types';
import { lightValidate } from '../engine/light-validator';
import { lightProduct, placeProduct3D, turnProduct, viewportFor, type PlaceOptions } from './authoring';
import { CAMERA, KEY_LIGHT } from './presets';
import { parseModel3D } from './types';

const tex = { id: 'ast_11111111111111111111111111111111', url: '/api/assets/ast_11111111111111111111111111111111', width: 2048, height: 1024, kind: 'label' as const };
const base = (over: Partial<PlaceOptions> = {}): PlaceOptions => ({ sceneId: 's1', box: { x: 760, y: 300, w: 400, h: 600 }, shape: 'can', texture: tex, side: '#1f2937', aspect: 1.85, ...over });
const layerOf = (c: Comp, id = 's1:product3d') => ((c.precomps as Record<string, Obj>).s1!.layers as Obj[]).find((l) => l.id === id)!;

function withProductAt(box: { x: number; y: number; w: number; h: number }): Comp {
  const c = mugScene();
  const [oldId] = layerIdsByRole(c, 'product', 's1');
  // rebuild the product layer at the box
  const out = structuredClone(c);
  const l = ((out.precomps as Record<string, Obj>).s1!.layers as Obj[]).find((x) => x.id === oldId)!;
  l.transform.position = [box.x + box.w / 2, box.y + box.h / 2];
  l.transform.scale = [box.w / 384, box.h / 672];
  return out;
}
it('replaces s1:product with s1:product3d at the box centre with an 800 x 1200 viewport', () => {
  const c = withProductAt({ x: 760, y: 300, w: 400, h: 600 });
  const out = placeProduct3D(c, base());
  const l = layerOf(out);
  expect(l.kind).toBe('model3d');
  expect(l.transform.position).toEqual([960, 600]);
  expect(l.viewport).toEqual({ width: 800, height: 1200 });
  expect(layerOf(out, 's1:product')).toBeUndefined();
  expect(readDirector(out).layers['s1:product3d']).toMatchObject({ sceneId: 's1', role: 'product3d', z: 1 });
  expect(readDirector(out).layers['s1:product']).toBeUndefined();
});

it('keeps the layer in the same place in the stack: under the headline, over the background', () => {
  const out = placeProduct3D(withProductAt({ x: 760, y: 300, w: 400, h: 600 }), base());
  const ids = ((out.precomps as Record<string, Obj>).s1!.layers as Obj[]).map((l) => l.id);
  expect(ids).toEqual(['s1:bg', 's1:product3d', 's1:headline']);
});

it('passes the light validator at version 1.9.0 and the strict mirror of the engine schema', () => {
  const out = placeProduct3D(withProductAt({ x: 760, y: 300, w: 400, h: 600 }), base());
  const r = lightValidate(out);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect(out.version).toBe('1.9.0');
  expect((out.precomps as Record<string, Obj>).s1!.version).toBe('1.9.0');
  expect(parseModel3D(layerOf(out)).ok).toBe(true);
  // the texture is declared where the layer is, so the engine can resolve it
  expect((out.precomps as Record<string, Obj>).s1!.assets[tex.id]).toBeDefined();
  expect(out.assets[tex.id]).toBeDefined();
});

it('turns from [4, -18, 0] at the first frame to [4, 18, 0] at the last, with an ease', () => {
  const l = layerOf(placeProduct3D(withProductAt({ x: 760, y: 300, w: 400, h: 600 }), base()));
  const keys = l.view.rotation as Array<{ t: number; v: number[]; easeOut?: number[] }>;
  expect(keys[0]).toMatchObject({ t: 0, v: [4, -18, 0] });
  expect(keys.at(-1)).toMatchObject({ t: 120, v: [4, 18, 0] });
  expect(keys[0]!.easeOut).toHaveLength(4);
});

it('does not change the input composition', () => {
  const c = deepFreeze(withProductAt({ x: 760, y: 300, w: 400, h: 600 }));
  expect(() => placeProduct3D(c, base())).not.toThrow();
});

it('draws the layer at the box with headroom: viewport pixels times scale is the box times the camera fit', () => {
  const l = layerOf(placeProduct3D(withProductAt({ x: 760, y: 300, w: 400, h: 600 }), base()));
  expect(l.viewport.width * l.transform.scale[0]).toBeCloseTo(400 * CAMERA.fit, 0);
  expect(l.viewport.height * l.transform.scale[1]).toBeCloseTo(600 * CAMERA.fit, 0);
});

it('caps the viewport at 2048 on the long side and keeps its aspect', () => {
  const v = viewportFor({ x: 0, y: 0, w: 1000, h: 1500 });
  expect(Math.max(v.width, v.height)).toBe(2048);
  expect(v.width / v.height).toBeCloseTo(1000 / 1500, 2);
});

it('extrudes a cut-out when the shape is other, with the depth from the width', () => {
  const contour: Array<[number, number]> = [[0, 0], [100, 0], [100, 200], [0, 200]];
  const out = placeProduct3D(withProductAt({ x: 760, y: 300, w: 400, h: 600 }), base({ shape: 'other', contour, texture: { ...tex, width: 100, height: 200, kind: 'front' } }));
  const l = layerOf(out);
  expect(l.source).toMatchObject({ type: 'extrude', contour, depth: 6, bevel: 1.5 });
  expect(l.textures).toMatchObject({ front: tex.id });
  expect(lightValidate(out).ok).toBe(true);
  expect(() => placeProduct3D(withProductAt({ x: 0, y: 0, w: 4, h: 4 }), base({ shape: 'other' }))).toThrow(AuthoringError);
});

it('places a layer in a scene that had no product, and again over its own earlier 3D layer', () => {
  let c = mugScene();
  c = placeProduct3D(c, base({ box: { x: 700, y: 200, w: 300, h: 500 } }));
  const again = placeProduct3D(c, base({ box: { x: 700, y: 200, w: 300, h: 500 }, preset: 'golden' }));
  expect(((again.precomps as Record<string, Obj>).s1!.layers as Obj[]).filter((l) => l.kind === 'model3d')).toHaveLength(1);
  expect(layerOf(again).lighting.preset).toBe('golden');
});

it('clamps a sway of more than 35 degrees', () => {
  const l = layerOf(placeProduct3D(withProductAt({ x: 760, y: 300, w: 400, h: 600 }), base({ sway: 80 })));
  expect(l.view.rotation[0].v[1]).toBe(-35);
});

it('still has the 2D layers it did not replace', () => {
  const out = placeProduct3D(withProductAt({ x: 760, y: 300, w: 400, h: 600 }), base());
  expect(layerOf(out, 's1:headline')).toBeDefined();
  expect(layerOf(out, 's1:bg')).toBeDefined();
});

// turn and light
const placed = () => placeProduct3D(withProductAt({ x: 760, y: 300, w: 400, h: 600 }), base());

it("turnProduct to 50 clamps to 35, says so, and ends at [4, 35, 0]", () => {
  const r = turnProduct(placed(), 's1:product3d', { to: 50 });
  expect(r.clamped).toBe(true);
  const keys = layerOf(r.comp).view.rotation as Array<{ v: number[] }>;
  expect(keys.at(-1)!.v).toEqual([4, 35, 0]);
  expect(keys[0]!.v).toEqual([4, -18, 0]); // the start is where it was
  expect(lightValidate(r.comp).ok).toBe(true);
});

it('turnProduct with a faster speed arrives early and holds', () => {
  const keys = layerOf(turnProduct(placed(), 's1:product3d', { from: -10, to: 10, speed: 2 }).comp).view.rotation as Array<{ t: number; v: number[] }>;
  expect(keys.map((k) => k.t)).toEqual([0, 60, 120]);
  expect(keys[1]!.v).toEqual(keys[2]!.v);
});

it('turnProduct with a slower speed stops short', () => {
  const keys = layerOf(turnProduct(placed(), 's1:product3d', { from: -20, to: 20, speed: 0.5 }).comp).view.rotation as Array<{ t: number; v: number[] }>;
  expect(keys.at(-1)).toMatchObject({ t: 120, v: [4, 0, 0] });
});

it("lightProduct 'window' sets the preset and leaves the view alone", () => {
  const before = layerOf(placed());
  const out = lightProduct(placed(), 's1:product3d', { preset: 'window' });
  expect(layerOf(out).lighting.preset).toBe('window');
  expect(layerOf(out).view).toEqual(before.view);
  expect(lightValidate(out).ok).toBe(true);
});

it('starts with a high key light so the shadow stays under the product', () => {
  expect(layerOf(placed()).lighting.key).toEqual(KEY_LIGHT);
});

it('lightProduct sets the key light angles and keeps the rest of the lighting', () => {
  const out = lightProduct(placed(), 's1:product3d', { azimuth: 40, intensity: 2 });
  expect(layerOf(out).lighting).toMatchObject({ preset: 'studio', environment: 'room', key: { azimuth: 40, intensity: 2 } });
});

it("both throw not_model3d for a layer that is not model3d, and unknown_layer for a missing one", () => {
  const c = placed();
  for (const call of [() => turnProduct(c, 's1:headline', { to: 5 }), () => lightProduct(c, 's1:headline', { preset: 'night' })]) {
    expect(call).toThrow(AuthoringError);
    try {
      call();
    } catch (e) {
      expect((e as AuthoringError).code).toBe('not_model3d');
    }
  }
  expect(() => turnProduct(c, 'nope', {})).toThrow(/unknown_layer/);
});
