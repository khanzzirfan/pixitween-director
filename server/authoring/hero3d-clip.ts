import { formatPrice } from '@shared/catalog';
import { ASPECT_SIZES } from '@shared/composition';
import { placeProduct3D } from '../product3d/authoring';
import type { PrimitiveShape } from '../product3d/types';
import { newFilmComposition, registerAsset } from './composition';
import { addLayer, type AddLayerOptions } from './layers';
import { readDirector, writeDirector } from './meta';
import { pulseKeys, shade, type ClipAsset, type Rect } from './retail-clip';
import { addScene } from './scenes';
import { setKeyframes } from './transform';
import type { Aspect, Comp, Obj } from './types';
import { inkOn, tint, typeIn, words } from './variant-film';

// The 3D hero clip (look hero-3d): the real product as a model3d layer instead of a flat cut-out, so it may turn (law 4 bans a 3D
// turn only for a flat cut-out). The grammar is the latte-can reference (06-reference-films.md): a warm halo on a dark field,
// the world moving around a product that stays put. Beats, on a 5 s clip:
//   0.0-0.8  the can tumbles in from above, spinning and tilted in the frame (R1), and lands upright
//   0.8-3.0  a slow three-quarter turn while the key light runs across the label (the light sweep, done with real light)
//   1.0      the price pops on beat 2, then pulses every second beat
//   3.0-4.0  a dolly zoom (R8): the lens widens from 20 to 80 degrees while the can holds its size on screen, so the perspective
//            deepens, and the halo and bokeh behind it grow, the vertigo read
//   4.0-5.0  hold (the end hold the references keep for the price)
// Name, brand and price are 2D layers over the 3D layer, so price edits and frame grabs work as in the retail clip.
// Pure and deterministic.

export interface Hero3DInput {
  aspect: Aspect;
  /** The textures from prepareProduct3D: the unwrapped label (round shapes) or the front face. */
  texture: ClipAsset & { kind: 'label' | 'front' };
  shape: PrimitiveShape;
  /** Side colour from prepareProduct3D, #rrggbb. */
  side: string;
  /** Height over width of the product, from prepareProduct3D. */
  productAspect: number;
  title: string;
  price: number;
  wasPrice?: number;
  currency?: string;
  brand?: string;
  /** Brand colour: the halo and the price disc. */
  accent: string;
  durationSec?: number;
  bpm?: number;
  music?: { id: string; src: string; level?: number };
}

const ID = 'hero';
const r = (n: number) => Math.round(n * 100) / 100;
/** Layer (2D) rotation for the player, which reads radians (see retail-clip.ts `deg`). */
const deg = (d: number) => r(((d * Math.PI) / 180) * 1e4) / 1e4;
const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
const EASE_IN_OUT: [number, number, number, number] = [0.42, 0, 0.58, 1];
const LINEAR: [number, number, number, number] = [0, 0, 1, 1];

/** The beat times, in seconds (exported for tests and the critic). */
export const HERO3D_BEATS = { land: 0.8, turnEnd: 3.0, dollyStart: 3.0, dollyEnd: 4.0 } as const;
/**
 * The dolly zoom is the engine's animated `camera.fov` (reacthub-pixitweenjs 0.3.4): the camera re-frames the can at every fov, so
 * the can holds its size on screen while the lens widens and the perspective deepens; nothing about the can moves or scales.
 */
const FOV_REST = 20;
const FOV_DOLLY = 80;

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

type Key3 = { t: number; v: [number, number, number]; easeIn?: [number, number, number, number]; easeOut?: [number, number, number, number] };
/** Frame keys for a vec3 or number field; each key eases into the next with `ease`. */
const keys3 = (fps: number, ks: Array<[number, [number, number, number], [number, number, number, number]?]>): Key3[] =>
  ks.map(([t, v, e]) => ({ t: Math.round(t * fps), v, ...(e ? { easeOut: e, easeIn: e } : {}) }));
const keys1 = (fps: number, ks: Array<[number, number, [number, number, number, number]?]>) =>
  ks.map(([t, v, e]) => ({ t: Math.round(t * fps), v, ...(e ? { easeOut: e, easeIn: e } : {}) }));

export function buildHero3DClip(i: Hero3DInput): Comp {
  const { width: W, height: H } = ASPECT_SIZES[i.aspect];
  const u = Math.min(W, H);
  const portrait = H > W;
  const D = Math.max(4, i.durationSec ?? 5);
  const B = HERO3D_BEATS;
  let c = newFilmComposition({ aspect: i.aspect, title: `${i.brand ?? i.title}: 3D hero`, palette: [i.accent] });
  const fps = c.fps as number;
  c = addScene(c, { id: ID, durationSec: D, mode: 'motion', intent: '3D hero: the can tumbles in, turns under a moving key light, dolly zoom, price held' });

  // where the can stands
  const ph = H * (portrait ? 0.46 : 0.62);
  const pw = ph / Math.max(0.3, i.productAspect);
  const pcx = portrait ? W / 2 : W * 0.4;
  const pcy = H * (portrait ? 0.55 : 0.53);
  const box: Rect = { x: pcx - pw / 2, y: pcy - ph / 2, w: pw, h: ph };

  // the world: a near-black field in the brand's hue, a warm halo that breathes, a floor glow and drifting bokeh
  c = shape(c, { x: 0, y: 0, w: W, h: H }, shade(i.accent, 0.85), 12).c;
  // the dolly zoom's background half: everything behind the can grows by this much while the can holds its size
  const vertigo = 1.35;
  const hd = Math.max(pw, ph) * 0.95;
  const halo = shape(c, { x: pcx - hd / 2, y: pcy - hd / 2, w: hd, h: hd }, tint(i.accent, 0.3), 11, { kind: 'ellipse', size: [hd, hd] }, (l) => {
    l.effects = [{ name: 'gaussian-blur', params: { blurriness: r(hd * 0.1) } }];
  });
  c = setKeyframes(halo.c, halo.id, 'opacity', [[0, 0], [0.5, 0.9], [2, 0.7], [B.dollyStart, 0.85], [D, 0.9]], 'easeInOut');
  c = setKeyframes(c, halo.id, 'scale', [[0, 0.5], [B.land, 1], [B.dollyStart, 1.04], [B.dollyEnd, r(1.04 * vertigo)], [D, r(1.06 * vertigo)]], 'easeInOut');
  const fw = pw * 3;
  const fh = pw * 0.5;
  const floor = shape(c, { x: pcx - fw / 2, y: pcy + ph / 2 - fh / 2, w: fw, h: fh }, tint(i.accent, 0.2), 10.5, { kind: 'ellipse', size: [fw, fh] }, (l) => {
    l.effects = [{ name: 'gaussian-blur', params: { blurriness: r(fh * 0.4) } }];
  });
  c = setKeyframes(floor.c, floor.id, 'opacity', [[0, 0], [r(B.land - 0.1), 0], [r(B.land + 0.2), 0.55]], 'easeOut');
  // bokeh: a fixed scatter (deterministic), each disc drifting up slowly and spreading out in the dolly
  const scatter = [[0.14, 0.3, 0.05], [0.84, 0.24, 0.07], [0.2, 0.74, 0.04], [0.88, 0.7, 0.05], [0.7, 0.12, 0.03], [0.3, 0.12, 0.035], [0.08, 0.52, 0.03], [0.93, 0.47, 0.035]] as const;
  for (const [fx, fy, fr] of scatter) {
    const d = u * fr * 2;
    const b = shape(c, { x: fx * W - d / 2, y: fy * H - d / 2, w: d, h: d }, tint(i.accent, 0.55), 10.8, { kind: 'ellipse', size: [d, d] }, (l) => {
      l.effects = [{ name: 'gaussian-blur', params: { blurriness: r(d * 0.15) } }];
    });
    c = setKeyframes(b.c, b.id, 'opacity', [[0, 0], [0.6, 0.35], [D, 0.25]], 'easeOut');
    // spread away from the can as the dolly runs, like a wider background behind a held subject
    const ex = pcx + (fx * W - pcx) * vertigo;
    const ey = pcy + (fy * H - pcy) * vertigo;
    c = setKeyframes(c, b.id, 'x', [[0, r(fx * W)], [B.dollyStart, r(fx * W)], [B.dollyEnd, r(ex)]], 'easeInOut');
    c = setKeyframes(c, b.id, 'y', [[0, r(fy * H)], [B.dollyStart, r(fy * H - u * 0.02)], [B.dollyEnd, r(ey - u * 0.02)], [D, r(ey - u * 0.035)]], 'easeInOut');
  }

  // a 2D contact shadow: at this near-level camera the engine's 3D shadow (soft-edged since 0.3.4) barely shows on the ground plane,
  // so it is off and this soft ellipse grounds the can instead
  const sw = pw * 1.1;
  const shh = pw * 0.16;
  const contact = shape(c, { x: pcx - sw / 2, y: pcy + ph / 2 - shh / 2, w: sw, h: shh }, '#000000', 1.5, { kind: 'ellipse', size: [sw, shh] }, (l) => {
    l.effects = [{ name: 'gaussian-blur', params: { blurriness: r(Math.max(6, shh * 0.35)) } }];
  });
  c = setKeyframes(contact.c, contact.id, 'opacity', [[0, 0], [r(B.land - 0.15), 0], [B.land, 0.55]], 'easeOut');
  c = setKeyframes(c, contact.id, 'scale', [[0, 0.4], [r(B.land - 0.15), 0.4], [B.land, 1]], 'easeOut');

  // the can: a 2D product layer placed, then turned into the model3d layer by placeProduct3D
  c = registerAsset(c, { id: i.texture.id, kind: 'image', src: i.texture.src, width: i.texture.width, height: i.texture.height });
  const stub = add(c, { role: 'product', kind: 'image', assetId: i.texture.id, box, z: 1 });
  c = placeProduct3D(stub.c, {
    sceneId: ID,
    box,
    shape: i.shape,
    texture: { id: i.texture.id, url: i.texture.src, width: i.texture.width, height: i.texture.height, kind: i.texture.kind },
    side: i.side,
    aspect: i.productAspect,
    preset: 'studio',
  });
  const pid = `${ID}:product3d`;
  // the tumble: falls in from above the frame tilted, overshoots the tilt a little, settles upright
  c = setKeyframes(c, pid, 'y', [[0, r(pcy - H * 0.75)], [r(B.land - 0.1), r(pcy + u * 0.01)], [B.land, r(pcy)]], 'easeOut');
  c = setKeyframes(c, pid, 'rotation', [[0, deg(-24)], [r(B.land - 0.15), deg(5)], [r(B.land + 0.15), 0]], 'easeOut');
  c = patch(c, pid, (l) => {
    // the spin: a fast 3/4 spin as it falls, then the slow turn that shows the label under the moving light, ending a little open
    l.view = {
      rotation: keys3(fps, [[0, [4, -250, 0], EASE_OUT], [B.land, [4, -28, 0], EASE_IN_OUT], [B.turnEnd, [4, 22, 0], EASE_IN_OUT], [D, [4, 16, 0]]]),
    };
    // the light sweep with real light: the key runs from the can's left round to its right while it turns, the rim lifts at the end
    l.lighting = {
      ...(l.lighting ?? {}),
      key: { ...(l.lighting?.key ?? {}), azimuth: keys1(fps, [[0, -70, EASE_IN_OUT], [B.land, -70, EASE_IN_OUT], [B.turnEnd, 45, LINEAR], [D, 45]]), elevation: 55, color: tint(i.accent, 0.7) },
      rim: { intensity: keys1(fps, [[0, 0.6, EASE_IN_OUT], [B.turnEnd, 0.6, EASE_IN_OUT], [B.dollyEnd, 1.6, LINEAR], [D, 1.6]]) },
    };
    l.camera = { ...(l.camera ?? {}), fov: keys1(fps, [[0, FOV_REST, EASE_IN_OUT], [B.dollyStart, FOV_REST, EASE_IN_OUT], [B.dollyEnd, FOV_DOLLY, LINEAR], [D, FOV_DOLLY]]) };
    l.material = { roughness: 0.3, metalness: 0.6, clearcoat: 0.8 };
    l.shadow = { opacity: 0 };
  });

  // copy: brand, name word by word, price disc on the beat
  const ink = '#ffffff';
  const top = H * (portrait ? 0.13 : 0.1);
  if (i.brand) {
    const bm = add(c, { role: 'caption', kind: 'text', text: i.brand.toUpperCase(), z: 0.2, style: { size: Math.round(u * 0.032), weight: 700, color: tint(i.accent, 0.6), align: 'center' }, box: { x: W * 0.1, y: top, w: W * 0.8, h: u * 0.045 } });
    c = setKeyframes(bm.c, bm.id, 'opacity', [[0, 0], [0.6, 0], [1.0, 1]], 'easeOut');
  }
  const name = i.brand && i.title.startsWith(i.brand) ? i.title.slice(i.brand.length).trim() || i.title : i.title;
  const nameCy = top + u * 0.11;
  const nm = words(c, ID, name, { cx: portrait ? W / 2 : W * 0.4, cy: nameCy, maxW: W * 0.84, size: Math.round(u * 0.09), color: ink, boldLast: true, z: 0.2 });
  c = typeIn(nm.c, nm.ids, 1.0, nameCy);

  const priceText = formatPrice(i.price, i.currency);
  const dd = u * 0.27;
  const dcx = portrait ? Math.min(W - dd * 0.6, pcx + pw / 2 + dd * 0.62) : W * 0.75;
  const dcy = portrait ? pcy + ph * 0.18 : pcy;
  // a light ring: a slightly bigger tinted disc behind the accent disc
  const rd = dd * 1.06;
  const ring = shape(c, { x: dcx - rd / 2, y: dcy - rd / 2, w: rd, h: rd }, tint(i.accent, 0.6), 0.32, { kind: 'ellipse', size: [rd, rd] });
  const disc = shape(ring.c, { x: dcx - dd / 2, y: dcy - dd / 2, w: dd, h: dd }, i.accent, 0.3, { kind: 'ellipse', size: [dd, dd] });
  const pulse = pulseKeys(D, i.bpm ?? 120, 'pop');
  c = setKeyframes(disc.c, disc.id, 'scale', pulse, 'easeInOut');
  c = setKeyframes(c, ring.id, 'scale', pulse, 'easeInOut');
  const was = i.wasPrice !== undefined && i.wasPrice > i.price ? formatPrice(i.wasPrice, i.currency) : undefined;
  const ps = Math.round(Math.min(dd * 0.3, (dd * 0.82) / (priceText.length * 0.6)));
  const pr = add(c, { role: 'caption', kind: 'text', text: priceText, z: 0.15, style: { size: ps, weight: 800, color: inkOn(i.accent), align: 'center' }, box: { x: dcx - dd / 2, y: dcy - ps * 0.6 + (was ? ps * 0.25 : 0), w: dd, h: ps * 1.2 } });
  c = setKeyframes(pr.c, pr.id, 'scale', pulse, 'easeInOut');
  if (was) {
    const ws = Math.round(ps * 0.55);
    const wy = dcy - ps * 0.55;
    const old = add(c, { role: 'caption', kind: 'text', text: was, z: 0.15, style: { size: ws, weight: 500, color: inkOn(i.accent), align: 'center' }, box: { x: dcx - dd / 2, y: wy - ws * 0.6, w: dd, h: ws * 1.2 } });
    c = setKeyframes(old.c, old.id, 'scale', pulse, 'easeInOut');
    const lw = was.length * ws * 0.56;
    // the line is centred on the old price, so the same pulse about its own centre keeps it over the text
    const line = shape(c, { x: dcx - lw / 2, y: wy - Math.max(2, ws * 0.05), w: lw, h: Math.max(3, ws * 0.1) }, '#ff5a6e', 0.1);
    c = setKeyframes(line.c, line.id, 'opacity', [[0, 0], [1.2, 0], [1.4, 1]], 'easeOut');
    c = setKeyframes(c, line.id, 'scale', pulse, 'easeInOut');
  }

  if (i.music) {
    c = registerAsset(c, { id: i.music.id, kind: 'audio', src: i.music.src });
    c = structuredClone(c);
    (c.layers as Obj[]).unshift({
      kind: 'audio', id: 'hero:music', name: 'music', inPoint: 0, outPoint: c.durationInFrames, assetId: i.music.id, level: i.music.level ?? 0.7,
      transform: { position: [0, 0], anchor: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
    });
  }
  return c;
}
