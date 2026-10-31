import { afterEach, beforeEach, expect, it } from 'vitest';
import { addLayer, addScene, newFilmComposition, registerAsset } from '../authoring/api';
import { AuthoringError } from '../authoring/errors';
import { readDirector } from '../authoring/meta';
import type { Comp, Obj } from '../authoring/types';
import { lightValidate } from '../engine/light-validator';
import { makeTestFilm } from '../test-utils/film';
import { allTools, runTool } from '../tools/registry';
import { addStage, cueClip, moveActor, placeActor, placeProduct3D, placeProp, setLightCue } from './stage-api';

const saved = { ...process.env };
beforeEach(() => {
  process.env.CARTOON_MODE = 'true';
});
afterEach(() => {
  process.env = { ...saved };
});

function base(): Comp {
  let c: Comp = newFilmComposition({ aspect: '16:9', title: 'Pip', palette: ['#111827'] });
  for (const id of ['hero-model', 'walk-clip', 'crate']) c = registerAsset(c, { id, kind: 'model', src: `/cartoon/${id}.glb` });
  c = registerAsset(c, { id: 'backdrop', kind: 'image', src: '/cartoon/backdrop.png', width: 1024, height: 512 });
  c = addScene(c, { id: 's1', durationSec: 4, mode: 'motion' });
  c = addLayer(c, { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#f4ead5' });
  c = addLayer(c, { sceneId: 's1', role: 'headline', kind: 'text', text: 'Pip and the cold brew' });
  return c;
}
const layers = (c: Comp, id = 's1') => (((c.precomps as Record<string, Obj>)[id]!.layers) as Obj[]);
const ids = (c: Comp) => layers(c).map((l) => l.id);
// the engine's own parser cannot load in a Node test; web/src/stage-agreement.test.tsx runs the same builds through it
const engineOk = (c: Comp) => {
  const r = lightValidate(c);
  if (!r.ok) throw new Error(JSON.stringify(r.issues.slice(0, 3)));
  return true;
};

it('addStage, placeActor, cueClip builds a film the engine accepts at schema 1.11.0', () => {
  let c = addStage(base(), 's1', { backdropAssetId: 'backdrop' });
  c = placeActor(c, 's1', 'hero', 'hero-model', [-0.5, 0, 90]);
  c = cueClip(c, 's1', 'hero', { name: 'Wave' }, 30);
  c = cueClip(c, 's1', 'hero', { assetId: 'walk-clip' }, 60, { loop: true });
  expect(c.version).toBe('1.11.0');
  expect(engineOk(c)).toBe(true);
  expect(lightValidate(c).ok).toBe(true);
  const hero = layers(c).find((l) => l.id === 's1:hero')!;
  expect(hero.clips.map((k: Obj) => k.startFrame)).toEqual([0, 30, 60]);
  expect(hero.stage).toBe('s1:world');
});

it('puts the world after the background and the members after it, before the 2D title', () => {
  let c = addStage(base(), 's1');
  c = placeActor(c, 's1', 'hero', 'hero-model', [0, 0, 0]);
  c = placeProp(c, 's1', 'crate', { assetId: 'crate', position: [1, 0, 0] });
  const order = ids(c);
  expect(order.indexOf('s1:world')).toBe(1);
  expect(order.indexOf('s1:hero')).toBe(2);
  expect(order.indexOf('s1:crate')).toBe(3);
  expect(layers(c)[order.length - 1]!.kind).toBe('text');
  expect(readDirector(c).layers['s1:world']!.role).toBe('stage3d');
});

it('keeps the camera fixed and static', () => {
  const w = layers(addStage(base(), 's1')).find((l) => l.kind === 'stage3d')!;
  expect(w.camera).toEqual({ position: [0, 1.4, 6], target: [0, 0.9, 0], fov: 35 });
});

it('rejects a stage3d camera with keyframes in both validators', () => {
  const c = structuredClone(addStage(base(), 's1'));
  layers(c).find((l) => l.kind === 'stage3d')!.camera.position = [{ t: 0, v: [0, 1, 6] }, { t: 30, v: [0, 1, 4] }];
  const v = lightValidate(c);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.issues[0]!.message).toMatch(/locked/);
});

it('enforces the per-stage limits', () => {
  let c = addStage(base(), 's1');
  for (const a of ['a', 'b', 'c']) c = placeActor(c, 's1', a, 'hero-model', [0, 0, 0]);
  expect(() => placeActor(c, 's1', 'd', 'hero-model', [0, 0, 0])).toThrow(AuthoringError);
  c = placeProduct3D(c, 's1', 'can', { shape: 'can' });
  expect(() => placeProduct3D(c, 's1', 'can2', { shape: 'can' })).toThrow(/one product/);
  for (let i = 0; i < 6; i++) c = placeProp(c, 's1', `p${i}`, { shape: 'box' });
  expect(() => placeProp(c, 's1', 'p6', { shape: 'box' })).toThrow(/at most 6/);
});

it('needs a stage first, a known asset of the right type, and a known actor', () => {
  expect(() => placeActor(base(), 's1', 'hero', 'hero-model', [0, 0, 0])).toThrow(/addStage/);
  const c = addStage(base(), 's1');
  expect(() => placeActor(c, 's1', 'hero', 'nope', [0, 0, 0])).toThrow(/unknown_asset/);
  expect(() => placeActor(c, 's1', 'hero', 'backdrop', [0, 0, 0])).toThrow(/a model is needed/);
  expect(() => cueClip(c, 's1', 'ghost', { name: 'Wave' }, 10)).toThrow(/unknown_layer/);
  expect(() => placeProp(c, 's1', 'p', { shape: 'can', attach: { actor: 'ghost', bone: 'RightHand' } })).toThrow(/unknown_layer/);
});

it('keeps clips apart by the cross-fade length', () => {
  let c = placeActor(addStage(base(), 's1'), 's1', 'hero', 'hero-model', [0, 0, 0]);
  c = cueClip(c, 's1', 'hero', { name: 'Wave' }, 30);
  expect(() => cueClip(c, 's1', 'hero', { name: 'Jump' }, 33)).toThrow(/keys_too_close/);
  expect(() => cueClip(c, 's1', 'hero', { name: 'Jump' }, 400)).toThrow(/time_out_of_range/);
});

it('moveActor eases to the mark and the result still parses', () => {
  let c = placeActor(addStage(base(), 's1'), 's1', 'hero', 'hero-model', [2, 0, -90]);
  c = moveActor(c, 's1', 'hero', [0.5, 0, -90], 10, 50);
  const marks = layers(c).find((l) => l.id === 's1:hero')!.marks as Obj[];
  expect(marks.map((k) => k.t)).toEqual([0, 10, 60]);
  expect(marks[2]!.v).toEqual([0.5, 0, -90]);
  expect(engineOk(c)).toBe(true);
  expect(() => moveActor(c, 's1', 'hero', [0, 0, 0], 100, 100)).toThrow(/time_out_of_range/);
  expect(() => moveActor(c, 's1', 'hero', [9, 0, 0], 10, 10)).toThrow(/6 m/);
});

it('holds a prop in a hand and marks the product', () => {
  let c = placeActor(addStage(base(), 's1'), 's1', 'hero', 'hero-model', [0, 0, 0]);
  c = placeProduct3D(c, 's1', 'can', { shape: 'can', size: 0.18, attach: { actor: 'hero', bone: 'RightHand' } });
  const can = layers(c).find((l) => l.id === 's1:can')!;
  expect(can.role).toBe('product');
  expect(can.attach).toEqual({ actor: 's1:hero', bone: 'RightHand' });
  expect(engineOk(c)).toBe(true);
});

it("setLightCue('dawn') raises the key from 0 at the start of the scene", () => {
  const c = setLightCue(addStage(base(), 's1'), 's1', 'dawn');
  const key = layers(c).find((l) => l.kind === 'stage3d')!.lights.key;
  expect(key.intensity[0]).toEqual({ t: 0, v: 0 });
  expect(key.intensity[1].v).toBeGreaterThan(0);
  expect(engineOk(c)).toBe(true);
  for (const cue of ['studio', 'spotlight', 'night'] as const) expect(engineOk(setLightCue(addStage(base(), 's1'), 's1', cue))).toBe(true);
});

it('calling addStage again keeps the members and the light', () => {
  let c = setLightCue(placeActor(addStage(base(), 's1'), 's1', 'hero', 'hero-model', [0, 0, 0]), 's1', 'night');
  c = addStage(c, 's1', { backdropAssetId: 'backdrop' });
  expect(ids(c).filter((i) => i === 's1:world')).toHaveLength(1);
  expect(ids(c)).toContain('s1:hero');
  expect(layers(c).find((l) => l.kind === 'stage3d')!.lights.preset).toBe('night');
});

// ---- tools ----
it('lists the stage tools only while CARTOON_MODE is on', () => {
  const names = () => allTools().map((x) => x.name);
  process.env.CARTOON_MODE = 'false';
  for (const n of ['addStage', 'placeActor', 'cueClip', 'moveActor', 'placeProp', 'placeStageProduct', 'setLightCue']) expect(names()).not.toContain(n);
  process.env.CARTOON_MODE = 'true';
  for (const n of ['addStage', 'placeActor', 'cueClip', 'moveActor', 'placeProp', 'placeStageProduct', 'setLightCue']) expect(names()).toContain(n);
});

it('builds a shot through the tools, commits it, and refuses a camera move', async () => {
  const t = await makeTestFilm();
  const r0 = await t.films.commit(t.filmId, base(), 'director');
  expect(r0.ok).toBe(true);
  const run = (name: string, args: unknown) => runTool(t.ctx, name, args);
  expect((await run('addStage', { sceneId: 's1', backdropAssetId: 'backdrop' })).ok).toBe(true);
  expect((await run('placeActor', { sceneId: 's1', actorId: 'hero', assetId: 'hero-model', mark: [0, 0, 0] })).ok).toBe(true);
  expect((await run('cueClip', { sceneId: 's1', actorId: 'hero', clip: 'Wave', atSec: 1 })).ok).toBe(true);
  expect((await run('moveActor', { sceneId: 's1', actorId: 'hero', toMark: [1, 0, 30], atSec: 1.5, durationSec: 1 })).ok).toBe(true);
  expect((await run('placeStageProduct', { sceneId: 's1', shape: 'can', size: 0.2, attach: { actor: 'hero', bone: 'RightHand' } })).ok).toBe(true);
  expect((await run('setLightCue', { sceneId: 's1', cue: 'dawn' })).ok).toBe(true);
  const film = await t.films.get(t.filmId);
  expect(engineOk(film.composition as Comp)).toBe(true);
  const cam = await run('setCamera', { sceneId: 's1', move: 'dolly-in' });
  expect(cam.ok).toBe(false);
  expect((await run('setCamera', { sceneId: 's1', move: 'static' })).ok).toBe(true);
  const bad = await run('placeActor', { sceneId: 's1', actorId: 'x', assetId: 'nope', mark: [0, 0, 0] });
  expect(bad.ok).toBe(false);
});
