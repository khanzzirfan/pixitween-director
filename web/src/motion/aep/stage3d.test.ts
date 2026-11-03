import { describe, expect, it } from 'vitest';
import type { AepLayer } from '@shared/aep/layer';
import type { AepCompositionJson } from '@shared/aep/composition';
import { parseMotionDoc } from '@engine/schema';
import { validateTargets } from '@engine/timeline';
import { aepToMotion } from './index';
import { convertActor, convertProp, convertWorld, mergeTweens, propLife } from './stage3d';

type AepStage3DLayer = Extract<AepLayer, { kind: 'stage3d' }>;

const BACKDROP = 'cast-cosy-toy-bedroom-at-dawn';
const assets = {
  [BACKDROP]: { type: 'image' as const, src: '/api/assets/ast_c402c34d9ec6c968718a0097b0955c52', width: 1536, height: 1024 },
};

// Copied from the stored cartoon film `live-film`, layer `wake:world`.
function world(): AepStage3DLayer {
  return {
    id: 'wake:world',
    name: 'World',
    kind: 'stage3d',
    inPoint: 0,
    outPoint: 120,
    transform: { position: [960, 540], anchor: [960, 540], scale: [1, 1], rotation: 0, opacity: 1 },
    viewport: { width: 1920, height: 1080 },
    camera: { position: [0, 1.7, 7.4], target: [0, 0.9, 0], fov: 35 },
    set: { backdrop: BACKDROP, wall: { distance: 3, height: 3.2, curve: 0.4 }, groundSize: [16, 8], ground: '#dbcebb' },
    lights: {
      preset: 'golden',
      key: { elevation: 12, intensity: [{ t: 0, v: 0 }, { t: 30, v: 2.2 }], color: '#ffd9a8' },
      fill: { intensity: 0.5 },
      rim: { intensity: 0.8 },
    },
    style: { shading: 'toon', toonSteps: 3, outline: { width: 0.012 } },
  } as unknown as AepStage3DLayer;
}

const members = [
  { id: 'wake:bed', kind: 'prop3d', stage: 'wake:world', inPoint: 0, outPoint: 120, source: { type: 'gltf', assetId: 'bed' }, size: 1 },
  { id: 'wake:pip', kind: 'actor3d', stage: 'wake:world', inPoint: 0, outPoint: 120, assetId: 'pip', marks: [0, 0, 0], clips: [{ name: 'Idle', startFrame: 0, loop: true }] },
] as unknown as AepLayer[];

type AepActor = Extract<AepLayer, { kind: 'actor3d' }>;
const actor = (over: Record<string, unknown> = {}) => ({ ...members[1], ...over }) as unknown as AepActor;
const ctx = { assets, fps: 30 };

describe('convertActor', () => {
  it('converts the stored pip actor to a glTF object with the Idle clip', () => {
    const { object, tweens, warnings } = convertActor(actor(), ctx);
    expect(object.geometry).toMatchObject({ type: 'gltf', asset: 'pip' });
    expect(object.position).toEqual([0, 0, 0]);
    expect(object.animation).toEqual({ clip: 'Idle', speed: 1, loop: true, offset: 0 });
    expect(tweens).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('tweens keyframed marks over 2 s', () => {
    const marks = [{ t: 0, v: [0, 0, 0] }, { t: 60, v: [2, 1, 90] }];
    const { tweens } = convertActor(actor({ marks }), ctx);
    const by = (p: string) => tweens.find((t) => p in t.to)!;
    expect(by('position.x')).toMatchObject({ target: 'object:wake_pip', from: { 'position.x': 0 }, to: { 'position.x': 2 } });
    expect(by('position.z').to['position.z']).toBe(1);
    expect(by('rotation.y').to['rotation.y']).toBe(90);
    for (const t of tweens) expect(t.duration).toBeCloseTo(2);
  });

  it('warns once naming the actor and the dropped clip', () => {
    const clips = [{ name: 'Idle', startFrame: 0 }, { name: 'Wave', startFrame: 30 }];
    const { warnings } = convertActor(actor({ clips }), ctx);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('wake:pip');
    expect(warnings[0]).toContain('Wave');
  });
});

describe('convertWorld', () => {
  it('converts the stored wake:world to a three layer', () => {
    const { layer } = convertWorld(world(), members, { assets, fps: 30 });
    expect(layer.type).toBe('three');
    expect([layer.width, layer.height]).toEqual([1920, 1080]);
    expect(layer.camera.position).toEqual([0, 1.7, 7.4]);
    expect(layer.camera.lookAt).toEqual([0, 0.9, 0]);
    expect(layer.camera.fov).toBe(35);
    expect(layer.lighting.preset).toBe('golden');
  });

  it('turns the finish (bloom, grade, fringe, vignette, grain) into engine effects, and keyframes the bloom', () => {
    const w = {
      ...world(),
      post: {
        bloom: { intensity: [{ t: 0, v: 0.6 }, { t: 60, v: 1.4 }], threshold: 0.5 },
        grade: { contrast: 0.1, saturation: 0.15 },
        aberration: { offset: 0.0008 },
        vignette: { darkness: 0.5 },
        grain: { opacity: 0.12 },
      },
    } as unknown as AepStage3DLayer;
    const { layer, warnings } = convertWorld(w, members, { assets, fps: 30 });
    expect((layer.effects as Array<{ id: string; type: string; params: Record<string, number> }>).map((e) => e.type)).toEqual(['bloom', 'brightnessContrast', 'hueSaturation', 'chromaticAberration', 'vignette', 'noise']);
    expect(layer.effects[0]!.params).toMatchObject({ intensity: 0.6, threshold: 0.5 });
    expect(layer.tweens.some((t) => t.target === 'effect:bloom' && 'intensity' in t.to)).toBe(true);
    expect(warnings.join(' ')).not.toMatch(/post|bloom/);
  });

  it('turns shot transitions into engine transitions in seconds on the world\'s clock', () => {
    const w = { ...world(), inPoint: 30, shotTransitions: [{ startFrame: 66, durationFrames: 12, name: 'CrossZoom', params: { strength: 0.5 } }] } as unknown as AepStage3DLayer;
    const { layer } = convertWorld(w, members, { assets, fps: 30 });
    expect((layer as unknown as { transitions: unknown[] }).transitions).toEqual([{ at: 1.2, duration: 0.4, name: 'CrossZoom', params: { strength: 0.5 } }]);
    expect((convertWorld(world(), members, { assets, fps: 30 }).layer as unknown as { transitions?: unknown }).transitions).toBeUndefined();
  });

  it('lays a glossy reflection and rippling caustics over the ground, and neither without a ground', () => {
    const w = { ...world(), set: { ...world().set, reflection: { strength: 0.4 }, caustics: { strength: 0.6 } } } as unknown as AepStage3DLayer;
    const objects = convertWorld(w, members, { assets, fps: 30 }).layer.objects;
    expect(objects.find((o) => o.id === 'mirror')?.geometry).toMatchObject({ type: 'mirror', strength: 0.4 });
    const light = objects.find((o) => o.id === 'caustics')!;
    expect(light.geometry).toEqual({ type: 'caustics', size: [16, 8], strength: 0.6, fade: 0.3, scale: 40 });
    expect(light.rotation).toEqual([-90, 0, 0]);
    const bare = { ...w, set: { ...(w as unknown as { set: object }).set, ground: 'none' } } as unknown as AepStage3DLayer;
    expect(convertWorld(bare, members, { assets, fps: 30 }).layer.objects.some((o) => o.id === 'caustics' || o.id === 'mirror')).toBe(false);
  });

  it('adds a ground plane and a backdrop plane', () => {
    const { layer } = convertWorld(world(), members, { assets, fps: 30 });
    const ground = layer.objects.find((o) => o.id === 'ground')!;
    expect(ground.geometry).toEqual({ type: 'plane', size: [16, 8] });
    expect(ground.material.color).toBe('#dbcebb');
    expect(ground.rotation).toEqual([-90, 0, 0]);
    const back = layer.objects.find((o) => o.id === 'backdrop')!;
    expect(back.material.map).toBe(BACKDROP);
    expect(back.position).toEqual([0, 1.6, -3]);
    expect(back.geometry).toMatchObject({ type: 'plane' });
    if (back.geometry.type === 'plane') expect(back.geometry.size[1]).toBe(3.2);
  });

  it('adds exactly one toon warning naming the world id', () => {
    const { warnings } = convertWorld(world(), members, { assets, fps: 30 });
    const toon = warnings.filter((w) => /toon/.test(w));
    expect(toon).toHaveLength(1);
    expect(toon[0]).toContain('wake:world');
  });

  it('falls back to studio for an unknown preset with a warning', () => {
    const w = { ...world(), lights: { preset: 'disco' } } as unknown as AepStage3DLayer;
    const { layer, warnings } = convertWorld(w, [], { assets, fps: 30 });
    expect(layer.lighting.preset).toBe('studio');
    expect(warnings.join(' ')).toMatch(/disco/);
  });

  it('removes members from the 2D list and yields a valid doc', () => {
    const comp = {
      fps: 30,
      width: 1920,
      height: 1080,
      durationInFrames: 120,
      assets: { ...assets, pip: { type: 'model' as const, src: '/pip.glb' }, bed: { type: 'model' as const, src: '/bed.glb' } },
      layers: [world(), ...members.map((m) => ({ ...m, inPoint: 0, outPoint: 120 }))],
    } as unknown as AepCompositionJson;
    const { doc, warnings } = aepToMotion(comp);
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0].type).toBe('three');
    expect(warnings.join(' ')).not.toMatch(/wake:(bed|pip)/);
    const parsed = parseMotionDoc(doc);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(validateTargets(parsed.doc)).toEqual([]);
  });
});

describe('convertProp', () => {
  const prop = (over: Record<string, unknown> = {}) =>
    ({ id: 'first-sip:counter', kind: 'prop3d', stage: 'first-sip:world', inPoint: 0, outPoint: 120, source: { type: 'gltf', assetId: 'counter' }, size: 0.6, position: [1.5, 0, 0], ...over }) as unknown as Extract<AepLayer, { kind: 'prop3d' }>;

  it('converts a liquid prop to a liquid timed to its life, sized by its box and never fitted', () => {
    const coffee = prop({ source: { type: 'liquid', form: 'crown', seed: 4 }, size: 0.35, inPoint: 30, outPoint: 75, material: { color: '#3b2314', roughness: 0.06, clearcoat: 1 } });
    const { object, warnings } = convertProp(coffee, ctx);
    expect(object!.geometry).toEqual({ type: 'liquid', form: 'crown', size: 0.35, duration: 1.5, seed: 4 });
    expect(object!.fit).toBeUndefined();
    expect(object!.material).toMatchObject({ color: '#3b2314', roughness: 0.06, clearcoat: 1 });
    expect(warnings).toEqual([]);
  });

  it('converts a counter prop to a gltf object', () => {
    const { object, warnings } = convertProp(prop(), ctx);
    // Sized like the library's stage prop: largest side = size, standing on its base.
    expect(object!.geometry).toMatchObject({ type: 'gltf', asset: 'counter' });
    expect(object!.fit).toBe(0.6);
    expect(object!.position).toEqual([1.5, 0, 0]);
    expect(warnings).toEqual([]);
  });

  it('places an attached prop near the actor with one warning', () => {
    const cup = prop({ id: 'first-sip:cold-brew', attach: { actor: 'wake:pip', bone: 'hand.R' }, position: undefined });
    const pip = actor({ marks: [1, 2, 0], height: 1 });
    const { object, warnings } = convertProp(cup, ctx, [pip]);
    expect(object!.position).toEqual([1.25, 0.9, 2]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('first-sip:cold-brew');
    expect(warnings[0]).toContain('hand.R');
  });

  it('caps a world at 50 objects with one warning', () => {
    const many = Array.from({ length: 60 }, (_, i) => prop({ id: `p${i}` })) as unknown as AepLayer[];
    const { layer, warnings } = convertWorld(world(), many, ctx);
    expect(layer.objects.length).toBeLessThanOrEqual(50);
    expect(warnings.filter((w) => /at most 50/.test(w))).toHaveLength(1);
  });

  it('sizes a packaging primitive by its height and wraps the label on a lathe body', () => {
    const can = prop({
      id: 'cine:product',
      role: 'product',
      source: { type: 'primitive', shape: 'can', proportions: { width: 1, height: 3.08 } },
      textures: { label: 'ast_label', side: '#e8e0ce' },
      size: 0.16,
      material: { roughness: 0.3, metalness: 0.6, clearcoat: 0.8 },
    });
    const { object, warnings } = convertProp(can, { assets: { ast_label: { type: 'image' as const, src: '/x', width: 2048, height: 1024 } }, fps: 30 });
    expect(object!.geometry).toEqual({ type: 'lathe', shape: 'can', width: 1, height: 3.08 });
    expect(object!.fit).toBe(0.16);
    expect(object!.material).toMatchObject({ map: 'ast_label', roughness: 0.3, metalness: 0.6, clearcoat: 0.8 });
    expect(warnings).toEqual([]);
  });

  it('keeps a member that lives to the world\'s end alive on its last frame, like a 2D layer that ends with the film', () => {
    const c = { assets: {}, fps: 30, worldInPoint: 0, worldOutPoint: 240 };
    // the engine shows an object while its time is before life.end: 240 frames must reach past 8.0 s
    expect(propLife({ inPoint: 0, outPoint: 240 }, 0, c)).toEqual({ start: 0, end: 241 / 30 });
    expect(propLife({ inPoint: 30, outPoint: 120 }, 0, c)).toEqual({ start: 1, end: 4 });
    expect(propLife({ inPoint: 0, outPoint: 240 }, 0, { assets: {}, fps: 30 })).toEqual({ start: 0, end: 8 });
  });

  it('keeps an extruded contour with its front image, side colour and a life window', () => {
    const bean = prop({
      id: 'cine:ing0-coffee-bean',
      inPoint: 12,
      outPoint: 51,
      source: { type: 'extrude', contour: [[0, 0], [10, 0], [10, 20]], depth: 6, bevel: 1 },
      textures: { front: 'ast_front', side: '#7f5d4e' },
      size: 0.025,
      swarm: { count: 30, seed: 41, motion: 'burst', emitter: { shape: 'point', center: [0, 0.08, 0] }, growFrames: 6 },
    });
    const { object, warnings } = convertProp(bean, ctx);
    expect(object!.geometry).toMatchObject({ type: 'extrude', depth: 6, bevel: 1, sideColor: '#7f5d4e' });
    expect(object!.material.map).toBe('ast_front');
    expect(object!.life).toEqual({ start: 0.4, end: 1.7 });
    expect(object!.swarm).toMatchObject({ count: 30, seed: 41, motion: 'burst', growFrames: 6, fps: 30 });
    expect(warnings).toEqual([]);
  });

  it('turns a card into an unlit, camera-facing plane with its flipbook', () => {
    const splash = prop({
      id: 'cine:ing4-brew-splash',
      source: { type: 'card', frames: ['ast_f1', 'ast_f2'], fps: 24 },
      size: 0.38,
      position: [0, 0.01, 0.06],
      lit: false,
    });
    const frames = { ast_f1: { type: 'image' as const, src: '/a', width: 543, height: 568 }, ast_f2: { type: 'image' as const, src: '/b', width: 375, height: 586 } };
    const { object } = convertProp(splash, { assets: frames, fps: 30 });
    expect(object!.geometry).toMatchObject({ type: 'plane' });
    expect(object!.billboard).toBe(true);
    expect(object!.material).toMatchObject({ unlit: true, transparent: true, map: 'ast_f1' });
    expect(object!.flipbook).toEqual({ frames: ['ast_f1', 'ast_f2'], fps: 24, loop: false });
    expect(object!.castShadow).toBe(false);
  });
});

describe('convertWorld lighting, focus and shadow', () => {
  const cine = () =>
    ({
      ...world(),
      camera: { position: [0, 0.4, 1], target: [0, 0.08, 0], fov: 14, focus: { distance: [{ t: 0, v: 1.2 }, { t: 30, v: 0.4 }], aperture: 0.3 } },
      set: { ground: 'none', wall: false },
      shadow: { opacity: 0.45, softness: 0.7 },
      style: { shading: 'pbr', exposure: 0.95 },
      lights: {
        preset: 'studio',
        key: { azimuth: [{ t: 0, v: -70 }, { t: 24, v: 45 }], elevation: 55, color: '#bcd6ff' },
        rim: { intensity: [{ t: 0, v: 0.6 }, { t: 30, v: 1.4 }] },
      },
    }) as unknown as AepStage3DLayer;

  it('applies key / rim keyframes through the lighting target, with no override warning', () => {
    const { layer, warnings } = convertWorld(cine(), [], ctx);
    expect(layer.lighting).toMatchObject({ keyAzimuth: -70, keyColor: '#bcd6ff', rimIntensity: 0.6 });
    const lighting = layer.tweens.filter((t) => t.target === 'lighting');
    expect(lighting.map((t) => Object.keys(t.to)[0]).sort()).toEqual(['keyAzimuth', 'rimIntensity']);
    expect(warnings.join(' ')).not.toMatch(/overrides|focus/);
  });

  it('keeps the rim light colour and turns the blur shots into spans in seconds', () => {
    const w = { ...cine(), lights: { ...(cine() as any).lights, rim: { color: '#22ccdd', intensity: 1 } }, post: { motionBlur: { samples: 8, shots: [{ startFrame: 30, durationFrames: 15, shutter: 0.7 }] } } } as unknown as AepStage3DLayer;
    const { layer } = convertWorld(w, [], ctx);
    expect(layer.lighting).toMatchObject({ rimColor: '#22ccdd' });
    expect((layer as any).motionBlur).toEqual({ samples: 8, spans: [{ from: 1, to: 1.5, shutter: 0.7 }] });
    expect((convertWorld(cine(), [], ctx).layer as any).motionBlur).toBeUndefined();
  });

  it('an animated aperture becomes dof tweens, and bokeh rides on the effect', () => {
    const w = { ...cine(), camera: { ...(cine() as any).camera, focus: { distance: 1.2, aperture: [{ t: 0, v: 0.2 }, { t: 30, v: 0.9 }], bokeh: 0.6 } } } as unknown as AepStage3DLayer;
    const { layer } = convertWorld(w, [], ctx);
    expect(layer.effects).toEqual([{ id: 'dof', type: 'stageDof', params: { aperture: 0.2, focusDistance: 1.2, bokeh: 0.6 } }]);
    expect(layer.tweens.filter((t) => t.target === 'effect:dof').some((t) => 'aperture' in t.to)).toBe(true);
  });

  it('turns speed-ramp spans into seconds on the layer clock', () => {
    const rates = [{ at: 0, rate: 1 }, { at: 0.5, rate: 0.2 }, { at: 1, rate: 1 }];
    const w = { ...cine(), timeWarp: [{ startFrame: 30, durationFrames: 15, rates }] } as unknown as AepStage3DLayer;
    expect((convertWorld(w, [], ctx).layer as any).timeWarp).toEqual([{ from: 1, to: 1.5, rates }]);
    expect((convertWorld(cine(), [], ctx).layer as any).timeWarp).toBeUndefined();
  });

  it('an animated camera target becomes lookAt tweens, with no warning', () => {
    const w = { ...cine(), camera: { position: [0, 0.4, 1], target: [{ t: 0, v: [0, 0.08, 0] }, { t: 10, v: [0.04, 0.12, 0] }], fov: 14 } } as unknown as AepStage3DLayer;
    const { layer, warnings } = convertWorld(w, [], ctx);
    expect(warnings.join(' ')).not.toMatch(/camera.target/);
    expect(layer.camera.lookAt).toEqual([0, 0.08, 0]);
    const look = layer.tweens.filter((t) => t.target === 'camera' && Object.keys(t.to).some((k) => k.startsWith('lookAt')));
    expect(look).toHaveLength(1);
    expect(look[0]!.to).toMatchObject({ 'lookAt.x': 0.04, 'lookAt.y': 0.12 });
  });

  it('keyframes the depth of field and keeps exposure and the stage shadow floor', () => {
    const { layer } = convertWorld(cine(), [], ctx);
    expect(layer.effects).toEqual([{ id: 'dof', type: 'stageDof', params: { aperture: 0.3, focusDistance: 1.2 } }]);
    expect(layer.tweens.some((t) => t.target === 'effect:dof' && 'focusDistance' in t.to)).toBe(true);
    expect(layer.exposure).toBe(0.95);
    expect(layer.shadow).toMatchObject({ softness: 0.7, size: [10, 8], enabled: true });
    expect(layer.camera.near).toBe(0.05);
  });
});

describe('mergeTweens', () => {
  const t = (target: string, at: number, to: Record<string, number>, ease = 'none') => ({ target, at, duration: 1, from: Object.fromEntries(Object.keys(to).map((k) => [k, 0])), to, ease, repeat: 0, yoyo: false });
  it('joins tweens that start together, last as long and ease alike on one target', () => {
    const out = mergeTweens([t('camera', 0, { 'position.x': 1 }), t('camera', 0, { fov: 40 }), t('camera', 1, { fov: 50 })]);
    expect(out).toHaveLength(2);
    expect(out[0]!.to).toEqual({ 'position.x': 1, fov: 40 });
    expect(out[0]!.from).toEqual({ 'position.x': 0, fov: 0 });
  });
  it('keeps tweens of another target, another ease or another length apart, and never merges one property twice', () => {
    expect(mergeTweens([t('camera', 0, { fov: 1 }), t('lighting', 0, { fov: 1 })])).toHaveLength(2);
    expect(mergeTweens([t('camera', 0, { a: 1 }, 'none'), t('camera', 0, { b: 1 }, 'cubic(0,0,1,1)')])).toHaveLength(2);
    expect(mergeTweens([t('camera', 0, { a: 1 }), { ...t('camera', 0, { b: 1 }), duration: 2 }])).toHaveLength(2);
    expect(mergeTweens([t('camera', 0, { a: 1 }), t('camera', 0, { a: 2 })])).toHaveLength(2);
  });
  it('does not change the tweens it is given', () => {
    const a = t('camera', 0, { x: 1 });
    mergeTweens([a, t('camera', 0, { y: 1 })]);
    expect(a.to).toEqual({ x: 1 });
  });
});
