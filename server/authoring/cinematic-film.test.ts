import { describe, expect, it } from 'vitest';
import { lightValidate } from '../engine/light-validator';
import { defaultBeatSheet, totalSeconds, type BeatSheet } from './beatsheet';
import { ELEVATION, FILL, FOV_BASE, FOV_WIDE, LIMITS, PRODUCT_H, buildCinematicFilm, framingDistance, planCamera, type CinematicInput } from './cinematic-film';
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
  it('a push arrives at the distance that fills the size and starts 35 % further away', () => {
    const b = plan.beats[0]!; // wide push
    expect(b.to.d).toBeCloseTo(framingDistance(FILL.wide), 4);
    expect(b.from.d).toBeCloseTo(b.to.d * 1.35, 4);
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
    const high = can.position.find((k: any) => k.v[1] > 0.5);
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
