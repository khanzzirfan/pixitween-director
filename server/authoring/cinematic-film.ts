import { formatPrice } from '@shared/catalog';
import { ASPECT_SIZES } from '@shared/composition';
import { newFilmComposition, registerAsset } from './composition';
import { addLayer, type AddLayerOptions } from './layers';
import { readDirector, writeDirector, sceneMeta } from './meta';
import { effectiveAngles, effectiveSizes, totalSeconds, type Angle, type Beat, type BeatSheet, type KeyLevel, type ShotSize, type Tone } from './beatsheet';
import type { IngredientAsset } from './ingredients';
import { shade, type ClipAsset, type Rect } from './retail-clip';
import { addScene } from './scenes';
import { setKeyframes } from './transform';
import type { Aspect, Comp, Obj } from './types';
import { inkOn, tint, typeIn, words } from './variant-film';
import type { PrimitiveShape } from '../product3d/types';

// The cinematic film: one beat sheet played in one stage3d world (engine aep-32, schema 1.12.0). The camera cuts between shots and
// moves inside each one; the product (a prop3d can wearing the unwrapped label) tumbles in, turns under a moving key light and holds
// its place; ingredients are swarms, glass cubes and cards round it. Brand, name and price are 2D layers over the world.
// Pure and deterministic: the same sheet and assets give the same JSON, and every position comes from a closed formula of the frame.
//
// Units are metres, Y up, the ground at y = 0. A prop's position is its BOTTOM (the engine normalises it so), so the can stands at y = 0 and the camera looks at its centre, PRODUCT_Y.
// Engine spec: reacthub-pixitweenjs/specs/features/aep-32-stage3d-cinematic.

export const SCHEMA = '1.12.0';
const ID = 'cine';
export const PRODUCT_H = 0.16;
export const PRODUCT_Y = PRODUCT_H / 2;
export const FOV_BASE = 30;
export const FOV_WIDE = 80;
/** Camera height as an angle above the product's centre: low looks up at it, high looks down. */
export const ELEVATION: Record<Angle, number> = { low: -3, eye: 7, high: 28 };
/** How much of the frame's height the product fills at each size. The macro frames the label band and the name above it, about two thirds of the can. */
export const FILL: Record<ShotSize, number> = { wide: 0.32, medium: 0.5, close: 0.8, macro: 1.5 };
/** The lens blur. Low enough that the can's edges stay crisp in every shot; the focus distance follows the camera. */
export const APERTURE = 0.3;
/** Engine limits (STAGE3D_LIMITS in aep-32). */
export const LIMITS = { props: 12, instances: 400, swarm: 200 } as const;

export interface CinematicInput {
  aspect: Aspect;
  sheet: BeatSheet;
  /** The product's textures from prepareProduct3D. */
  texture: ClipAsset & { kind: 'label' | 'front' };
  shape: PrimitiveShape;
  side: string;
  /** Height over width of the product. */
  productAspect: number;
  title: string;
  price: number;
  wasPrice?: number;
  currency?: string;
  brand?: string;
  accent: string;
  /** The ingredients made for this product, by kind. A beat whose kind is missing plays without it. */
  ingredients?: Record<string, IngredientAsset>;
  /** The board's light: the key light's colour and how dark or bright the world is. */
  tone?: Tone;
  key?: KeyLevel;
  bpm?: number;
  music?: { id: string; src: string; level?: number };
}

type V3 = [number, number, number];
type Bez = [number, number, number, number];
const EASE_OUT: Bez = [0.16, 1, 0.3, 1];
const EASE_IN_OUT: Bez = [0.42, 0, 0.58, 1];
const LINEAR: Bez = [0, 0, 1, 1];
const r = (n: number) => Math.round(n * 1e4) / 1e4;
const r2 = (n: number) => Math.round(n * 100) / 100;
const rad = (d: number) => (d * Math.PI) / 180;

interface Key<T> {
  t: number;
  v: T;
  easeIn?: Bez;
  easeOut?: Bez;
  hold?: boolean;
}
const key = <T>(t: number, v: T, e?: Bez, hold?: boolean): Key<T> => ({ t, v, ...(e ? { easeIn: e, easeOut: e } : {}), ...(hold ? { hold: true } : {}) });

/** Distance from the target that makes the product fill `fill` of the frame's height at lens `fov`. */
export const framingDistance = (fill: number, fov = FOV_BASE, productH = PRODUCT_H): number => productH / (fill * 2 * Math.tan(rad(fov) / 2));

interface Pose {
  /** metres from the target */
  d: number;
  /** degrees round the product, 0 = straight on */
  az: number;
  fov: number;
  /** degrees above the product's centre */
  el: number;
}
const positionOf = (p: Pose): V3 => {
  const el = rad(p.el);
  return [r(Math.sin(rad(p.az)) * Math.cos(el) * p.d), r(PRODUCT_Y + Math.sin(el) * p.d), r(Math.cos(rad(p.az)) * Math.cos(el) * p.d)];
};

export interface BeatFrames {
  /** first and last frame of the shot */
  start: number;
  end: number;
  size: ShotSize;
  move: Beat['move'];
  from: Pose;
  to: Pose;
}
export interface CameraPlan {
  beats: BeatFrames[];
  position: Array<Key<V3>>;
  fov: Array<Key<number>>;
  focus: Array<Key<number>>;
  frames: number;
}

/**
 * The camera for a sheet. Every shot is a cut: it starts at its own pose and moves to its arrival pose. A push comes in from 35 % further
 * away, a pull from 30 % closer, a hold creeps in 8 %, an orbit swings 44 degrees round the product, and a dolly-zoom widens the lens from 30 to 80
 * degrees while the distance shrinks so the product keeps its size (distance times tan(fov/2) is constant). A hold after a dolly-zoom stays at
 * the wide lens, so the film ends on the reveal.
 */
export function planCamera(sheet: BeatSheet, fps: number): CameraPlan {
  const sizes = effectiveSizes(sheet);
  const angles = effectiveAngles(sheet);
  const beats: BeatFrames[] = [];
  const position: Array<Key<V3>> = [];
  const fov: Array<Key<number>> = [];
  const focus: Array<Key<number>> = [];
  let cur: Pose = { d: framingDistance(FILL.medium), az: 0, fov: FOV_BASE, el: ELEVATION.eye };
  let clock = 0;
  const frames = Math.round(totalSeconds(sheet) * fps);
  sheet.beats.forEach((b, i) => {
    const start = Math.round(clock * fps);
    clock += b.seconds;
    const last = i === sheet.beats.length - 1;
    const end = last ? frames : Math.round(clock * fps) - 1;
    const size = sizes[i]!;
    const el = ELEVATION[angles[i]!];
    const arrive = framingDistance(FILL[size]);
    const az0 = ((i * 37) % 21) - 10;
    let from: Pose;
    let to: Pose;
    let ease: Bez = EASE_OUT;
    switch (b.move) {
      case 'push':
        from = { d: arrive * 1.35, az: az0, fov: FOV_BASE, el };
        to = { d: arrive, az: az0 * 0.5, fov: FOV_BASE, el };
        break;
      case 'pull':
        from = { d: arrive * 0.7, az: az0, fov: FOV_BASE, el };
        to = { d: arrive, az: az0 * 0.5, fov: FOV_BASE, el };
        break;
      case 'orbit':
        from = { d: arrive, az: -22, fov: FOV_BASE, el };
        to = { d: arrive, az: 22, fov: FOV_BASE, el };
        ease = EASE_IN_OUT;
        break;
      case 'dolly-zoom': {
        from = { d: arrive, az: az0 * 0.4, fov: FOV_BASE, el };
        to = { d: r(arrive * (Math.tan(rad(FOV_BASE / 2)) / Math.tan(rad(FOV_WIDE / 2)))), az: az0 * 0.4, fov: FOV_WIDE, el };
        ease = LINEAR;
        break;
      }
      default: {
        // hold: continues from where the last shot ended (after a dolly-zoom that is the wide lens), creeping in 8 %
        to = { ...cur };
        from = { d: cur.d * 1.08, az: cur.az, fov: cur.fov, el: cur.el };
        ease = EASE_IN_OUT;
      }
    }
    beats.push({ start, end, size, move: b.move, from, to });
    position.push(key(start, positionOf(from), ease), key(end, positionOf(to), ease, !last));
    fov.push(key(start, from.fov, ease), key(end, to.fov, ease, !last));
    // the product stays in focus: the focus distance is the camera's distance to it
    focus.push(key(start, r(from.d), ease), key(end, r(to.d), ease, !last));
    cur = to;
  });
  return { beats, position, fov, focus, frames };
}

// ---- layer helpers (the scene's 2D layers go through addLayer like every other clip) ----

const layersOf = (c: Comp): Obj[] => (c.precomps as Record<string, Obj>)[ID]!.layers as Obj[];
function add(c: Comp, o: Omit<AddLayerOptions, 'sceneId'>, retag = false): { c: Comp; id: string } {
  const before = new Set(layersOf(c).map((l) => l.id));
  let out = addLayer(c, { sceneId: ID, ...o });
  const id = layersOf(out).find((l) => !before.has(l.id))!.id;
  if (retag) {
    const meta = readDirector(out);
    meta.layers[id] = { ...meta.layers[id]!, role: 'subject', z: o.z ?? 0 };
    out = writeDirector(out, meta);
  }
  return { c: out, id };
}
function patch(c: Comp, id: string, fn: (l: Obj) => void): Comp {
  const out = structuredClone(c);
  fn(layersOf(out).find((x) => x.id === id)!);
  return out;
}
function shape(c: Comp, box: Rect, fill: string, z: number, path?: Obj, look?: (l: Obj) => void): { c: Comp; id: string } {
  const s = add(c, { role: 'bg', kind: 'shape', fill, box, z }, true);
  return { c: patch(s.c, s.id, (l) => { if (path) l.path = path; look?.(l); }), id: s.id };
}

/** Puts the world and then its members into the scene by depth (layers run farthest first): after the 2D field and halo (z 12 and 11), before the copy. */
function insertStage(c: Comp, world: Obj, members: Obj[]): Comp {
  const out = structuredClone(c);
  const layers = layersOf(out);
  const meta = readDirector(out);
  let at = layers.findIndex((l) => (meta.layers[l.id]?.z ?? 0) < 5);
  if (at < 0) at = layers.length;
  layers.splice(at, 0, world, ...members);
  meta.layers[world.id] = { sceneId: ID, role: 'stage3d', z: 5 };
  for (const m of members) meta.layers[m.id] = { sceneId: ID, role: 'prop3d', z: 5 };
  Object.assign(out, writeDirector(out, meta));
  return out;
}

/** A film asset is also copied into the scene's own asset map, where the engine looks for the scene's layers. */
function share(c: Comp, assetId: string): Comp {
  const out = structuredClone(c);
  const a = (out.assets as Record<string, Obj>)[assetId];
  if (a) ((out.precomps as Record<string, Obj>)[ID]!.assets as Record<string, Obj>)[assetId] = structuredClone(a);
  return out;
}

// ---- ingredients ----

const hash = (n: number) => (n * 2654435761) >>> 0;

interface Planned {
  beat: number;
  layer: Obj;
  instances: number;
}

/** The prop for one beat's ingredient, or undefined when the asset is missing or the action does not suit the kind. */
function ingredientProp(i: number, b: Beat, f: BeatFrames, a: IngredientAsset | undefined): Planned | undefined {
  if (!b.ingredient || !a) return undefined;
  const act = b.ingredient.action;
  const id = `${ID}:ing${i}-${a.kind}`;
  const inPoint = f.start;
  const base = { id, name: `${a.kind} ${act}`, kind: 'prop3d', stage: `${ID}:world`, inPoint, outPoint: Math.min(f.end + (act === 'fall' || act === 'burst' ? 12 : 1), 10 ** 6) };
  const sec = b.seconds;

  if (a.use === 'card') {
    if (act === 'splash') {
      const source: Obj = a.frames.length > 1 ? { type: 'card', frames: a.frames.map((x) => x.id), fps: 24 } : { type: 'card' };
      return { beat: i, instances: 1, layer: { ...base, source, ...(a.frames.length > 1 ? {} : { textures: { front: a.frames[0]!.id } }), size: a.sizeM, position: [0, 0.01, 0.06], lit: false } };
    }
    // swirl: drifts across behind the product and rolls a little
    return {
      beat: i,
      instances: 1,
      layer: {
        ...base,
        source: { type: 'card' },
        textures: { front: a.frames[0]!.id },
        size: a.sizeM,
        position: [key(inPoint, [-0.06, r(PRODUCT_Y - a.sizeM / 2 + 0.02), -0.07]), key(f.end, [0.06, r(PRODUCT_Y - a.sizeM / 2 + 0.05), -0.07])],
        rotation: [key(inPoint, [0, 0, -10]), key(f.end, [0, 0, 16])],
      },
    };
  }

  const seed = 11 + (hash(i + 1) % 997);
  const glass = a.procedural === 'glass-cube';
  const source: Obj = glass
    ? { type: 'primitive', shape: 'box', proportions: { width: 1, height: 1 } }
    : { type: 'extrude', contour: a.contour ?? [[0, 0], [1, 0], [1, 1], [0, 1]], depth: r2(Math.max(a.frames[0]?.width ?? 100, a.frames[0]?.height ?? 100) * 0.25), bevel: r2(Math.max(a.frames[0]?.width ?? 100, 1) * 0.03) };
  const look: Obj = glass
    ? { material: { color: '#dff3ff', roughness: 0.05, transmission: 1, ior: 1.31, thickness: 0.02 } }
    : { textures: { ...(a.frames[0] ? { front: a.frames[0].id } : {}), side: a.side ?? '#3b2416' }, material: { roughness: 0.45, clearcoat: 0.3 } };
  const count = act === 'fall' ? 40 : act === 'burst' ? 30 : glass ? 6 : 14;
  const swarm: Obj =
    act === 'fall'
      ? { count, seed, motion: 'fall', emitter: { shape: 'box', center: [0, 0.45, 0.1], size: [0.5, 0.05, 0.4] }, direction: [0, -1, 0], speed: 0.1, gravity: 3, spin: 300, stagger: r2(sec * 0.8), sizeJitter: 0.2 }
      : act === 'burst'
        ? { count, seed, motion: 'burst', emitter: { shape: 'point', center: [0, PRODUCT_Y, 0] }, direction: [0, 1, 0.3], spread: 70, speed: 0.9, drag: 2.2, gravity: 2, spin: 240, stagger: 0.1, sizeJitter: 0.2 }
        : act === 'orbit'
          ? { count, seed, motion: 'orbit', emitter: { shape: 'point', center: [0, PRODUCT_Y, 0] }, orbit: { radius: 0.13, angularSpeed: 40, height: 0.12, bob: 0.01 }, spin: 60, growFrames: 6, sizeJitter: 0.25 }
          : { count, seed, motion: 'drift', emitter: { shape: 'sphere', center: [0, PRODUCT_Y, 0], radius: 0.25 }, drift: {}, spin: 40, sizeJitter: 0.3 };
  return { beat: i, instances: count, layer: { ...base, source, size: a.sizeM, ...look, swarm } };
}

/** Trims the swarms until the world holds at most LIMITS.instances copies: each swarm keeps its share, never below 4. */
function fitInstances(planned: Planned[]): Planned[] {
  const total = planned.reduce((s, p) => s + p.instances, 0);
  const budget = LIMITS.instances - 1;
  if (total <= budget) return planned;
  const k = budget / total;
  return planned.map((p) => {
    if (!p.layer.swarm) return p;
    const n = Math.max(4, Math.min(LIMITS.swarm, Math.floor(p.layer.swarm.count * k)));
    return { ...p, instances: n, layer: { ...p.layer, swarm: { ...p.layer.swarm, count: n } } };
  });
}

/** Keys strictly increasing in time: sorted, and where two share a frame the later one wins. */
function uniq<T>(ks: Array<Key<T>>): Array<Key<T>> {
  const out: Array<Key<T>> = [];
  for (const k of [...ks].sort((a, b) => a.t - b.t)) {
    if (out.at(-1)?.t === k.t) out.pop();
    out.push(k);
  }
  return out;
}

/**
 * The product's turn and rise, from the shots' product field: a drop-in rises from above spinning (once the lens has settled), a turn swings
 * it 45 degrees through the shot, still holds the yaw it has, and the label macro faces the lens (yaw 0) at its middle.
 */
function productMoves(sheet: BeatSheet, cam: CameraPlan, land: number, frames: number): { yaw: Array<Key<V3>>; rise: Array<Key<V3>> } {
  let at = -28;
  const yaw: Array<Key<V3>> = [key(0, [4, at, 0])];
  const rise: Array<Key<V3>> = [key(0, [0, 0, 0])];
  cam.beats.forEach((f, n) => {
    const pm = sheet.beats[n]!.product ?? 'still';
    if (pm === 'drop') {
      const dur = Math.max(3, Math.min(land, f.end - f.start));
      if (f.start > 0) rise.push(key(f.start - 1, [0, 0, 0], undefined, true));
      rise.push(key(f.start, [0, 0.6, 0], EASE_OUT), key(f.start + dur, [0, 0, 0]));
      yaw.push(key(f.start, [4, at - 220, -24], EASE_OUT), key(f.start + dur, [4, at, 0], EASE_IN_OUT));
    } else if (pm === 'turn') {
      yaw.push(key(f.start, [4, at, 0], EASE_IN_OUT));
      at += 45;
      yaw.push(key(f.end, [4, at, 0], EASE_IN_OUT));
    } else {
      yaw.push(key(f.start, [4, at, 0]));
    }
    if (f.size === 'macro') {
      at = 0;
      yaw.push(key(Math.round((f.start + f.end) / 2), [4, 0, 0], EASE_IN_OUT));
    }
  });
  yaw.push(key(frames, [4, at, 0]));
  return { yaw: uniq(yaw), rise: uniq(rise) };
}

/**
 * The cuts the board names: a wipe is a quick dip to the dark field across the cut, a cloud a bloom of the key light that fills the frame
 * and clears. One full-frame layer each, above the world and under the copy; the first shot has nothing to cut from.
 */
function cutLayers(c: Comp, sheet: BeatSheet, cam: CameraPlan, fps: number, [W, H]: [number, number], dark: string, light: string): Comp {
  let out = c;
  const D = totalSeconds(sheet);
  for (const [kind, color, peak, lead, tail] of [['wipe', dark, 1, 0.08, 0.12], ['cloud', light, 0.85, 0.05, 0.22]] as const) {
    const ks: Array<[number, number]> = [[0, 0]];
    cam.beats.forEach((f, n) => {
      if (n === 0 || sheet.beats[n]!.cut !== kind) return;
      const t0 = f.start / fps;
      ks.push([r(Math.max(0, t0 - lead)), 0], [r(t0), peak], [r(Math.min(D, t0 + tail)), 0]);
    });
    if (ks.length < 3) continue;
    // z counts depth: the world is 5 and the copy under 1, so 4 lies over the world and under the copy
    const layer = shape(out, { x: 0, y: 0, w: W, h: H }, color, 4);
    out = setKeyframes(layer.c, layer.id, 'opacity', dedupe(ks), 'easeOut');
  }
  return out;
}

/** The film. Throws when the sheet has no beats. */
export function buildCinematicFilm(i: CinematicInput): Comp {
  if (!i.sheet.beats.length) throw new Error('a cinematic film needs at least one beat');
  const { width: W, height: H } = ASPECT_SIZES[i.aspect];
  const u = Math.min(W, H);
  const portrait = H > W;
  const D = totalSeconds(i.sheet);
  const sizes = effectiveSizes(i.sheet);
  let c = newFilmComposition({ aspect: i.aspect, title: `${i.brand ?? i.title}: cinematic`, palette: [i.accent] });
  const fps = c.fps as number;
  c = addScene(c, { id: ID, durationSec: D, mode: 'motion', intent: `Cinematic 3D film: ${i.sheet.beats.map((b) => `${b.size} ${b.move}`).join(', ')}` });
  const frames = sceneMeta(c, ID).durationFrames;
  const cam = planCamera(i.sheet, fps);
  const holdBeat = cam.beats.at(-1)!;
  const holdStart = holdBeat.start / fps;
  const macro = cam.beats.find((b) => b.size === 'macro');
  // the board's light: key colour, and how dark or bright the world is
  const keyLevel = i.key ?? 'mid';
  const keyColor = i.tone === 'warm' ? '#ffd7a3' : i.tone === 'cool' ? '#bcd6ff' : tint(i.accent, 0.7);
  const fieldColor = keyLevel === 'high' ? tint(i.accent, 0.9) : shade(i.tone && i.tone !== 'neutral' ? keyColor : i.accent, keyLevel === 'low' ? 0.93 : 0.85);
  const haloGain = keyLevel === 'low' ? 0.6 : 1;
  const exposure = keyLevel === 'low' ? 0.95 : keyLevel === 'high' ? 1.3 : 1.1;

  // the 2D world under the 3D one: a near-black field and a warm halo behind the product that follows its size from shot to shot
  c = shape(c, { x: 0, y: 0, w: W, h: H }, fieldColor, 12).c;
  const pcx = W / 2;
  const pcy = H * 0.5;
  const hd = H * 0.46;
  const halo = shape(c, { x: pcx - hd / 2, y: pcy - hd / 2, w: hd, h: hd }, i.tone && i.tone !== 'neutral' ? shade(keyColor, 0.45) : tint(i.accent, 0.3), 11, { kind: 'ellipse', size: [hd, hd] }, (l) => {
    l.effects = [{ name: 'gaussian-blur', params: { blurriness: r2(hd * 0.1) } }];
  });
  c = halo.c;
  const haloScale: Array<[number, number]> = [];
  const haloOp: Array<[number, number]> = [[0, 0]];
  cam.beats.forEach((b, n) => {
    const s = (FILL[b.size] / FILL.medium) * (b.move === 'dolly-zoom' ? 1.35 : 1);
    const t0 = b.start / fps;
    // a shot's last frame is one frame before the next shot's first, so the halo cuts with the camera
    const t1 = n === cam.beats.length - 1 ? D : b.end / fps;
    haloScale.push([r(t0), r2(Math.max(0.6, Math.min(2.6, FILL[b.size] / FILL.medium)))], [r(t1), r2(Math.max(0.6, Math.min(2.6, s)))]);
    haloOp.push([r(Math.max(t0, 0.3)), r2((b.size === 'macro' ? 0.45 : 0.85) * haloGain)]);
  });
  c = setKeyframes(c, halo.id, 'scale', dedupe(haloScale), 'easeInOut');
  c = setKeyframes(c, halo.id, 'opacity', dedupe(haloOp), 'easeOut');

  // assets: the product's textures and every picture an ingredient plays
  c = registerAsset(c, { id: i.texture.id, kind: 'image', src: i.texture.src, width: i.texture.width, height: i.texture.height });
  const used = new Set<string>([i.texture.id]);
  const planned: Planned[] = [];
  i.sheet.beats.forEach((b, n) => {
    const a = b.ingredient ? i.ingredients?.[b.ingredient.kind] : undefined;
    const p = ingredientProp(n, b, cam.beats[n]!, a);
    if (p && a) {
      planned.push(p);
      for (const f of a.frames) {
        if (!used.has(f.id)) {
          c = registerAsset(c, { id: f.id, kind: 'image', src: f.src, width: f.width, height: f.height });
          used.add(f.id);
        }
      }
    }
  });
  const props = fitInstances(planned).slice(0, LIMITS.props - 1);
  for (const id of used) c = share(c, id);

  // the product: lands from above in the first shot, then turns slowly; during the macro the label faces the camera
  const land = Math.round(0.8 * fps);
  const turnEnd = Math.max(land + 6, Math.round((cam.beats.find((b) => b.move === 'dolly-zoom')?.start ?? holdBeat.start) ));
  let yaw: Array<Key<V3>> = [key(0, [4, -250, -24], EASE_OUT), key(land, [4, -28, 0], EASE_IN_OUT)];
  if (macro && macro.start > land + 3) yaw.push(key(Math.round((macro.start + macro.end) / 2), [4, 0, 0], EASE_IN_OUT));
  yaw.push(key(Math.max(turnEnd, (yaw.at(-1)?.t ?? 0) + 3), [4, 22, 0], EASE_IN_OUT), key(frames, [4, 16, 0]));
  let rise: Array<Key<V3>> = [key(0, [0, 0.6, 0], EASE_OUT), key(land, [0, 0, 0])];
  if (i.sheet.beats.some((b) => b.product)) ({ yaw, rise } = productMoves(i.sheet, cam, land, frames));
  const can: Obj = {
    id: `${ID}:product`,
    name: 'Product',
    kind: 'prop3d',
    role: 'product',
    stage: `${ID}:world`,
    inPoint: 0,
    outPoint: frames,
    source: { type: 'primitive', shape: i.shape, proportions: { width: 1, height: r2(Math.max(0.3, i.productAspect)) } },
    textures: { label: i.texture.id, side: i.side },
    size: PRODUCT_H,
    material: { roughness: 0.3, metalness: 0.6, clearcoat: 0.8 },
    position: rise,
    rotation: yaw,
  };

  const world: Obj = {
    id: `${ID}:world`,
    name: 'World',
    kind: 'stage3d',
    inPoint: 0,
    outPoint: frames,
    transform: { position: [W / 2, H / 2], anchor: [W / 2, H / 2], scale: [1, 1], rotation: 0, opacity: 1 },
    viewport: { width: W, height: H },
    camera: { position: cam.position, target: [0, PRODUCT_Y, 0], fov: cam.fov, focus: { distance: cam.focus, aperture: APERTURE } },
    set: { ground: 'none', wall: false },
    style: { shading: 'pbr', exposure },
    shadow: { opacity: 0.45, softness: 0.7 },
    lights: {
      preset: 'studio',
      key: { azimuth: [key(0, -70, EASE_IN_OUT), key(land, -70, EASE_IN_OUT), key(Math.max(turnEnd, land + 6), 45, LINEAR), key(frames, 45)], elevation: 55, color: keyColor },
      rim: { intensity: [key(0, 0.6, EASE_IN_OUT), key(Math.max(turnEnd, land + 6), 0.6, EASE_IN_OUT), key(frames, 1.4)] },
    },
  };
  c = insertStage(c, world, [can, ...props.map((p) => p.layer)]);
  c = cutLayers(c, i.sheet, cam, fps, [W, H], fieldColor, keyColor);
  c = structuredClone(c);
  c.version = SCHEMA as never;
  ((c.precomps as Record<string, Obj>)[ID] as Obj).version = SCHEMA;

  // copy: brand over the first shots, gone for the macro, then brand, name and price in the end hold
  const ink = keyLevel === 'high' ? shade(i.accent, 0.8) : '#ffffff';
  const top = H * (portrait ? 0.13 : 0.1);
  // the product in the end hold: how high and wide it really stands (the wide lens and the camera height make it a little bigger than its fill)
  const fill = FILL[sizes.at(-1) ?? 'medium'];
  const ph = H * fill * 1.16;
  const pw = ph / Math.max(0.3, i.productAspect);
  const canTop = H * 0.5 - ph / 2;
  const name = i.brand && i.title.startsWith(i.brand) ? i.title.slice(i.brand.length).trim() || i.title : i.title;
  const nameSize = Math.round(u * 0.09);
  // the name sits clear above the can (and the brand clear above the name); on a tall can they move up together
  const nameCy = Math.max(H * 0.07 + u * 0.11, Math.min(top + u * 0.11, canTop - nameSize * 0.9));
  if (i.brand) {
    const bm = add(c, { role: 'caption', kind: 'text', text: i.brand.toUpperCase(), z: 0.2, style: { size: Math.round(u * 0.032), weight: 700, color: keyLevel === 'high' ? shade(i.accent, 0.5) : tint(i.accent, 0.6), align: 'center' }, box: { x: W * 0.1, y: nameCy - u * 0.11, w: W * 0.8, h: u * 0.045 } });
    const fade: Array<[number, number]> = [[0, 0], [0.3, 0], [0.6, 1]];
    if (macro) fade.push([r2(macro.start / fps - 0.1), 1], [r2(macro.start / fps), 0], [r2(macro.end / fps), 0]);
    fade.push([r2(holdStart), 0], [r2(holdStart + 0.3), 1]);
    c = setKeyframes(bm.c, bm.id, 'opacity', dedupe(fade), 'easeOut');
  }
  const nm = words(c, ID, name, { cx: portrait ? W / 2 : W * 0.4, cy: nameCy, maxW: W * 0.84, size: nameSize, color: ink, boldLast: true, z: 0.2 });
  c = typeIn(nm.c, nm.ids, r2(holdStart + 0.1), nameCy);

  // the price disc beside the can when there is room for it, else under it; never over it
  const priceText = formatPrice(i.price, i.currency);
  const gap = u * 0.03;
  const room = W - W * 0.03 - (pcx + pw / 2 + gap);
  const dd = Math.min(u * 0.27, Math.max(room / 1.06, 0));
  const beside = portrait ? dd >= u * 0.19 : true;
  const ddUse = beside ? (portrait ? dd : u * 0.27) : u * 0.24;
  const dcx = !portrait ? W * 0.75 : beside ? pcx + pw / 2 + gap + (ddUse * 1.06) / 2 : pcx;
  const dcy = !portrait ? pcy : beside ? pcy + ph * 0.18 : Math.min(H - ddUse * 0.62, pcy + ph / 2 + gap + ddUse * 0.55);
  const rd = ddUse * 1.06;
  const ring = shape(c, { x: dcx - rd / 2, y: dcy - rd / 2, w: rd, h: rd }, tint(i.accent, 0.6), 0.32, { kind: 'ellipse', size: [rd, rd] });
  const disc = shape(ring.c, { x: dcx - ddUse / 2, y: dcy - ddUse / 2, w: ddUse, h: ddUse }, i.accent, 0.3, { kind: 'ellipse', size: [ddUse, ddUse] });
  const beat = 60 / (i.bpm ?? 120);
  const pulse: Array<[number, number]> = [[0, 0], [r2(holdStart), 0], [r2(holdStart + 0.25), 1.18], [r2(holdStart + 0.45), 1]];
  for (let t = holdStart + 0.45 + 2 * beat; t + 0.25 <= D; t += 2 * beat) pulse.push([r2(t - 0.2), 1], [r2(t), 1.1], [r2(t + 0.25), 1]);
  c = setKeyframes(disc.c, disc.id, 'scale', pulse, 'easeInOut');
  c = setKeyframes(c, ring.id, 'scale', pulse, 'easeInOut');
  const was = i.wasPrice !== undefined && i.wasPrice > i.price ? formatPrice(i.wasPrice, i.currency) : undefined;
  const ps = Math.round(Math.min(ddUse * 0.3, (ddUse * 0.82) / (priceText.length * 0.6)));
  const pr = add(c, { role: 'caption', kind: 'text', text: priceText, z: 0.15, style: { size: ps, weight: 800, color: inkOn(i.accent), align: 'center' }, box: { x: dcx - ddUse / 2, y: dcy - ps * 0.6 + (was ? ps * 0.25 : 0), w: ddUse, h: ps * 1.2 } });
  c = setKeyframes(pr.c, pr.id, 'scale', pulse, 'easeInOut');
  if (was) {
    const ws = Math.round(ps * 0.55);
    const wy = dcy - ps * 0.55;
    const old = add(c, { role: 'caption', kind: 'text', text: was, z: 0.15, style: { size: ws, weight: 500, color: inkOn(i.accent), align: 'center' }, box: { x: dcx - ddUse / 2, y: wy - ws * 0.6, w: ddUse, h: ws * 1.2 } });
    c = setKeyframes(old.c, old.id, 'scale', pulse, 'easeInOut');
    const lw = was.length * ws * 0.56;
    const line = shape(c, { x: dcx - lw / 2, y: wy - Math.max(2, ws * 0.05), w: lw, h: Math.max(3, ws * 0.1) }, '#ff5a6e', 0.1);
    c = setKeyframes(line.c, line.id, 'opacity', [[0, 0], [r2(holdStart + 0.3), 0], [r2(holdStart + 0.5), 1]], 'easeOut');
    c = setKeyframes(c, line.id, 'scale', pulse, 'easeInOut');
  }

  if (i.music) {
    c = registerAsset(c, { id: i.music.id, kind: 'audio', src: i.music.src });
    c = structuredClone(c);
    (c.layers as Obj[]).unshift({
      kind: 'audio', id: `${ID}:music`, name: 'music', inPoint: 0, outPoint: c.durationInFrames, assetId: i.music.id, level: i.music.level ?? 0.7,
      transform: { position: [0, 0], anchor: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
    });
  }
  return c;
}

/** Keyframe pairs at least `gap` seconds apart (the director refuses two keys on one frame): a key too close to the one before is dropped, the first wins. */
function dedupe(ks: Array<[number, number]>, gap = 0.04): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const k of ks) {
    const prev = out.at(-1);
    if (prev && k[0] - prev[0] < gap) continue;
    out.push(k);
  }
  return out;
}
