import { describe, expect, it } from 'vitest';
import { lightValidate } from '../engine/light-validator';
import { checkBeatSheet, defaultBeatSheet, totalSeconds, type BeatSheet } from './beatsheet';
import { ELEVATION, FILL, FOV_BASE, FOV_WIDE, LIMITS, PRODUCT_H, PRODUCT_Y, macroOffset, PUSH_FROM, buildCinematicFilm, cutSpeeds, framingDistance, planCamera, shakeCamera, shakeKeysPerShot, type CinematicInput } from './cinematic-film';
import { CAMERA, LIGHT, MATERIALS } from './cinematic-rules';
import { SPACE_EM } from './text-width';
import { FLOOR, floorElements, glassAsset, type IngredientAsset } from './ingredients';
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
  it('fits other aspects and throws on an empty sheet', () => {
    for (const aspect of ['16:9', '1:1'] as const) expect(() => buildCinematicFilm(input({ aspect }))).not.toThrow();
    expect(() => buildCinematicFilm(input({ sheet: { beats: [] } }))).toThrow(/at least one beat/);
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
  const canH = H * FILL.medium * 1.16;
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
  it('never shows its back or its edge: the turn stays within 30 degrees', () => {
    const p = product(buildCinematicFilm(flat()));
    const yaws = (p.rotation as Array<{ v: number[] }>).map((k) => k.v[1]!);
    expect(Math.max(...yaws.map(Math.abs))).toBeLessThanOrEqual(30);
  });
  it('swings to the other side on every turn, so no turn leaves it standing still', () => {
    const turns = defaultBeatSheet(floorElements('Stone Mug', 'home')).beats.map((b, i) => (i > 0 && i < 6 && b.size !== 'macro' ? { ...b, product: 'turn' as const } : b));
    const p = product(buildCinematicFilm(flat({ sheet: { beats: turns } })));
    const keys = (p.rotation as Array<{ t: number; v: number[] }>).map((k) => k.v[1]!);
    const moves = keys.slice(1).filter((y, n) => Math.abs(y - keys[n]!) > 1).length;
    expect(moves).toBeGreaterThanOrEqual(3);
    expect(Math.max(...keys.map(Math.abs))).toBeLessThanOrEqual(30);
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
  const withSet = (air: 'none' | 'dust' | 'bokeh' | 'spray', key?: 'low' | 'mid' | 'high') =>
    input({ ...(key ? { key } : {}), set: { look: 'beach', air, backdrop: art('ast_back'), ground: '#d8b878', dot: art('ast_dot', 128, 128) } });

  it('puts the backdrop on a 4 m wall 3.2 m behind, with a coloured floor, and registers the picture', () => {
    const c = buildCinematicFilm(withSet('none')) as any;
    const w = world(c) as any;
    expect(w.set).toEqual({ ground: '#d8b878', groundSize: [...CAMERA.groundSize], wall: { distance: 3.2, height: 4 }, backdrop: 'ast_back' });
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

describe('the checker holds the moves to the corpus', () => {
  const base = defaultBeatSheet(floorElements('Stone Mug', 'home'));
  const els2 = floorElements('Stone Mug', 'home');
  const withMoves = (moves: string[]) => ({ beats: base.beats.map((b, i) => ({ ...b, move: (moves[i] ?? b.move) as any })) });
  it('the floor sheet passes and uses a truck', () => {
    expect(checkBeatSheet(base, els2)).toEqual([]);
    expect(base.beats.some((b) => b.move === 'truck')).toBe(true);
  });
  it('asks for three different moves', () => {
    const flat = withMoves(['push', 'push', 'push', 'push', 'push', 'push']).beats;
    expect(checkBeatSheet({ beats: flat }, els2).join('|')).toMatch(/at least 3 different camera moves/);
  });
  it('asks for a truck or a crane, the moves that make parallax', () => {
    const noSlide = withMoves(['push', 'push', 'orbit', 'push', 'pull', 'dolly-zoom']);
    expect(checkBeatSheet(noSlide, els2).join('|')).toMatch(/include a truck or a crane/);
  });
  it('keeps the whip short and never first or last, the rack off the macro, and the first shot to a real hook', () => {
    expect(checkBeatSheet(withMoves(['whip']), els2).join('|')).toMatch(/hook: push, orbit or truck, not whip/);
    expect(checkBeatSheet(withMoves(['push', 'push', 'push', 'whip']), els2).join('|')).toMatch(/shot 4 is a whip/);
    expect(checkBeatSheet(withMoves(['push', 'push', 'rack']), els2).join('|')).toMatch(/rack focus needs a wide, medium or close shot/);
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
    expect(shakeKeysPerShot(7, 10)).toBe(3);
    expect(shakeKeysPerShot(7, 20)).toBe(2);
    expect(shakeKeysPerShot(7, 25)).toBe(1);
    expect(shakeKeysPerShot(10, 40)).toBe(0);
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
