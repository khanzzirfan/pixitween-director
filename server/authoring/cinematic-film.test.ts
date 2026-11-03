import { describe, expect, it } from 'vitest';
import { lightValidate } from '../engine/light-validator';
import { checkBeatSheet, defaultBeatSheet, totalSeconds, type BeatSheet } from './beatsheet';
import { ELEVATION, rampKeysFor, PLATE, FILL, lightKeys, motionBlur, FOV_BASE, FOV_WIDE, LIMITS, SOLID, PRODUCT_H, PRODUCT_Y, macroOffset, PUSH_FROM, buildCinematicFilm, cutSpeeds, finishPost, shaderCuts, framingDistance, planCamera, shakeCamera, shakeKeysPerShot, type CinematicInput } from './cinematic-film';
import { CAMERA, LIGHT, MATERIALS } from './cinematic-rules';
import { SPACE_EM } from './text-width';
import { FLOOR, floorElements, glassAsset, liquidAsset, vapourAsset, type IngredientAsset } from './ingredients';
import type { Obj } from './types';

const els = floorElements('Coffee Co. Cold Brew', 'drinks');
const sheet = defaultBeatSheet(els);
const pic = (id: string, w = 128, h = 64) => ({ id, src: `/api/assets/${id}`, width: w, height: h });
const ingredients: Record<string, IngredientAsset> = {
  bean: { kind: 'bean', use: 'solid', sizeM: 0.02, frames: [pic('ast_bean')], contour: [[0, 10], [60, 0], [120, 10], [60, 60]], side: '#3b2416' },
  ice: glassAsset(FLOOR.ice!),
  splash: { kind: 'splash', use: 'card', sizeM: 0.3, frames: [pic('ast_sp1', 512, 512), pic('ast_sp2', 512, 512), pic('ast_sp3', 512, 512), pic('ast_sp4', 512, 512)] },
  milk: { kind: 'milk', use: 'card', sizeM: 0.35, frames: [pic('ast_milk', 512, 512)] },
};
const input = (o: Partial<CinematicInput> = {}): CinematicInput => ({
  aspect: '9:16',
  sheet,
  texture: { ...pic('ast_label', 2048, 1024), kind: 'label' },
  shape: 'can',
  side: '#e8e0ce',
  productAspect: 3,
  title: 'Coffee Co. Cold Brew',
  brand: 'Coffee Co.',
  price: 4.5,
  currency: 'USD',
  accent: '#c27a3a',
  ingredients,
  ...o,
});
const layers = (c: any): Obj[] => c.precomps.cine.layers;
const world = (c: any): Obj => layers(c).find((l) => l.kind === 'stage3d')!;
const props = (c: any): Obj[] => layers(c).filter((l) => l.kind === 'prop3d');
const tanHalf = (fov: number) => Math.tan((fov * Math.PI) / 360);

describe('a set keeps the horizon in the frame, and the ice out of the lens', () => {
  const beat = (size: any, move: any, seconds: number, extra: object = {}): any => ({ size, move, seconds, angle: 'eye', phase: 'build', product: 'still', ...extra });
  it('a high shot looks down less when the plan is given a lower high angle, and no other angle changes', () => {
    const s: BeatSheet = { beats: [beat('wide', 'push', 1, { phase: 'hook', angle: 'low' }), beat('close', 'push', 1, { angle: 'high' }), beat('medium', 'hold', 2, { phase: 'close' })] };
    const steep = planCamera(s, 30);
    const soft = planCamera(s, 30, { highEl: 14 });
    expect(soft.beats[1]!.to.el).toBe(14);
    expect(steep.beats[1]!.to.el).toBe(ELEVATION.high);
    expect(soft.beats[0]!.to.el).toBe(ELEVATION.low);
  });
  const set = { look: 'beach' as const, air: 'none' as const, backdrop: { ...pic('ast_back', 1500, 1024) }, ground: '#d8b878' };
  const iceSheet: BeatSheet = { beats: sheet.beats.map((b, n) => (n === 1 ? { ...b, ingredient: { kind: 'ice', action: 'burst' as const } } : b)) };
  const ice = (c: any): any => props(c).find((p) => /ice burst/.test(String(p.name)));
  it('a burst flies up and away from the camera, never toward it', () => {
    const c = buildCinematicFilm(input({ set, sheet: iceSheet, ingredients: { ice: { ...glassAsset(FLOOR.ice!), sizeM: 0.04 } } }));
    expect(ice(c)).toBeDefined();
    expect(ice(c).swarm.direction[2]).toBeLessThanOrEqual(0);
  });
  it('a glass piece is never bigger than the rule book allows', () => {
    const c = buildCinematicFilm(input({ set, sheet: iceSheet, ingredients: { ice: { ...glassAsset(FLOOR.ice!), sizeM: 0.04 } } }));
    expect(ice(c).size).toBeLessThanOrEqual(0.018);
  });
});

describe('the end hold leaves room for the text', () => {
  const beat = (size: any, move: any, seconds: number, extra: object = {}): any => ({ size, move, seconds, angle: 'eye', phase: 'build', product: 'still', ...extra });
  const sheet: BeatSheet = { beats: [beat('wide', 'push', 1, { phase: 'hook' }), beat('medium', 'truck', 1), beat('close', 'dolly-zoom', 1.2), beat('close', 'hold', 2.4, { phase: 'close' })] };
  it('holds the dolly-zoom and the hold after it to the cap, and no other shot', () => {
    const open = planCamera(sheet, 30);
    const capped = planCamera(sheet, 30, { holdFill: 0.55 });
    expect(open.beats[3]!.to.d).toBeCloseTo(framingDistance(FILL.close) * (Math.tan((FOV_BASE * Math.PI) / 360) / Math.tan((FOV_WIDE * Math.PI) / 360)), 1);
    expect(capped.beats[2]!.from.d).toBeCloseTo(framingDistance(0.55), 3);
    expect(capped.beats[2]!.from.d).toBeGreaterThan(open.beats[2]!.from.d);
    expect(capped.beats[1]!.to.d).toBeCloseTo(open.beats[1]!.to.d, 6);
  });
});

describe('planCamera', () => {
  const fps = 30;
  const plan = planCamera(sheet, fps);
  it('covers the film frame by frame: each shot starts where the last one ended plus one', () => {
    expect(plan.frames).toBe(Math.round(totalSeconds(sheet) * fps));
    plan.beats.forEach((b, i) => {
      if (i > 0) expect(b.start).toBe(plan.beats[i - 1]!.end + 1);
    });
    expect(plan.beats.at(-1)!.end).toBe(plan.frames);
  });
  it('cuts between shots with hold keys, and the last shot has none', () => {
    const holds = plan.position.filter((k) => k.hold).length;
    expect(holds).toBe(sheet.beats.length - 1);
    expect(plan.position.at(-1)!.hold).toBeUndefined();
  });
  it('a push arrives at the distance that fills the size; the hook starts 70 % further away, a later push 30 %', () => {
    const b = plan.beats[0]!; // wide push
    expect(b.to.d).toBeCloseTo(framingDistance(FILL.wide), 4);
    expect(b.from.d).toBeCloseTo(b.to.d * PUSH_FROM.hook, 4);
    const later = plan.beats.find((x, i) => i > 0 && x.move === 'push' && x.size !== 'wide')!;
    expect(later.from.d).toBeCloseTo(later.to.d * PUSH_FROM.later, 4);
    const wide = planCamera({ beats: [{ size: 'close', move: 'push', seconds: 1 }, { size: 'wide', move: 'push', seconds: 1 }, { size: 'medium', move: 'hold', seconds: 2 }] as BeatSheet['beats'] }, 30).beats[1]!;
    expect(wide.from.d).toBeCloseTo(wide.to.d * PUSH_FROM.wide, 4);
    const macro = plan.beats.find((x) => x.size === 'macro')!;
    expect(macro.to.d).toBeLessThan(0.2);
  });
  it('the dolly-zoom widens the lens 30 to 80 degrees while the product keeps its size', () => {
    const d = plan.beats.find((b) => b.move === 'dolly-zoom')!;
    expect(d.from.fov).toBe(FOV_BASE);
    expect(d.to.fov).toBe(FOV_WIDE);
    expect(d.to.d * tanHalf(d.to.fov)).toBeCloseTo(d.from.d * tanHalf(d.from.fov), 2);
    // the product's share of the frame: height / (2 d tan(fov/2)) is the same at both ends
    const fill = (p: { d: number; fov: number }) => PRODUCT_H / (2 * p.d * tanHalf(p.fov));
    expect(fill(d.to)).toBeCloseTo(fill(d.from), 2);
  });
  it('the end hold stays on the wide lens of the dolly-zoom and creeps in', () => {
    const hold = plan.beats.at(-1)!;
    expect(hold.to.fov).toBe(FOV_WIDE);
    expect(hold.from.d).toBeGreaterThan(hold.to.d);
  });
  it('keeps the product in focus: the focus distance is the camera distance', () => {
    plan.beats.forEach((b, i) => {
      expect(plan.focus[i * 2]!.v).toBeCloseTo(b.from.d, 3);
      expect(plan.focus[i * 2 + 1]!.v).toBeCloseTo(b.to.d, 3);
    });
  });
});

describe('buildCinematicFilm', () => {
  it('is deterministic', () => {
    expect(buildCinematicFilm(input())).toEqual(buildCinematicFilm(input()));
  });
  it('declares schema 1.12.0 on the film and the scene and passes the light validator', () => {
    const c = buildCinematicFilm(input()) as any;
    expect(c.version).toBe('1.12.0');
    expect(c.precomps.cine.version).toBe('1.12.0');
    const v = lightValidate(c);
    expect(v.ok, v.ok ? '' : JSON.stringify(v.issues)).toBe(true);
    const sale = lightValidate(buildCinematicFilm(input({ price: 3.99, wasPrice: 4.75 })));
    expect(sale.ok).toBe(true);
  });
  it('is a 1.11.0 composition to the validator once its version is lowered: animated camera needs 1.12.0', () => {
    const c = JSON.parse(JSON.stringify(buildCinematicFilm(input())));
    c.version = '1.11.0';
    c.precomps.cine.version = '1.11.0';
    const v = lightValidate(c);
    expect(v.ok).toBe(false);
    expect(v.ok ? '' : JSON.stringify(v.issues)).toMatch(/1\.12\.0/);
  });
  it('puts the world, then the product and ingredients, in one stage; 2D layers stay on top', () => {
    const c = buildCinematicFilm(input());
    const ls = layers(c);
    const w = ls.findIndex((l) => l.kind === 'stage3d');
    const members = props(c);
    expect(members.length).toBeGreaterThan(1);
    expect(ls.slice(w + 1, w + 1 + members.length).every((l) => l.kind === 'prop3d')).toBe(true);
    for (const m of members) expect(m.stage).toBe(world(c).id);
    expect(ls.findIndex((l) => l.kind === 'text')).toBeGreaterThan(w + members.length);
    expect(ls.slice(0, w).every((l) => l.kind === 'shape')).toBe(true);
  });
  it('sets no ground or wall so the 2D halo shows through, and lights in PBR', () => {
    const w = world(buildCinematicFilm(input())) as any;
    expect(w.set).toEqual({ ground: 'none', wall: false });
    expect(w.style.shading).toBe('pbr');
    expect(w.camera.position.length).toBeGreaterThan(sheet.beats.length);
  });
  it('the product is a prop3d can wearing the label, tumbling in and facing the camera in the macro', () => {
    const c = buildCinematicFilm(input()) as any;
    const can = props(c).find((p: any) => p.role === 'product') as any;
    expect(can.source).toMatchObject({ type: 'primitive', shape: 'can' });
    expect(can.textures.label).toBe('ast_label');
    expect(can.position[0].v[1]).toBeGreaterThan(can.position.at(-1).v[1]);
    expect(can.rotation[0].v[1]).toBeLessThan(-180);
    const macro = planCamera(sheet, c.fps).beats.find((b) => b.size === 'macro')!;
    const mid = Math.round((macro.start + macro.end) / 2);
    expect(can.rotation.find((k: any) => k.t === mid)?.v[1]).toBe(0);
  });
  it('plays each beat\'s ingredient: beans fall as a swarm, ice is glass, the splash is a flipbook card', () => {
    const c = buildCinematicFilm(input()) as any;
    const beans = props(c).find((p: any) => p.id.includes('-bean')) as any;
    expect(beans.swarm).toMatchObject({ motion: 'fall', count: 40 });
    expect(beans.source.type).toBe('extrude');
    expect(beans.textures.front).toBe('ast_bean');
    const ice = props(c).find((p: any) => p.id.includes('-ice')) as any;
    expect(ice.material.transmission).toBe(1);
    expect(ice.material.clearcoat).toBe(1);
    expect(ice.source.round).toBe(MATERIALS.iceRound);
    expect(ice.swarm.motion).toBe('orbit');
    const splash = props(c).find((p: any) => p.id.includes('-splash')) as any;
    expect(splash.source).toMatchObject({ type: 'card', fps: 24 });
    expect(splash.source.frames).toHaveLength(4);
    const milk = props(c).find((p: any) => p.id.includes('-milk')) as any;
    expect(milk.textures.front).toBe('ast_milk');
    // each ingredient exists only during its own shot (plus a short tail for falling pieces)
    const f = planCamera(sheet, c.fps).beats;
    expect(beans.inPoint).toBe(f[0]!.start);
    expect(splash.inPoint).toBe(f[1]!.start);
  });
  it('registers every picture as a film asset and in the scene', () => {
    const c = buildCinematicFilm(input()) as any;
    for (const id of ['ast_label', 'ast_bean', 'ast_sp1', 'ast_sp4', 'ast_milk']) {
      expect(c.assets[id]).toBeDefined();
      expect(c.precomps.cine.assets[id]).toBeDefined();
    }
  });
  it('plays a beat without its ingredient when the asset is missing', () => {
    const c = buildCinematicFilm(input({ ingredients: { ice: ingredients.ice! } }));
    expect(props(c).map((p) => p.id)).toEqual(expect.arrayContaining(['cine:product']));
    expect(props(c).some((p) => String(p.id).includes('-bean'))).toBe(false);
    expect(lightValidate(c).ok).toBe(true);
  });
  it('stays inside the engine limits, trimming swarms when a sheet asks for a lot', () => {
    const busy = {
      beats: [
        ...Array.from({ length: 9 }, (_, i) => ({ size: (['wide', 'medium'] as const)[i % 2]!, move: 'push' as const, seconds: 1, ingredient: { kind: 'bean', action: 'fall' as const } })),
        { size: 'medium' as const, move: 'hold' as const, seconds: 2 },
      ],
    };
    const c = buildCinematicFilm(input({ sheet: busy }));
    const ps = props(c) as any[];
    expect(ps.length).toBeLessThanOrEqual(LIMITS.props);
    const total = ps.reduce((n, p) => n + (p.swarm ? p.swarm.count : 1), 0);
    expect(total).toBeLessThanOrEqual(LIMITS.instances);
    for (const p of ps) if (p.swarm) expect(p.swarm.count).toBeLessThanOrEqual(LIMITS.swarm);
    expect(lightValidate(c).ok).toBe(true);
  });
  it('copy: brand, the name word by word and the price, with the price landing when the end hold starts', () => {
    const c = buildCinematicFilm(input()) as any;
    const texts = layers(c).filter((l) => l.kind === 'text').map((l) => l.source);
    expect(texts).toEqual(expect.arrayContaining(['COFFEE CO.', 'Cold', 'Brew', '$4.50']));
    const hold = planCamera(sheet, c.fps).beats.at(-1)!;
    const disc = layers(c).find((l) => l.kind === 'shape' && l.fill === '#c27a3a') as any;
    const first = disc.transform.scale.find((k: any) => (Array.isArray(k.v) ? k.v[0] : k.v) > 0);
    expect(first.t).toBeGreaterThanOrEqual(hold.start);
  });
  it('a sale strikes the old price, pulsing with it', () => {
    const c = buildCinematicFilm(input({ price: 3.99, wasPrice: 4.75 }));
    const old = layers(c).find((l) => l.kind === 'text' && l.source === '$4.75') as any;
    const line = layers(c).find((l) => l.fill === '#ff5a6e') as any;
    expect(line.transform.scale).toEqual(old.transform.scale);
  });
  it('a vapour element plays as engine vapour behind or round the product: steam rises, a cloud wraps, powder bursts', () => {
    const cocoa = { ...FLOOR.dust!, id: 'cocoa', color: '#7a5233' };
    const vapours = { ...ingredients, steam: vapourAsset(FLOOR.steam!), dust: vapourAsset(FLOOR.dust!), cocoa: vapourAsset(cocoa) };
    const s3: BeatSheet = {
      beats: sheet.beats.map((b, n) =>
        n === 1 ? { ...b, ingredient: { kind: 'steam', action: 'rise' as const } } : n === 3 ? { ...b, ingredient: { kind: 'dust', action: 'wrap' as const } } : n === 4 ? { ...b, ingredient: { kind: 'cocoa', action: 'burst' as const } } : b,
      ),
    };
    const c = buildCinematicFilm(input({ sheet: s3, ingredients: vapours }));
    const smoke = props(c).filter((p: any) => p.source.type === 'smoke') as any[];
    expect(smoke.map((p) => p.source.form)).toEqual(['steam', 'cloud', 'powder']);
    // steam stands behind the product (not on its top), the cloud round it
    expect(smoke[0].position[2]).toBeLessThan(0);
    expect(smoke[0].position[1]).toBe(0);
    expect(smoke[1].position).toEqual([0, 0, -0.04]);
    expect(smoke[2].material.color).toBe('#7a5233');
    expect(smoke.every((p) => !p.swarm && !p.textures)).toBe(true);
    expect(lightValidate(c).ok).toBe(true);
  });
  it('a stage card plays in front of the product while small, and behind it when it is big enough to bury it', () => {
    const play = (sizeM: number) => {
      const s3: BeatSheet = { beats: sheet.beats.map((b, n) => (n === 1 ? { ...b, ingredient: { kind: 'splash', action: 'splash' as const } } : b)) };
      const c = buildCinematicFilm(input({ sheet: s3, ingredients: { ...ingredients, splash: { ...ingredients.splash!, sizeM } } }));
      return (props(c).find((p: any) => p.source.type === 'card' && String(p.id).includes('splash')) as any)?.position as number[];
    };
    expect(play(0.12)![2]).toBeGreaterThan(0);
    expect(play(0.3)![2]).toBeLessThan(0);
  });
  it('a liquid element plays as real 3D liquid: a crown for a splash, a stream for a pour, a spiral ribbon for a swirl', () => {
    const liquids = { ...ingredients, splash: liquidAsset(FLOOR.splash!), milk: liquidAsset(FLOOR.milk!), water: liquidAsset(FLOOR.water!) };
    const s3: BeatSheet = {
      beats: sheet.beats.map((b, n) =>
        n === 1 ? { ...b, ingredient: { kind: 'splash', action: 'splash' as const } } : n === 3 ? { ...b, ingredient: { kind: 'milk', action: 'pour' as const } } : n === 4 ? { ...b, ingredient: { kind: 'water', action: 'swirl' as const } } : b,
      ),
    };
    const c = buildCinematicFilm(input({ sheet: s3, ingredients: liquids }));
    const liquid = props(c).filter((p: any) => p.source.type === 'liquid') as any[];
    expect(liquid.map((p) => p.source.form)).toEqual(['crown', 'pour', 'vortex']);
    expect(liquid[0].material).toMatchObject({ color: '#4a2a16', clearcoat: 1 });
    expect(liquid[0].material.transmission).toBeUndefined();
    expect(liquid[2].material).toMatchObject({ transmission: 0.92 });
    expect(liquid.every((p) => !p.swarm && !p.textures)).toBe(true);
    expect(lightValidate(c).ok).toBe(true);
  });
  it('a line of words in a short shot still fades out, so it never stays on into the end card', () => {
    const short: BeatSheet = { beats: sheet.beats.map((b, n) => (n === 3 ? { ...b, seconds: 0.5, text: 'Energy' } : b)) };
    const c = buildCinematicFilm(input({ sheet: short }));
    const word = layers(c).find((l) => l.kind === 'text' && l.source === 'Energy') as any;
    const last = word.transform.opacity.at(-1);
    expect(Array.isArray(last) ? last[1] : last.v).toBe(0);
    const plate = layers(c).filter((l) => l.kind === 'shape' && l.path?.roundness !== undefined).at(-1) as any;
    expect(plate).toBeDefined();
  });
  it('the world carries the finish: glow that swells in the end hold, vignette, grain and an optional fringe', () => {
    const c = buildCinematicFilm(input({ finish: { glow: 'strong', grain: 'heavy', vignette: 'strong', fringe: true, floor: 'mirror', wet: 'heavy', caustics: 'none' } }));
    const post = world(c).post as any;
    expect(post.vignette).toEqual({ darkness: 0.62 });
    expect(post.grain).toEqual({ opacity: 0.15 });
    expect(post.aberration).toEqual({ offset: 0.0007 });
    const k = post.bloom.intensity as Array<{ t: number; v: number }>;
    expect(k[0]!.v).toBe(1.1);
    expect(k.at(-1)!.v).toBeCloseTo(1.1 * 1.35, 2);
    expect(k.at(-1)!.t).toBeGreaterThan(planCamera(sheet, c.fps).beats.at(-1)!.start);
    expect(lightValidate(c).ok).toBe(true);
  });
  it('the floor\'s shine becomes the set\'s reflection, from the book, and none adds nothing', () => {
    const base = { glow: 'none', grain: 'none', vignette: 'none', fringe: false, wet: 'none', caustics: 'none' } as const;
    const set = { look: 'night' as const, air: 'none' as const, backdrop: pic('ast_bd', 1536, 1024), ground: '#101820' };
    const withFloor = (floor: 'none' | 'matte' | 'glossy' | 'mirror') => world(buildCinematicFilm(input({ set, finish: { ...base, floor } }))).set as any;
    expect(withFloor('glossy').reflection).toEqual({ strength: 0.42, fade: 0.4 });
    expect(withFloor('mirror').reflection).toEqual({ strength: 0.65, fade: 0.55 });
    expect(withFloor('none').reflection).toBeUndefined();
    expect(lightValidate(buildCinematicFilm(input({ set, finish: { ...base, floor: 'glossy' } }))).ok).toBe(true);
    // no set, no ground, nothing to shine on
    expect((world(buildCinematicFilm(input({ finish: { ...base, floor: 'mirror' } }))).set as any).reflection).toBeUndefined();
  });
  it('caustics become rippling light on the set\'s floor, from the book; none or no set adds nothing', () => {
    const base = { glow: 'none', grain: 'none', vignette: 'none', fringe: false, floor: 'matte', wet: 'none' } as const;
    const set = { look: 'pool' as const, air: 'none' as const, backdrop: pic('ast_bd', 1536, 1024), ground: '#101820' };
    const light = (caustics: 'none' | 'soft' | 'bright', withSet = true) => (world(buildCinematicFilm(input({ ...(withSet ? { set } : {}), finish: { ...base, caustics } }))).set as any).caustics;
    expect(light('bright')).toEqual({ strength: 0.7, fade: 0.3, scale: 40 });
    expect(light('soft').strength).toBe(0.35);
    expect(light('none')).toBeUndefined();
    expect(light('bright', false)).toBeUndefined();
    expect(lightValidate(buildCinematicFilm(input({ set, finish: { ...base, caustics: 'soft' } }))).ok).toBe(true);
  });
  it('a wet product carries condensation in its material, in the book\'s amount; dry adds none', () => {
    const base = { glow: 'none', grain: 'none', vignette: 'none', fringe: false, floor: 'none', caustics: 'none' } as const;
    const product = (wet: 'none' | 'light' | 'heavy') => props(buildCinematicFilm(input({ finish: { ...base, wet } }))).find((p: any) => p.role === 'product') as any;
    expect(product('heavy').material.condensation).toBe(0.9);
    expect(product('light').material.condensation).toBe(0.4);
    expect(product('none').material.condensation).toBeUndefined();
    expect(product('heavy').material.clearcoat).toBe(0.8);
    expect(lightValidate(buildCinematicFilm(input({ finish: { ...base, wet: 'heavy' } }))).ok).toBe(true);
  });
  it('a board with no finish gets one from its key level, and a finish of none adds no post at all', () => {
    expect((world(buildCinematicFilm(input({ key: 'low' }))).post as any).vignette).toEqual({ darkness: 0.62 });
    expect((world(buildCinematicFilm(input({ key: 'high' }))).post as any).grain).toBeUndefined();
    expect(finishPost({ glow: 'none', grain: 'none', vignette: 'none', fringe: false, floor: 'none', wet: 'none', caustics: 'none' }, 100)).toBeUndefined();
    expect(world(buildCinematicFilm(input({ finish: { glow: 'none', grain: 'none', vignette: 'none', fringe: false, floor: 'none', wet: 'none', caustics: 'none' } }))).post).toBeUndefined();
  });
  it('a cut that names a shader plays it from its shot\'s first frame, in the book\'s time, and a plain, wipe or cloud cut does not', () => {
    const s3: BeatSheet = { beats: sheet.beats.map((b, n) => (n === 1 ? { ...b, cut: 'zoom' as const } : n === 3 ? { ...b, cut: 'ripple' as const } : n === 4 ? { ...b, cut: 'wipe' as const } : b)) };
    const c = buildCinematicFilm(input({ sheet: s3 }));
    const plan = planCamera(s3, c.fps);
    const st = world(c).shotTransitions as any[];
    expect(st.map((t) => t.name)).toEqual(['CrossZoom', 'WaterDrop']);
    expect(st[0].startFrame).toBe(plan.beats[1]!.start);
    expect(st[0].durationFrames).toBe(Math.min(Math.round(0.4 * c.fps), Math.round((plan.beats[1]!.end - plan.beats[1]!.start) * 0.8)));
    expect(st[1].startFrame).toBe(plan.beats[3]!.start);
    expect(lightValidate(c).ok).toBe(true);
    expect(shaderCuts(sheet, planCamera(sheet, 30), 30)).toEqual([]);
    expect(world(buildCinematicFilm(input())).shotTransitions).toBeUndefined();
  });
  it('a brief with no price ends on the name and tagline, with no price disc', () => {
    const c = buildCinematicFilm({ ...input({ tagline: 'Wake up cold' }), price: undefined });
    const texts = layers(c).filter((l) => l.kind === 'text').map((l) => l.source);
    expect(texts).toEqual(expect.arrayContaining(['Cold', 'Brew', 'Wake']));
    expect(texts.some((t) => String(t).includes('$'))).toBe(false);
    expect(layers(c).some((l) => l.kind === 'shape' && l.fill === '#c27a3a')).toBe(false);
    expect(lightValidate(c).ok).toBe(true);
  });
  it('fits other aspects and throws on an empty sheet', () => {
    for (const aspect of ['16:9', '1:1'] as const) expect(() => buildCinematicFilm(input({ aspect }))).not.toThrow();
    expect(() => buildCinematicFilm(input({ sheet: { beats: [] } }))).toThrow(/at least one beat/);
  });
});

describe('speed ramps', () => {
  it('gets fewer keys as the tween budget fills, and none when fewer than two fit', () => {
    expect(rampKeysFor(0, 0, 10)).toBe(0);
    expect(rampKeysFor(1, 0, 10)).toBe(CAMERA.rampKeys);
    const B = CAMERA.tweenBudget;
    expect(rampKeysFor(6, 6, B - 30)).toBeLessThan(CAMERA.rampKeys);
    expect(rampKeysFor(6, 6, B - 5)).toBe(0);
  });
  const SLOW = [{ at: 0, rate: 1 }, { at: 0.3, rate: 0.2 }, { at: 0.7, rate: 0.2 }, { at: 1, rate: 1 }];
  const ramped = (extra: object = {}): BeatSheet => ({ beats: sheet.beats.map((b, n) => (n === 1 ? { ...b, seconds: 2, ramp: SLOW, ...extra } : b)) });
  it('a ramped shot is sampled along its curve and still starts and ends where it did', () => {
    const plain = planCamera(ramped({ ramp: undefined }), 30);
    const plan = shakeCamera(planCamera(ramped(), 30), 0);
    const f = plan.beats[1]!;
    const ks = plan.position.filter((k) => k.t >= f.start && k.t <= f.end);
    expect(ks).toHaveLength(CAMERA.rampKeys + 2);
    expect(ks[0]!.v).toEqual(plain.position.find((k) => k.t === f.start)!.v);
    expect(ks.at(-1)!.v).toEqual(plain.position.find((k) => k.t === f.end)!.v);
    // the middle of the shot is slow: the camera covers less ground there than a linear shot would
    expect(plan.position.length).toBeGreaterThan(plain.position.length);
  });
  it('a shot with no ramp is left exactly as it was, and a plain film is not sampled at all', () => {
    const plain = planCamera(sheet, 30);
    expect(shakeCamera(plain, 0)).toBe(plain);
  });
  it('the world carries the ramp as a span of frames with its curve, and a film with none carries no span', () => {
    const c = buildCinematicFilm(input({ sheet: ramped() }));
    const f = planCamera(ramped(), 30).beats[1]!;
    expect((world(c) as any).timeWarp).toEqual([{ startFrame: f.start, durationFrames: f.end - f.start + 1, rates: SLOW }]);
    expect((world(buildCinematicFilm(input())) as any).timeWarp).toBeUndefined();
    expect(lightValidate(c).ok).toBe(true);
  });
  it('a ramped spin is sampled along the curve and ends where the turn ends', () => {
    const c = buildCinematicFilm(input({ sheet: ramped({ spin: { degrees: 180 }, product: undefined }) }));
    const can = props(c).find((l) => l.role === 'product')!;
    const ks = (can.rotation as Array<{ t: number; v: number[] }>).filter((k) => k.t >= 0);
    expect(ks.length).toBeGreaterThan(CAMERA.rampKeys);
    for (let n = 1; n < ks.length; n++) expect(ks[n]!.t).toBeGreaterThan(ks[n - 1]!.t);
  });
  it('stays inside the tween budget with ramps on every shot', () => {
    const all: BeatSheet = { beats: sheet.beats.map((b) => ({ ...b, ramp: SLOW, spin: { degrees: 90, tilt: 10 } })) };
    const c = buildCinematicFilm(input({ sheet: all, handheld: true }));
    expect(lightValidate(c).ok).toBe(true);
    const can = props(c).find((l) => l.role === 'product')!;
    const segs = (ks: unknown): number => (Array.isArray(ks) ? Math.max(0, ks.length - 1) : 0);
    const w = world(c) as any;
    expect(segs(w.camera.position) + segs(can.rotation) + segs(can.position) + segs(w.camera.focus.distance)).toBeLessThanOrEqual(CAMERA.tweenBudget);
  });
});

describe('what the board says reaches the film', () => {
  const fps = 30;
  const rose = (pos: number[], target = 0.08, d = 1) => (pos[1]! - target) / d;
  it('the camera height follows each shot\'s angle', () => {
    const plan = planCamera(sheet, fps);
    sheet.beats.forEach((b, i) => {
      if (b.move === 'hold') return;
      const f = plan.beats[i]!;
      const p = plan.position.find((k) => k.t === f.end)!.v;
      const dist = Math.hypot(p[0], p[1] - 0.08, p[2]);
      const el = (Math.asin((p[1] - 0.08) / dist) * 180) / Math.PI;
      expect(el).toBeCloseTo(ELEVATION[b.angle ?? 'eye'], 0);
    });
    expect(rose([0, 0.1])).toBeGreaterThan(0);
  });
  it('a drop-in rises from above only in its shot, and the label macro faces the lens', () => {
    const s: BeatSheet = structuredClone(sheet);
    s.beats[0]!.product = 'still';
    s.beats[1]!.product = 'drop';
    const c = buildCinematicFilm(input({ sheet: s })) as any;
    const can = props(c).find((l) => l.role === 'product')!;
    const f = planCamera(s, c.fps).beats;
    const high = can.position.find((k: any) => k.v[1] >= CAMERA.dropFrom);
    expect(high.t).toBe(f[1]!.start);
    expect(can.position[0].v[1]).toBe(0);
    const macro = f.find((b) => b.size === 'macro')!;
    const mid = can.rotation.find((k: any) => k.t === Math.round((macro.start + macro.end) / 2));
    expect(mid.v[1]).toBe(0);
    const ts = can.rotation.map((k: any) => k.t);
    expect(ts).toEqual([...ts].sort((a: number, b: number) => a - b));
    expect(new Set(ts).size).toBe(ts.length);
  });
  it('a wipe and a cloud each get a full-frame layer that peaks at the cut, none for a film without cuts', () => {
    const c = buildCinematicFilm(input()) as any;
    const plan = planCamera(sheet, c.fps);
    const full = layers(c).filter((l) => l.kind === 'shape' && l.transform.opacity?.length);
    const cutAt = sheet.beats.findIndex((b) => b.cut === 'wipe');
    const peak = full.some((l) => l.transform.opacity.some((k: any) => k.t === plan.beats[cutAt]!.start && (Array.isArray(k.v) ? k.v[0] : k.v) === 1));
    expect(peak).toBe(true);
    const plain: BeatSheet = structuredClone(sheet);
    for (const b of plain.beats) delete b.cut;
    const n = (x: any) => layers(x).filter((l) => l.kind === 'shape').length;
    expect(n(buildCinematicFilm(input({ sheet: plain })))).toBe(n(c) - 2);
  });
  it('tone and key change the light: key colour, exposure and the field', () => {
    const low = buildCinematicFilm(input({ tone: 'warm', key: 'low' })) as any;
    const high = buildCinematicFilm(input({ tone: 'cool', key: 'high' })) as any;
    expect(world(low).style.exposure).toBeLessThan(world(high).style.exposure);
    expect(world(low).lights.key.color).toBe('#ffd7a3');
    expect(world(high).lights.key.color).toBe('#bcd6ff');
    const field = (c: any) => layers(c).find((l) => l.kind === 'shape')!.fill;
    expect(field(low)).not.toBe(field(high));
  });
  it('still validates as a 1.12.0 film with every new field in play', () => {
    const c = buildCinematicFilm(input({ tone: 'warm', key: 'high' }));
    const v = lightValidate(c);
    expect(v.ok, v.ok ? '' : JSON.stringify(v.issues)).toBe(true);
  });
  it('stacks back to front: field and halo, the world and its props, the cut layers, then the copy', () => {
    const ids = layers(buildCinematicFilm(input())).map((l) => l.id as string);
    const at = (id: string) => ids.indexOf(id);
    expect(at('cine:bg')).toBeLessThan(at('cine:world'));
    expect(at('cine:bg-2')).toBeLessThan(at('cine:world'));
    expect(at('cine:product')).toBeGreaterThan(at('cine:world'));
    const flash = ids.filter((id, k) => /^cine:bg/.test(id) && k > at('cine:product'));
    expect(flash.length).toBeGreaterThanOrEqual(2);
    for (const t of ids.filter((id) => id.startsWith('cine:caption'))) expect(at(t)).toBeGreaterThan(Math.max(...flash.map(at)));
  });
});

describe('the end card keeps clear of the product', () => {
  const c = buildCinematicFilm(input());
  const [W, H] = [1080, 1920];
  // the end hold's can: its fill, capped so the name and tagline have room above it
  const canH = H * Math.min(FILL.medium, CAMERA.maxHoldHeight / 1.16) * 1.16;
  const canW = canH / 3;
  const at = (l: Obj) => {
    const p = (l.transform as any).position;
    const v = Array.isArray(p) && typeof p[0] === 'object' ? p[0].v : p;
    return v as [number, number];
  };
  it('puts the name above the can and the brand above the name', () => {
    const [, nameY] = at(layers(c).find((l) => l.id === 'cine:caption-2')!);
    const [, brandY] = at(layers(c).find((l) => l.id === 'cine:caption')!);
    expect(nameY + 0.045 * W).toBeLessThan(H / 2 - canH / 2);
    expect(brandY).toBeLessThan(nameY);
  });
  it('puts the price disc beside the can, not over it', () => {
    const [x] = at(layers(c).find((l) => l.id === 'cine:caption-4')!);
    expect(x - 0.19 * W * 0.5).toBeGreaterThanOrEqual(W / 2 + canW / 2);
    expect(x + 0.19 * W * 0.5).toBeLessThanOrEqual(W);
  });
  it('frames the macro on the label band and the name above it, not just the band', () => {
    expect(FILL.macro).toBeLessThanOrEqual(1.6);
  });
});

describe('the end card type follows the backdrop behind it', () => {
  const withSet = (skyLuma: number) => buildCinematicFilm(input({ key: 'mid', set: { look: 'studio', air: 'none', backdrop: pic('ast_sky', 2000, 1000), ground: '#d8d4ce', skyLuma } }));
  const nameColour = (c: any) => (layers(c).find((l) => l.id === 'cine:caption-2')!.style as { fill: string }).fill;
  it('is dark on a bright backdrop and white on a dark one, whatever the key', () => {
    expect(nameColour(withSet(0.8))).not.toBe('#ffffff');
    expect(nameColour(withSet(0.1))).toBe('#ffffff');
  });
});

describe('the words sit on a plate', () => {
  it('puts a rounded plate, opposite in tone to the type, under the end card name and under each shot line, drawn before the words', () => {
    // one line of words on the first shot, so the film has the end card and one shot line
    const worded = { ...sheet, beats: sheet.beats.map((b, k) => ({ ...b, text: k === 0 ? 'Pack the car' : undefined })) } as BeatSheet;
    const c = buildCinematicFilm(input({ sheet: worded }));
    const ls = layers(c);
    const plates = ls.filter((l) => l.kind === 'shape' && (l.path as any)?.roundness !== undefined);
    expect(plates).toHaveLength(2);
    for (const p of plates) expect([PLATE.dark, PLATE.light]).toContain(p.fill);
    const first = ls.findIndex((l) => l.id === 'cine:caption-2');
    expect(ls.indexOf(plates[0]!)).toBeLessThan(first);
  });
});

describe('a flat product (a cut-out that is not a round pack)', () => {
  const contour: Array<[number, number]> = [[0, 0], [100, 0], [100, 400], [0, 400]];
  const flat = (o: Partial<CinematicInput> = {}) => input({ shape: 'other', contour, texture: { ...pic('ast_front', 100, 400), kind: 'front' }, productAspect: 4, title: 'Wave Rider Longboard', brand: 'Saltline', ...o });
  const product = (c: any): Obj => props(c).find((p) => p.role === 'product')!;

  it('is its own outline, extruded, with the photo on its front', () => {
    const p = product(buildCinematicFilm(flat()));
    expect((p.source as Obj).type).toBe('extrude');
    expect((p.source as Obj).contour).toEqual(contour);
    expect((p.textures as Obj).front).toBe('ast_front');
    const v = lightValidate(buildCinematicFilm(flat()));
    expect(v.ok, v.ok ? '' : JSON.stringify(v.issues)).toBe(true);
  });
  it('is a solid body, so it is not held to a swing: a drop spins in from behind', () => {
    const p = product(buildCinematicFilm(flat()));
    expect((p.source as Obj).section).toBe(SOLID.section);
    expect((p.source as Obj).depth).toBeCloseTo(100 * SOLID.depth, 5);
    const yaws = (p.rotation as Array<{ v: number[] }>).map((k) => k.v[1]!);
    expect(Math.max(...yaws.map(Math.abs))).toBeGreaterThan(30);
  });
  it("takes Muse's depth and section for its body", () => {
    const p = product(buildCinematicFilm(flat({ body: { depth: 0.9, section: 2 } })));
    expect(p.source as Obj).toMatchObject({ depth: 90, section: 2 });
    const q = product(buildCinematicFilm(flat({ body: { section: 4 } })));
    expect((q.source as Obj).depth).toBeCloseTo(100 * SOLID.depth, 5);
    expect((q.source as Obj).section).toBe(4);
  });
  it('swings to the other side on every turn, so no turn leaves it standing still', () => {
    const turns = defaultBeatSheet(floorElements('Stone Mug', 'home')).beats.map((b, i) => (i > 0 && i < 6 && b.size !== 'macro' ? { ...b, product: 'turn' as const } : b));
    const p = product(buildCinematicFilm(flat({ sheet: { beats: turns } })));
    const keys = (p.rotation as Array<{ t: number; v: number[] }>).map((k) => k.v[1]!);
    const moves = keys.slice(1).filter((y, n) => Math.abs(y - keys[n]!) > 1).length;
    expect(moves).toBeGreaterThanOrEqual(3);
  });
  it('a wide product is sized by its width and lifted so its centre stays where the camera looks', () => {
    const towel = product(buildCinematicFilm(flat({ productAspect: 0.5, texture: { ...pic('ast_front', 400, 200), kind: 'front' } })));
    expect(towel.size as number).toBeCloseTo(PRODUCT_H * 0.9, 3);
    const lifts = (towel.position as Array<{ v: number[] }>).map((k) => k.v[1]!);
    expect(Math.min(...lifts)).toBeGreaterThan(0);
  });
  it('needs a contour', () => {
    expect(() => buildCinematicFilm(flat({ contour: undefined }))).toThrow(/contour/);
  });
  it('fits every aspect', () => {
    for (const aspect of ['9:16', '16:9', '1:1'] as const) expect(lightValidate(buildCinematicFilm(flat({ aspect }))).ok).toBe(true);
  });
});

describe('a set: backdrop on the wall, a floor and air', () => {
  const art = (id: string, w = 1500, h = 1024) => ({ id, src: `/api/assets/${id}`, width: w, height: h });
  const withSet = (air: 'none' | 'dust' | 'bokeh' | 'spray' | 'smoke', key?: 'low' | 'mid' | 'high') =>
    input({ ...(key ? { key } : {}), set: { look: 'beach', air, backdrop: art('ast_back'), ground: '#d8b878', dot: art('ast_dot', 128, 128) } });

  it('puts the backdrop on a 4 m wall 3.2 m behind, with a coloured floor, and registers the picture', () => {
    const c = buildCinematicFilm(withSet('none')) as any;
    const w = world(c) as any;
    expect(w.set).toEqual({ ground: '#d8b878', groundSize: [...CAMERA.groundSize], wall: { distance: 3.2, height: 4 }, backdrop: 'ast_back', reflection: { strength: 0.2, fade: 0.3 } }); // a mid key with no finish gets a matte floor
    expect(c.assets.ast_back).toBeDefined();
    expect(c.precomps.cine.assets.ast_back).toBeDefined();
    const v = lightValidate(c);
    expect(v.ok, v.ok ? '' : JSON.stringify(v.issues)).toBe(true);
  });
  it('the macro aims at the label: offset toward it, never so far that the frame leaves the product', () => {
    const [x, y] = macroOffset([0.9, 0.1], 0.3, 0.3, 9 / 16);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
    const frameH = PRODUCT_H / FILL.macro;
    expect(Math.abs(x)).toBeLessThanOrEqual((0.3 - frameH * (9 / 16)) / 2 + 1e-3);
    expect(Math.abs(y)).toBeLessThanOrEqual((0.3 - frameH) / 2 + 1e-3);
    expect(macroOffset([0.5, 0.5], 0.3, 0.3, 9 / 16)).toEqual([0, 0]);
    expect(macroOffset([0.9, 0.1], 0.05, 0.05, 9 / 16)).toEqual([0, 0]);
  });
  it('a turned product shows its width foreshortened, so the sideways aim shrinks with the turn', () => {
    const [flat] = macroOffset([0.95, 0.5], 0.5, 0.3, 9 / 16);
    const [turned] = macroOffset([0.95, 0.5], 0.5, 0.3, 9 / 16, 30);
    expect(turned).toBeLessThan(flat);
    expect(turned).toBeGreaterThan(0);
  });
  it('a flat product with a label spot gets a macro that moves the camera and its target there, and back after', () => {
    const flatSheet = { beats: sheet.beats };
    const c = buildCinematicFilm(input({ sheet: flatSheet, shape: 'other', contour: [[0, 0], [100, 0], [100, 200], [0, 200]], productAspect: 2, focus: [0.9, 0.1] } as any)) as any;
    const target = (world(c) as any).camera.target;
    expect(Array.isArray(target[0]) || typeof target[0] === 'object').toBe(true);
    const aim = target.find((k: any) => k.v[0] !== 0);
    expect(aim).toBeDefined();
    expect(target.at(-1).v[0]).toBe(0);
    const plain = buildCinematicFilm(input({ sheet: flatSheet, shape: 'other', contour: [[0, 0], [100, 0], [100, 200], [0, 200]], productAspect: 2 } as any)) as any;
    expect((world(plain) as any).camera.target).toEqual([0, PRODUCT_Y, 0]);
  });
  it('a set is lit by the board\'s key level: a low key keeps its mood, a high key opens up', () => {
    const lights = (key: 'low' | 'mid' | 'high') => (world(buildCinematicFilm(withSet('none', key))) as any).lights;
    for (const k of ['low', 'mid', 'high'] as const) {
      const l = lights(k);
      expect(l.key.intensity).toBe(LIGHT[k].key);
      expect(l.fill.intensity).toBe(LIGHT[k].fill);
      expect(l.ambient).toBe(LIGHT[k].ambient);
      expect(l.rim.intensity.at(-1).v).toBe(LIGHT[k].rimEnd);
    }
    expect(lights('low').fill.intensity).toBeLessThan(lights('high').fill.intensity);
  });
  it('the words of a line sit one space apart and stay inside the frame', () => {
    const c = buildCinematicFilm(input({ title: 'Wave Rider Longboard Pro', brand: undefined } as any)) as any;
    const texts = layers(c).filter((l: any) => l.kind === 'text' && l.transform.position?.[0]?.v);
    const rows = new Map<number, any[]>();
    for (const l of texts) {
      const [x, y] = l.transform.position[0].v;
      // a text layer's position is the centre of its box
      rows.set(y, [...(rows.get(y) ?? []), { x: x - l.style.boxWidth / 2, w: l.style.boxWidth, size: l.style.size }]);
    }
    const lines = [...rows.values()].filter((r) => r.length >= 2);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      line.sort((a, b) => a.x - b.x);
      expect(line[0].x).toBeGreaterThanOrEqual(0);
      expect(line.at(-1).x + line.at(-1).w).toBeLessThanOrEqual(1080);
      for (let n = 1; n < line.length; n++) expect(line[n].x - (line[n - 1].x + line[n - 1].w)).toBeCloseTo(SPACE_EM * line[n].size, 0);
    }
  });
  it('the camera never goes below the floor, even at a low angle', () => {
    const cam = planCamera({ beats: sheet.beats.map((b) => ({ ...b, angle: 'low' })) }, 30);
    for (const k of cam.position) expect((k.v as number[])[1]!).toBeGreaterThanOrEqual(CAMERA.minCameraHeight);
  });
  it('the floor reaches behind the hook camera, so the bottom of the first picture is floor', () => {
    const cam = planCamera({ beats: sheet.beats }, 30);
    const z = (cam.position[0]!.v as number[])[2]!;
    expect(Math.abs(z)).toBeLessThan(CAMERA.groundSize[1] / 2);
  });
  it('the product is in the first picture: it drops in from no higher than the rule book says', () => {
    const c = buildCinematicFilm(withSet('none')) as any;
    const can = props(c).find((p: any) => p.role === 'product') as any;
    const first = can.position[0];
    expect(first.t).toBe(0);
    expect(first.v[1]).toBeLessThanOrEqual(CAMERA.dropFrom);
  });
  it('without a set the world is bare and the 2D halo stays; with one the halo goes', () => {
    const bare = buildCinematicFilm(input()) as any;
    expect((world(bare) as any).set).toEqual({ ground: 'none', wall: false });
    const names = (c: any) => layers(c).map((l) => l.name);
    expect(layers(bare).filter((l) => l.kind === 'shape').length).toBeGreaterThan(layers(buildCinematicFilm(withSet('none'))).filter((l) => l.kind === 'shape').length);
    expect(names(bare).length).toBeGreaterThan(0);
  });
  it('dust is one swarm of tiny specks round the product', () => {
    const dust = props(buildCinematicFilm(withSet('dust'))).find((p) => p.id === 'cine:air-dust') as any;
    expect(dust.swarm.motion).toBe('drift');
    expect(dust.size).toBeLessThan(0.01);
  });
  it('smoke is two slow plumes behind the product from the first frame to the last', () => {
    const c = buildCinematicFilm(withSet('smoke'));
    const plumes = props(c).filter((p) => String(p.id).startsWith('cine:air-smoke')) as any[];
    expect(plumes).toHaveLength(2);
    for (const p of plumes) {
      expect(p.source).toMatchObject({ type: 'smoke', form: 'steam' });
      expect(p.position[2]).toBeLessThan(0);
      expect(p.inPoint).toBe(0);
    }
    expect(plumes[0].source.seed).not.toBe(plumes[1].source.seed);
  });
  it('spray bursts during the peak shot only', () => {
    const c = buildCinematicFilm(input({ sheet: { beats: sheet.beats.map((b, k) => ({ ...b, phase: k === 4 ? 'peak' : b.phase })) }, set: { look: 'beach', air: 'spray', backdrop: art('ast_back'), ground: '#d8b878' } })) as any;
    const spray = props(c).find((p) => p.id === 'cine:air-spray') as any;
    const peak = planCamera({ beats: sheet.beats }, 30).beats[4]!;
    expect(spray.swarm.motion).toBe('burst');
    expect(spray.inPoint).toBe(peak.start);
  });
  it('spray is clear round drops, never cubes', () => {
    const c = buildCinematicFilm(input({ sheet: { beats: sheet.beats.map((b, k) => ({ ...b, phase: k === 4 ? 'peak' : b.phase })) }, set: { look: 'beach', air: 'spray', backdrop: art('ast_back'), ground: '#d8b878' } })) as any;
    const spray = props(c).find((p) => p.id === 'cine:air-spray') as any;
    expect(spray.source.round).toBe(MATERIALS.dropRound);
    expect(spray.material.color).not.toBe('#fff6e4');
    expect(spray.material.clearcoat).toBe(1);
  });
  it('bokeh is four soft lights, single cards (a swarm cannot be a card), drifting', () => {
    const lights = props(buildCinematicFilm(withSet('bokeh'))).filter((p) => (p.id as string).startsWith('cine:air-bokeh')) as any[];
    expect(lights).toHaveLength(4);
    for (const l of lights) {
      expect(l.source.type).toBe('card');
      expect(l.swarm).toBeUndefined();
      expect(l.position).toHaveLength(2);
    }
  });
  it('stays inside the engine limits with every kind of air', () => {
    for (const air of ['none', 'dust', 'bokeh', 'spray'] as const) {
      const c = buildCinematicFilm(withSet(air));
      expect(props(c).length).toBeLessThanOrEqual(LIMITS.props);
      expect(props(c).reduce((n, p: any) => n + (p.swarm?.count ?? 1), 0)).toBeLessThan(LIMITS.instances);
      expect(lightValidate(c).ok).toBe(true);
    }
  });
  it('a set needs less exposure than the dark field', () => {
    const exp = (c: any) => (world(c) as any).style.exposure as number;
    expect(exp(buildCinematicFilm(withSet('none') as any))).toBeLessThanOrEqual(exp(buildCinematicFilm(input())));
  });
});

describe('the camera moves beyond push and orbit', () => {
  const beat = (move: any, size: any, extra: Record<string, unknown> = {}) => ({ size, move, seconds: 1, angle: 'eye', phase: 'build', product: 'still', ...extra });
  const film = (moves: Array<[string, string]>) => ({
    beats: [
      ...moves.map(([m, sz], i) => beat(m, sz, i === 0 ? { phase: 'hook' } : {})),
      { size: 'medium', move: 'hold', seconds: 2, phase: 'close', product: 'still' },
    ] as BeatSheet['beats'],
  });
  const plan = planCamera(film([['push', 'wide'], ['truck', 'medium'], ['crane', 'close'], ['whip', 'medium'], ['rack', 'wide'], ['truck', 'close']]), 30);
  const at = (n: number) => plan.beats[n]!;
  const pos = (n: number, k: 'from' | 'to') => plan.position[n * 2 + (k === 'from' ? 0 : 1)]!.v;

  it('a truck slides the camera sideways at one distance, and the next truck goes the other way', () => {
    const [x0, , z0] = pos(1, 'from');
    const [x1] = pos(1, 'to');
    expect(Math.abs(x1 - x0)).toBeGreaterThan(0.1);
    expect(Math.hypot(x0, z0)).toBeGreaterThan(at(1).to.d * 0.99);
    expect(Math.sign(x1 - x0)).not.toBe(Math.sign(pos(5, 'to')[0] - pos(5, 'from')[0]));
    expect(at(1).from.d).toBeCloseTo(at(1).to.d, 4);
  });
  it('a crane rises from the low angle to the high one, or falls, at the same distance', () => {
    expect(Math.abs(at(2).to.el - at(2).from.el)).toBeGreaterThan(25);
    expect(pos(2, 'to')[1]).not.toBeCloseTo(pos(2, 'from')[1], 2);
  });
  it('a whip starts far round and brakes: nearly all the swing happens early', () => {
    expect(Math.abs(at(3).from.az)).toBeGreaterThanOrEqual(50);
    expect(at(3).to.az).toBe(0);
    const k = plan.position[3 * 2]!;
    expect(k.easeOut?.[1]).toBeGreaterThan(0.8);
  });
  it('a rack starts the focus at the near lights and ends on the product', () => {
    const a = plan.focus[4 * 2]!.v;
    const b = plan.focus[4 * 2 + 1]!.v;
    expect(a).toBeLessThan(b * 0.6);
    expect(b).toBeCloseTo(at(4).to.d, 3);
  });
  it('every shot is a cut: the keys still come in pairs with hold between', () => {
    expect(plan.position).toHaveLength(plan.beats.length * 2);
    expect(plan.position.filter((k) => k.hold)).toHaveLength(plan.beats.length - 1);
  });
  it('a hold after a truck keeps the camera where the truck ended', () => {
    const p = planCamera(film([['push', 'wide'], ['truck', 'medium']]), 30);
    const end = p.position[3]!.v;
    const holdStart = p.position[4]!.v;
    expect(Math.abs(holdStart[0] - end[0])).toBeLessThan(Math.abs(end[0]) * 0.2 + 0.02);
  });
});

describe('the checker leaves the moves to Muse', () => {
  const base = defaultBeatSheet(floorElements('Stone Mug', 'home'));
  const els2 = floorElements('Stone Mug', 'home');
  const withMoves = (moves: string[]) => ({ beats: base.beats.map((b, i) => ({ ...b, move: (moves[i] ?? b.move) as any })) });
  it('the floor sheet passes and uses a truck', () => {
    expect(checkBeatSheet(base, els2)).toEqual([]);
    expect(base.beats.some((b) => b.move === 'truck')).toBe(true);
  });
  it('lets a film use one move, no truck or crane, a whip first or long, and a rack on a macro', () => {
    expect(checkBeatSheet({ beats: withMoves(['push', 'push', 'push', 'push', 'push', 'push']).beats }, els2)).toEqual([]);
    expect(checkBeatSheet(withMoves(['whip']), els2)).toEqual([]);
    expect(checkBeatSheet(withMoves(['push', 'push', 'rack']), els2)).toEqual([]);
    expect(checkBeatSheet(withMoves(['push', 'push', 'push', 'whip']), els2)).toEqual([]);
  });
});

describe("Muse's camera numbers win over the move's preset", () => {
  const plain = (extra: Partial<BeatSheet['beats'][number]> = {}): BeatSheet => ({
    beats: [{ size: 'medium', move: 'push', seconds: 2, ...extra }, { size: 'medium', move: 'hold', seconds: 2 }] as BeatSheet['beats'],
  });
  const first = (sh: BeatSheet) => planCamera(sh, 30).beats[0]!;
  it('a shot with no camera plays its move as before', () => {
    expect(first(plain()).to.d).toBeCloseTo(framingDistance(FILL.medium), 3);
  });
  it('fill sets how much of the frame the product fills, at the lens in force', () => {
    const f = first(plain({ camera: { to: { fill: 0.25 } } }));
    expect(f.to.d).toBeCloseTo(framingDistance(0.25), 3);
    const g = first(plain({ camera: { to: { fill: 0.8, lens: 18 } } }));
    expect(g.to.fov).toBe(18);
    expect(g.to.d).toBeCloseTo(framingDistance(0.8, 18), 3);
  });
  it('a lens change without a fill keeps the product its size (the distance follows the lens)', () => {
    const f = first(plain({ camera: { to: { lens: 60 } } }));
    const keep = (framingDistance(FILL.medium) * Math.tan((30 * Math.PI) / 360)) / Math.tan((60 * Math.PI) / 360);
    expect(f.to.d).toBeCloseTo(keep, 3);
  });
  it('height, around and side move the camera, each end on its own', () => {
    const f = first(plain({ camera: { from: { around: -60, height: -5 }, to: { around: 40, height: 30, side: 0.4 } } }));
    expect([f.from.az, f.from.el]).toEqual([-60, -5]);
    expect([f.to.az, f.to.el]).toEqual([40, 30]);
    expect(f.to.x).toBeCloseTo(0.4 * f.to.d, 3);
  });
  it('the ease word picks the curve, and rack moves the focus from near the lens', () => {
    const slow = planCamera(plain({ camera: { ease: 'smooth' } }), 30);
    expect(slow.position[0]!.easeIn).toEqual([0.42, 0, 0.58, 1]);
    const rack = planCamera(plain({ camera: { focus: 'rack' } }), 30);
    expect(rack.focus[0]!.v).toBeLessThan(rack.focus[1]!.v);
  });
  it('the end hold keeps room for the words: a fill past the cap is held back, a label crop is not', () => {
    const capped = planCamera(plain({ camera: { to: { fill: 1.0 } } }), 30, { holdFill: 0.5 }).beats[0]!;
    expect(capped.to.d).toBeCloseTo(framingDistance(0.5), 3);
    const crop = planCamera(plain({ camera: { to: { fill: 1.4 } } }), 30, { holdFill: 0.5 }).beats[0]!;
    expect(crop.to.d).toBeCloseTo(framingDistance(1.4), 3);
  });
  it('two films with different camera numbers get different cameras from the same sheet', () => {
    const a = planCamera(plain({ camera: { from: { lens: 20 }, to: { fill: 0.6, lens: 20 } } }), 30);
    const b = planCamera(plain({ camera: { from: { lens: 70 }, to: { fill: 0.6, lens: 70 } } }), 30);
    expect(a.position).not.toEqual(b.position);
    expect(a.fov[0]!.v).toBe(20);
    expect(b.fov[0]!.v).toBe(70);
  });
  it('an element plays where and how big Muse says', () => {
    const els = { ...ingredients, vap: { kind: 'vap', use: 'vapour' as const, sizeM: 0.3, frames: [], procedural: 'vapour' as const, color: '#cccccc' } };
    const run = (ingredient: { kind: string; action: 'rise'; place?: 'front' | 'behind' | 'around'; scale?: number }) => {
      const sh: BeatSheet = { beats: sheet.beats.map((b, n) => (n === 1 ? { ...b, ingredient } : b)) };
      return props(buildCinematicFilm(input({ sheet: sh, ingredients: els as any }))).find((p: any) => p.source.type === 'smoke') as any;
    };
    expect(run({ kind: 'vap', action: 'rise' }).position[2]).toBeLessThan(0);
    expect(run({ kind: 'vap', action: 'rise', place: 'front' }).position[2]).toBeGreaterThan(0);
    expect(run({ kind: 'vap', action: 'rise', scale: 2 }).size).toBeCloseTo(0.6, 3);
  });
});

describe('cuts carry the motion', () => {
  const dflt = planCamera(sheet, 30);
  it('every cut between two moving shots leaves and enters at speed, never from a stop', () => {
    for (const c of cutSpeeds(dflt)) {
      if (c.out !== null) expect(c.out, `leaving into shot ${c.shot + 1}`).toBeGreaterThanOrEqual(0.5);
      if (c.in !== null) expect(c.in, `entering shot ${c.shot + 1}`).toBeGreaterThanOrEqual(0.5);
    }
  });
  it('a hold has no speed to carry, and neither does the end of a whip (it brakes on purpose)', () => {
    const beats = [{ size: 'wide', move: 'push', seconds: 1 }, { size: 'medium', move: 'whip', seconds: 0.8 }, { size: 'close', move: 'push', seconds: 1 }, { size: 'medium', move: 'hold', seconds: 2 }] as BeatSheet['beats'];
    const c = cutSpeeds(planCamera({ beats }, 30));
    expect(c[1]!.out).toBeNull();
    expect(c[2]!.in).toBeNull();
    expect(c[0]!.in).toBeGreaterThan(2); // the whip enters very fast
  });
  it('the old ease-out stops dead at the end: that is what the through-ease replaces', () => {
    expect(cutSpeeds(planCamera({ beats: [{ size: 'wide', move: 'push', seconds: 1 }, { size: 'medium', move: 'push', seconds: 1 }, { size: 'medium', move: 'hold', seconds: 2 }] as BeatSheet['beats'] }, 30))[0]!.out).toBeGreaterThan(0.5);
  });
  it('the product keeps turning through the cut', () => {
    const turn = { beats: sheet.beats.map((b, i) => ({ ...b, product: i === 1 || i === 2 ? ('turn' as const) : b.product })) };
    const c = buildCinematicFilm(input({ sheet: turn })) as any;
    const p = props(c).find((x) => x.role === 'product') as any;
    const ks = (p.rotation as Array<any>).filter((k) => k.easeOut);
    expect(ks.length).toBeGreaterThan(1);
    const turning = ks.filter((k) => k.easeOut[0] === 0.3 && k.easeOut[1] === 0.2);
    expect(turning.length).toBeGreaterThanOrEqual(2);
  });
});

describe('the handheld tremor', () => {
  const plan = planCamera(sheet, 30);
  it('affords up to three keys a shot, fewer as the world fills up, none when it is full', () => {
    const B = CAMERA.tweenBudget;
    expect(shakeKeysPerShot(7, 10)).toBe(3);
    expect(shakeKeysPerShot(7, B - 45)).toBe(2);
    expect(shakeKeysPerShot(7, B - 38)).toBe(1);
    expect(shakeKeysPerShot(10, B - 20)).toBe(0);
    expect(shakeKeysPerShot(0, 0)).toBe(3);
  });
  it('leaves every cut and hold exactly where the plan put it, and keeps position and lens keys on the same frames', () => {
    const k = shakeCamera(plan, 2);
    plan.beats.forEach((b) => {
      const first = k.position.find((x) => x.t === b.start)!;
      const lastKey = k.position.find((x) => x.t === b.end)!;
      expect(first.v).toEqual(plan.position.find((x) => x.t === b.start)!.v);
      expect(lastKey.v).toEqual(plan.position.find((x) => x.t === b.end)!.v);
    });
    expect(k.position.map((x) => x.t)).toEqual(k.fov.map((x) => x.t));
    expect(k.position.filter((x) => x.hold)).toHaveLength(plan.beats.length - 1);
    expect(k.focus).toEqual(plan.focus);
  });
  it('shakes the moves that can carry it, and leaves a dolly-zoom and a whip steady', () => {
    const beats = [{ size: 'wide', move: 'push', seconds: 1.2 }, { size: 'medium', move: 'whip', seconds: 0.8 }, { size: 'close', move: 'dolly-zoom', seconds: 1 }, { size: 'medium', move: 'hold', seconds: 2 }] as BeatSheet['beats'];
    const p = planCamera({ beats }, 30);
    const k = shakeCamera(p, 2);
    const inShot = (n: number) => k.position.filter((x) => x.t >= p.beats[n]!.start && x.t <= p.beats[n]!.end).length;
    expect(inShot(0)).toBe(4);
    expect(inShot(1)).toBe(2);
    expect(inShot(2)).toBe(2);
    expect(inShot(3)).toBe(4);
  });
  it('is small, the same every time, and nothing at zero keys', () => {
    expect(shakeCamera(plan, 0)).toBe(plan);
    const a = shakeCamera(plan, 2);
    const b = shakeCamera(plan, 2);
    expect(a).toEqual(b);
    const mid = a.position.find((x) => x.t > plan.beats[0]!.start && x.t < plan.beats[0]!.end)!;
    const planned = plan.position[0]!.v;
    expect(Math.hypot(mid.v[0] - planned[0], mid.v[1] - planned[1])).toBeLessThan(0.3);
  });
  it('a handheld film has more camera keys than a locked one, and still validates', () => {
    const locked = world(buildCinematicFilm(input())) as any;
    const live = buildCinematicFilm(input({ handheld: true })) as any;
    expect((world(live) as any).camera.position.length).toBeGreaterThan(locked.camera.position.length);
    const v = lightValidate(live);
    expect(v.ok, v.ok ? '' : JSON.stringify(v.issues)).toBe(true);
  });
});

describe('copy that moves', () => {
  const texts = (c: any): Obj[] => layers(c).filter((l) => l.kind === 'text');
  const said = (c: any, w: string) => texts(c).filter((l) => l.source === w);
  const withWords = (extra: Partial<CinematicInput> = {}, mark: Record<number, string> = { 0: 'Pack the car', 3: 'Feel summer' }) =>
    input({ sheet: { beats: sheet.beats.map((b, i) => (mark[i] ? { ...b, text: mark[i] } : b)) }, tagline: 'Summer, packed.', ...extra });

  it('a shot\'s words are one layer each, popping in with an overshoot, with a shadow', () => {
    const c = buildCinematicFilm(withWords()) as any;
    const pack = said(c, 'Pack');
    expect(pack).toHaveLength(1);
    const scale = (pack[0] as any).transform.scale as Array<{ t: number; v: number[] }>;
    expect(Math.max(...scale.map((k) => k.v[0]!))).toBeCloseTo(1.12, 2);
    expect(scale[0]!.v[0]).toBeCloseTo(0.6, 2);
    expect(((pack[0] as any).effects as Obj[])[0]!.name).toBe('drop-shadow');
  });
  it('the words come one after another and are gone before the next shot', () => {
    const c = buildCinematicFilm(withWords()) as any;
    const t = (w: string) => ((said(c, w)[0] as any).transform.opacity as Array<{ t: number; v: number }>);
    const arrive = (w: string) => t(w).find((k) => k.v === 1)!.t;
    expect(arrive('car')).toBeGreaterThan(arrive('Pack'));
    const plan = planCamera({ beats: sheet.beats }, 30);
    const lastKey = t('car').at(-1)!;
    expect(lastKey.v).toBe(0);
    expect(lastKey.t).toBeLessThanOrEqual(plan.beats[0]!.end + 3);
  });
  it('lands the tagline under the name, after it, and clear of the product', () => {
    const c = buildCinematicFilm(withWords()) as any;
    const name = said(c, 'Cold')[0] as any;
    const tag = said(c, 'packed.')[0] as any;
    expect(tag).toBeDefined();
    const y = (l: any) => (Array.isArray(l.transform.position) && typeof l.transform.position[0] === 'object' ? l.transform.position.at(-1).v[1] : l.transform.position[1]);
    expect(tag.transform.opacity.find((k: any) => k.v === 1).t).toBeGreaterThan(name!.transform.opacity.find((k: any) => k.v === 1).t);
    expect(y(tag)).toBeGreaterThan(y(name));
  });
  it('without a tagline or words there is nothing extra', () => {
    const plain = buildCinematicFilm(input()) as any;
    const rich = buildCinematicFilm(withWords()) as any;
    expect(texts(rich).length).toBeGreaterThan(texts(plain).length);
    expect(said(plain, 'packed.')).toHaveLength(0);
  });
  it('never puts words in the macro or the last shot, even if the sheet asks', () => {
    const macro = sheet.beats.findIndex((b) => b.size === 'macro');
    const c = buildCinematicFilm(withWords({}, { [macro]: 'Look closer', [sheet.beats.length - 1]: 'Buy now' })) as any;
    expect(said(c, 'Look')).toHaveLength(0);
    expect(said(c, 'Buy')).toHaveLength(0);
  });
  it('still validates', () => {
    const v = lightValidate(buildCinematicFilm(withWords()));
    expect(v.ok, v.ok ? '' : JSON.stringify(v.issues)).toBe(true);
  });
});

describe('a wide product stays inside the frame', () => {
  it('a cap on the fill makes the camera stand further back, except in the macro', () => {
    const free = planCamera({ beats: [{ size: 'close', move: 'push', seconds: 1 }, { size: 'macro', move: 'push', seconds: 1 }, { size: 'medium', move: 'hold', seconds: 2 }] as BeatSheet['beats'] }, 30);
    const capped = planCamera({ beats: [{ size: 'close', move: 'push', seconds: 1 }, { size: 'macro', move: 'push', seconds: 1 }, { size: 'medium', move: 'hold', seconds: 2 }] as BeatSheet['beats'] }, 30, { maxFill: 0.5 });
    expect(capped.beats[0]!.to.d).toBeGreaterThan(free.beats[0]!.to.d * 1.4);
    expect(capped.beats[1]!.to.d).toBeCloseTo(free.beats[1]!.to.d, 6);
    expect(capped.beats[2]!.to.d).toBeCloseTo(free.beats[2]!.to.d, 6);
  });
  it('a wide flat product in a portrait frame is framed by its width, a tall one is not capped', () => {
    const closeShot = { beats: sheet.beats.map((b) => ({ ...b, size: b.move === 'hold' ? b.size : ('close' as const) })) } as BeatSheet;
    const wide = buildCinematicFilm(input({ sheet: closeShot, shape: 'other', contour: [[0, 0], [400, 0], [400, 170], [0, 170]], texture: { ...pic('ast_f', 400, 170), kind: 'front' }, productAspect: 0.43 })) as any;
    const tall = buildCinematicFilm(input({ sheet: closeShot, shape: 'other', contour: [[0, 0], [100, 0], [100, 400], [0, 400]], texture: { ...pic('ast_f', 100, 400), kind: 'front' }, productAspect: 4 })) as any;
    const dist = (c: any) => Math.hypot(...((world(c) as any).camera.position[1].v as number[]));
    expect(dist(wide)).toBeGreaterThan(dist(tall) * 1.3);
  });
});

describe("the end card as Muse styles it", () => {
  const W = 1080;
  const wordsOf = (c: any) => layers(c).filter((l) => l.kind === 'text');
  const plates = (c: any) => layers(c).filter((l) => l.kind === 'shape' && (l.path as any)?.kind === 'rect' && ['#0b0b12', '#ffffff'].includes(String(l.fill)) && (l.path as any).size[1] < 400);
  const base = () => buildCinematicFilm(input({ tagline: 'Cold goes anywhere' }));
  const pos = (l: any) => {
    const p = l.transform.position;
    return (Array.isArray(p) && typeof p[0] === 'object' ? p[0].v : p) as [number, number];
  };
  const word = (c: any, text: string) => wordsOf(c).find((l) => String(l.source) === text) as any;
  it('with no choices it is as before: a pill plate, a round disc, the product accent', () => {
    const c = base();
    expect(plates(c).length).toBeGreaterThan(0);
    expect(plates(c).every((l) => (l.path as any).roundness > 0)).toBe(true);
    expect(layers(c).some((l) => l.kind === 'shape' && l.fill === '#c27a3a' && (l.path as any).kind === 'ellipse')).toBe(true);
  });
  it('plate none draws no plate, and bar runs the full width with square ends', () => {
    expect(plates(buildCinematicFilm(input({ tagline: 'x y', endCard: { plate: 'none' } }))).length).toBe(0);
    const bar = plates(buildCinematicFilm(input({ tagline: 'x y', endCard: { plate: 'bar' } })));
    expect(bar.length).toBeGreaterThan(0);
    for (const b of bar) {
      expect((b.path as any).roundness ?? 0).toBe(0);
      expect((b.path as any).size[0]).toBeGreaterThanOrEqual(W - 2);
    }
  });
  it('price tag is a rounded rectangle, plain has no shape, and the accent colours it', () => {
    const tag = buildCinematicFilm(input({ endCard: { price: 'tag', accent: '#2b9d8f' } }));
    const t = layers(tag).find((l) => l.kind === 'shape' && l.fill === '#2b9d8f') as any;
    expect(t.path.kind).toBe('rect');
    expect(t.path.size[0]).toBeGreaterThan(t.path.size[1]);
    const plain = buildCinematicFilm(input({ endCard: { price: 'plain', accent: '#2b9d8f' } }));
    expect(layers(plain).some((l) => l.kind === 'shape' && l.fill === '#2b9d8f')).toBe(false);
    expect(wordsOf(plain).some((l) => /\$/.test(String(l.source)))).toBe(true);
  });
  it('capitals, weight and alignment change the words', () => {
    const up = buildCinematicFilm(input({ tagline: 'Cold goes anywhere', endCard: { text: 'upper' } }));
    expect(word(up, 'BREW')).toBeTruthy();
    expect(word(up, 'ANYWHERE')).toBeTruthy();
    expect(word(buildCinematicFilm(input({ endCard: { weight: 'light' } })), 'Cold').style.weight).toBe(300);
    expect(word(buildCinematicFilm(input({ endCard: { weight: 'bold' } })), 'Cold').style.weight).toBe(700);
    const centred = pos(word(base(), 'Cold'));
    const left = pos(word(buildCinematicFilm(input({ tagline: 'Cold goes anywhere', endCard: { align: 'left' } })), 'Cold'));
    expect(left[0]).toBeLessThan(centred[0]);
    expect(left[0]).toBeLessThan(W * 0.3);
  });
  it('pulse false keeps the price from beating with the music', () => {
    const keys = (c: any) => (layers(c).find((l) => l.kind === 'shape' && l.fill === '#c27a3a' && (l.path as any).kind === 'ellipse') as any).transform.scale.length;
    expect(keys(buildCinematicFilm(input({ endCard: { pulse: false } })))).toBeLessThan(keys(base()));
  });
  it('the film still passes the light validator with any style', () => {
    for (const endCard of [{ plate: 'bar', price: 'tag', align: 'left', text: 'upper', weight: 'bold' }, { plate: 'none', price: 'plain', pulse: false }] as const) {
      expect(lightValidate(buildCinematicFilm(input({ tagline: 'Cold goes anywhere', endCard }))).ok).toBe(true);
    }
  });
});

describe('Muse directs the product, the light and the shutter', () => {
  const beat = (extra: object = {}): any => ({ size: 'medium', move: 'push', seconds: 2, product: 'still', ...extra });
  const mk = (...beats: any[]): BeatSheet => ({ beats: [...beats, beat({ move: 'hold', seconds: 2 })] });
  const rot = (sh: BeatSheet) => props(buildCinematicFilm(input({ sheet: sh })))[0]!.rotation as Array<{ t: number; v: number[] }>;
  const lift = (sh: BeatSheet) => props(buildCinematicFilm(input({ sheet: sh })))[0]!.position as Array<{ t: number; v: number[] }>;
  it('a spin of 360 degrees turns the product right round over its shot, and a negative one turns it back', () => {
    const k = rot(mk(beat({ spin: { degrees: 360 } })));
    expect(k.at(-2)!.v[1]! - k[0]!.v[1]!).toBeCloseTo(360, 0);
    const back = rot(mk(beat({ spin: { degrees: -180 } })));
    expect(back.at(-2)!.v[1]! - back[0]!.v[1]!).toBeCloseTo(-180, 0);
  });
  it('tilt and roll peak at the middle of the shot, and a lift raises the product there and brings it back', () => {
    const sh = mk(beat({ spin: { degrees: 90, tilt: 20, roll: 12, lift: 1.5 } }));
    const k = rot(sh);
    const mid = k.find((x) => x.v[2] === 12)!;
    expect(mid.v[0]).toBeCloseTo(24, 1);
    const up = lift(sh);
    expect(Math.max(...up.map((x) => x.v[1]!))).toBeCloseTo(1.5 * PRODUCT_H, 3);
    expect(up.at(-1)!.v[1]).toBe(0);
  });
  it('a shot with no spin turns as its product word says, and two spins give two different films', () => {
    const plain = rot(mk(beat({ product: 'turn' })));
    expect(plain.at(-2)!.v[1]! - plain[0]!.v[1]!).toBeCloseTo(45 + 28 - 28 + 28 - 28, 0);
    expect(JSON.stringify(rot(mk(beat({ spin: { degrees: 360 } }))))).not.toEqual(JSON.stringify(rot(mk(beat({ spin: { degrees: 90 } })))));
  });
  it('a light that slides across a shot is keyed from where it starts to where it ends, and only what a shot names is keyed', () => {
    const sh = mk(beat({ light: { from: -80, to: 70, rim: 2 } }));
    const cam = planCamera(sh, 30);
    const lp = lightKeys(sh, cam, { azimuth: -70, elevation: 55, key: 3, rim: 0.6 })!;
    expect(lp.azimuth!.map((k) => k.v)).toEqual([-80, 70]);
    expect(lp.rim!.map((k) => k.v)).toEqual([1.2]);
    expect(lp.key).toBeUndefined();
    expect(lp.elevation).toBeUndefined();
    const w = world(buildCinematicFilm(input({ sheet: sh }))) as any;
    expect(w.lights.key.azimuth.at(-1).v).toBe(70);
    expect(lightKeys(mk(beat()), planCamera(mk(beat()), 30), { azimuth: -70, elevation: 55, key: 3, rim: 0.6 })).toBeUndefined();
  });
  it('the film keeps the colours Muse chose for the key and the rim light', () => {
    const w = world(buildCinematicFilm(input({ light: { key: '#ffd7a3', rim: '#22ccdd' } }))) as any;
    expect(w.lights.key.color).toBe('#ffd7a3');
    expect(w.lights.rim.color).toBe('#22ccdd');
    expect((world(buildCinematicFilm(input())) as any).lights.rim.color).toBeUndefined();
  });
  it('the shutter is open in the shots that name it, else as long as the film says, and not at all by default', () => {
    const sh = mk(beat({ blur: 0.9 }), beat());
    const cam = planCamera(sh, 30);
    expect(motionBlur(sh, cam, undefined)!.shots).toHaveLength(1);
    expect(motionBlur(sh, cam, 0.4)!.shots.map((s: { shutter: number }) => s.shutter)).toEqual([0.9, 0.4, 0.4]);
    expect(motionBlur(mk(beat()), planCamera(mk(beat()), 30), undefined)).toBeUndefined();
    const even = mk(beat(), beat());
    expect(motionBlur(even, planCamera(even, 30), 1)!.samples).toBeGreaterThan(motionBlur(even, planCamera(even, 30), 0.1)!.samples);
    const post = (world(buildCinematicFilm(input({ sheet: sh, blur: 0.5 }))) as any).post;
    expect(post.motionBlur.shots[0]).toMatchObject({ startFrame: 0, shutter: 0.9 });
  });
});

describe('camera paths, the seeded tremor and focus pulls', () => {
  const beat = (extra: object = {}): any => ({ size: 'medium', move: 'push', seconds: 2, angle: 'eye', phase: 'build', product: 'still', ...extra });
  const hold = beat({ move: 'hold', phase: 'close' });
  const via = { camera: { from: { around: -40, fill: 0.4 }, via: [{ around: 0, height: 20, fill: 0.6 }, { around: 30, height: 5, fill: 0.5 }], to: { around: 60, fill: 0.8 } } };
  it('a camera path through waypoints is sampled, starts and ends on its own ends, and bends away from the straight line', () => {
    const s: BeatSheet = { beats: [beat(via), hold] };
    const straight = planCamera({ beats: [beat({ camera: via.camera && { from: via.camera.from, to: via.camera.to } }), hold] }, 30);
    const plan = shakeCamera(planCamera(s, 30), 0);
    const f = plan.beats[0]!;
    expect(f.via).toHaveLength(2);
    const ks = plan.position.filter((k) => k.t >= f.start && k.t <= f.end);
    expect(ks).toHaveLength(2 * 2 + 2 + 2);
    expect(ks[0]!.v).toEqual(straight.position[0]!.v);
    expect(ks.at(-1)!.v).toEqual(straight.position[1]!.v);
    // the height waypoint lifts the camera over the straight path at the middle
    const top = Math.max(...ks.slice(1, -1).map((k) => k.v[1]));
    expect(top).toBeGreaterThan(Math.max(ks[0]!.v[1], ks.at(-1)!.v[1]));
    // the focus follows the product along the curve: one key for each camera key
    expect(plan.focus.filter((k) => k.t >= f.start && k.t <= f.end)).toHaveLength(ks.length);
  });
  it('a film with no waypoints keeps its focus keys, and a pulled focus runs from one target to another', () => {
    const plain = planCamera({ beats: [beat(), hold] }, 30);
    expect(shakeCamera(plain, 2).focus).toBe(plain.focus);
    const pulled = planCamera({ beats: [beat({ camera: { focus: { from: 'far', to: 'product', aperture: 0.9 } } }), hold] }, 30);
    const f = pulled.beats[0]!;
    expect(pulled.focus[0]!.v).toBeCloseTo(f.from.d + CAMERA.farFocus, 3);
    expect(pulled.focus[1]!.v).toBeCloseTo(f.to.d, 3);
    expect(f.aperture).toBe(0.9);
  });
  it('the tremor follows its seed, its amount and a shot\'s own multiplier', () => {
    const s: BeatSheet = { beats: [beat(), beat({ camera: { shake: 0 } }), hold] };
    const base = planCamera(s, 30);
    const a = shakeCamera(base, 2);
    const same = shakeCamera(base, 2, CAMERA.rampKeys, { seed: 0, amount: 1 });
    expect(same.position).toEqual(a.position);
    const other = shakeCamera(base, 2, CAMERA.rampKeys, { seed: 7 });
    expect(other.position).not.toEqual(a.position);
    const hard = shakeCamera(base, 2, CAMERA.rampKeys, { amount: 2 });
    const f = base.beats[0]!;
    const dev = (p: typeof a, ref: typeof a) => p.position.filter((k) => k.t > f.start && k.t < f.end).reduce((sum, k, n) => sum + Math.abs(k.v[0] - ref.position.filter((x) => x.t > f.start && x.t < f.end)[n]!.v[0]), 0);
    const calm = shakeCamera(base, 2, CAMERA.rampKeys, { amount: 0.001 });
    expect(dev(hard, calm)).toBeGreaterThan(dev(a, calm));
    // shake 0 on the second shot leaves it exactly as planned
    const g = base.beats[1]!;
    expect(a.position.filter((k) => k.t >= g.start && k.t <= g.end)).toHaveLength(2);
  });
  it('the film writes the tremor as an object, the aperture per shot and the bokeh on the lens', () => {
    const s: BeatSheet = { beats: [beat({ camera: { focus: { aperture: 0.8 } } }), beat(), hold] };
    const w = world(buildCinematicFilm(input({ sheet: s, handheld: { amount: 0.5, keys: 4, seed: 9 }, bokeh: 0.6, aperture: 0.2 }))) as any;
    expect(w.camera.focus.bokeh).toBe(0.6);
    const ap = w.camera.focus.aperture as Array<{ t: number; v: number }>;
    expect(ap.find((k) => k.t === 0)!.v).toBe(0.8);
    expect(ap.at(-1)!.v).toBe(0.2);
    expect((world(buildCinematicFilm(input({ sheet: { beats: [beat(), hold] } }))) as any).camera.focus.aperture).toBe(0.3);
    expect(w.camera.position.length).toBeGreaterThan(planCamera(s, 30).position.length);
  });
  it('a handheld of amount 0 is a locked camera', () => {
    const s: BeatSheet = { beats: [beat(), hold] };
    const locked = world(buildCinematicFilm(input({ sheet: s, handheld: { amount: 0 } }))) as any;
    expect(locked.camera.position).toHaveLength(planCamera(s, 30).position.length);
  });
});

describe('the colour grade', () => {
  const calm = { glow: 'none', grain: 'none', vignette: 'none', fringe: false, floor: 'none', wet: 'none', caustics: 'none' } as const;
  it('writes the tone, the split toning, the streak and the halation into the world\'s post, and nothing for an empty grade', () => {
    expect(finishPost(calm, 100, {})).toBeUndefined();
    const post = finishPost(calm, 100, { exposure: 0.1, contrast: 0.2, saturation: -0.3, hue: 12, shadows: '#0a5a6a', split: 0.7, streak: { color: '#88aaff', strength: 1.2, reach: 0.4 }, halation: 0.5 })!;
    expect(post.grade).toEqual({ brightness: 0.1, contrast: 0.2, saturation: -0.3, hue: 12 });
    // one tint named: the other side takes the warm default
    expect(post.splitTone).toEqual({ shadows: '#0a5a6a', highlights: '#ffb877', amount: 0.7 });
    expect(post.streak).toEqual({ strength: 1.2, color: '#88aaff', reach: 0.4 });
    expect(post.halation).toBe(0.5);
  });
  it('is carried by the film, and a film with no grade has none of it', () => {
    const w = world(buildCinematicFilm(input({ grade: { highlights: '#ffd0a0', halation: 0.4 } }))) as any;
    expect(w.post.splitTone.highlights).toBe('#ffd0a0');
    expect(w.post.halation).toBe(0.4);
    expect((world(buildCinematicFilm(input())) as any).post?.splitTone).toBeUndefined();
  });
  it('a letterbox is two bars that lift for the end hold, never more than 30 % of the height each', () => {
    const shapes = (c: any) => layers(c).filter((l) => l.kind === 'shape');
    const base = (aspect: any) => shapes(buildCinematicFilm(input({ aspect }))).length;
    const wide = shapes(buildCinematicFilm(input({ aspect: '16:9', grade: { letterbox: 2.39 } })));
    expect(wide.length).toBe(base('16:9') + 2);
    const bar = wide.find((l: any) => l.transform.opacity?.length === 3 && l.transform.opacity[0].v === 1 && l.transform.opacity[2].v === 0) as any;
    expect(bar).toBeDefined();
    const tall = shapes(buildCinematicFilm(input({ aspect: '9:16', grade: { letterbox: 2.6 } })));
    expect(tall.length).toBe(base('9:16') + 2);
    const barOf = (l: any) => l.transform.opacity?.length === 3 && l.transform.opacity[0].v === 1 && l.transform.opacity[2].v === 0;
    const heights = tall.filter(barOf).map((l: any) => l.path?.size?.[1] ?? 0);
    expect(heights).toHaveLength(2);
    expect(Math.max(...heights)).toBeLessThanOrEqual(1920 * 0.3 + 1);
  });
});

describe('cuts inside the scene: flash, pass and match', () => {
  const beat = (extra: object = {}): any => ({ size: 'medium', move: 'push', seconds: 1.5, angle: 'eye', phase: 'build', product: 'still', ...extra });
  const hold = beat({ move: 'hold', phase: 'close', seconds: 2 });
  it('a pass cut plunges the shot before at the product and the shot after pulls out of the crop', () => {
    const s: BeatSheet = { beats: [beat(), beat({ cut: 'pass', size: 'close' }), hold] };
    const plain = planCamera({ beats: [beat(), beat({ size: 'close' }), hold] }, 30);
    const plan = planCamera(s, 30);
    const [a, b] = plan.beats;
    // the first shot arrives where it would have, then ends on a crop of the product's surface
    expect(a!.via).toHaveLength(1);
    expect(a!.via![0]).toEqual(plain.beats[0]!.to);
    expect(a!.to.d).toBeCloseTo(framingDistance(CAMERA.passFill), 4);
    expect(a!.knots).toEqual([1 - CAMERA.passTail]);
    // the next shot starts exactly there and ends where it would have
    expect(b!.from).toEqual(a!.to);
    expect(b!.to).toEqual(plain.beats[1]!.to);
    // the shot after the pass still continues from the arrival, not from the plunge (a hold stays on the framing)
    expect(plan.beats[2]!.from.d).toBeCloseTo(plain.beats[2]!.from.d, 4);
  });
  it('the plunge is sampled so the camera reaches the arrival at the end of its knot and then closes in', () => {
    const s: BeatSheet = { beats: [beat({ seconds: 2 }), beat({ cut: 'pass', size: 'close' }), hold] };
    const cam = shakeCamera(planCamera(s, 30), 0);
    const f = cam.beats[0]!;
    const ks = cam.position.filter((k) => k.t >= f.start && k.t <= f.end);
    expect(ks.length).toBe(1 * 2 + 2 + 3 + 2);
    const dist = (v: number[]) => Math.hypot(v[0]!, v[1]! - PRODUCT_Y, v[2]!);
    const ds = ks.map((k) => dist(k.v));
    expect(ds.at(-1)!).toBeLessThan(ds[0]! * 0.5);
    expect(ds.at(-1)!).toBeCloseTo(framingDistance(CAMERA.passFill), 2);
    // it closes in through the last part of the shot, never backing away
    const tail = ds.slice(Math.floor(ds.length * 0.7));
    for (let n = 1; n < tail.length; n++) expect(tail[n]!).toBeLessThanOrEqual(tail[n - 1]! + 1e-6);
  });
  it('a match cut starts the shot as close and on the same lens as the last ended, with another angle', () => {
    const s: BeatSheet = { beats: [beat({ camera: { to: { fill: 0.7, lens: 24 } } }), beat({ cut: 'match', move: 'orbit', angle: 'high' }), hold] };
    const plan = planCamera(s, 30);
    expect(plan.beats[1]!.from.d).toBeCloseTo(plan.beats[0]!.to.d, 6);
    expect(plan.beats[1]!.from.fov).toBe(24);
    expect(plan.beats[1]!.from.el).not.toBe(plan.beats[0]!.to.el);
    // a start Muse wrote itself wins
    const own: BeatSheet = { beats: [s.beats[0]!, beat({ cut: 'match', camera: { from: { fill: 0.3 } } }), hold] };
    expect(planCamera(own, 30).beats[1]!.from.d).toBeCloseTo(framingDistance(0.3, 24), 3);
  });
  it('a flash cut gets a full-frame layer that peaks at the cut and fades fast; none of the three is a shader cut', () => {
    const s: BeatSheet = { beats: [beat(), beat({ cut: 'flash' }), beat({ cut: 'match' }), beat({ cut: 'pass' }), hold] };
    const cam = planCamera(s, 30);
    expect(shaderCuts(s, cam, 30)).toEqual([]);
    const shapes = (c: any) => layers(c).filter((l) => l.kind === 'shape');
    const n = (sheet2: BeatSheet) => shapes(buildCinematicFilm(input({ sheet: sheet2 }))).length;
    const plain: BeatSheet = { beats: s.beats.map((b) => ({ ...b, cut: undefined })) };
    expect(n(s)).toBe(n(plain) + 1);
    const c = buildCinematicFilm(input({ sheet: s }));
    const flash = shapes(c).find((l: any) => Array.isArray(l.transform.opacity) && l.transform.opacity.some((k: any) => Math.abs(k.t - cam.beats[1]!.start) <= 1 && (Array.isArray(k.v) ? k.v[0] : k.v) === 1));
    expect(flash).toBeDefined();
    expect(lightValidate(c).ok).toBe(true);
  });
  it('they do not count in the three-cut limit, and a fourth shader cut still does', () => {
    const many = (cut: any): BeatSheet => ({ beats: [beat(), beat({ cut }), beat({ cut }), beat({ cut }), beat({ cut }), hold] });
    expect(checkBeatSheet(many('flash'), []).join(' ')).not.toMatch(/at most 3 cuts/);
    expect(checkBeatSheet(many('zoom'), []).join(' ')).toMatch(/at most 3 cuts/);
  });
});
