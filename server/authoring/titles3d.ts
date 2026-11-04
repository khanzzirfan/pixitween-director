// Glossy 3D titles (docs/toimprove/titles-3d.md): every word of the cinematic film is real 3D type in its own stage world over the
// product world: extruded, bevelled letters that catch the studio light, on rounded glassy plates, with the price on a coin.
// This module lays the words out in screen pixels and turns them into that world and its prop3d members; the film says what to show.
import { TITLE_METRICS } from './title-metrics';
import type { Obj } from './types';

/** The typefaces Muse can pick. Each is a Three typeface (web/public/fonts) with a heavy and a light cut. */
export const TITLE_FACES = { sans: 'helvetiker', soft: 'optimer', serif: 'gentilis' } as const;
export type TitleFace = keyof typeof TITLE_FACES;
export const TITLE_FACE_NAMES = Object.keys(TITLE_FACES) as TitleFace[];
/** How the letters are finished: a lacquered colour, polished chrome, polished gold, or a soft satin. */
export const TITLE_FINISHES = ['gloss', 'chrome', 'gold', 'satin'] as const;
export type TitleFinish = (typeof TITLE_FINISHES)[number];
/** How the letters arrive, one after another. */
export const TITLE_ENTERS = ['rise', 'pop', 'flip'] as const;
export type TitleEnter = (typeof TITLE_ENTERS)[number];

/** The titles' camera: fixed, straight on. Screen pixels map onto its z = 0 plane. */
export const TITLE_CAMERA = { distance: 10, fov: 30 } as const;
/** Letter depth and bevel as shares of the letter size: deep enough to show a lit side, a bevel that catches a highlight. */
export const TITLE_DEPTH = { depth: 0.3, bevel: 0.04, bevelSize: 0.024 } as const;
/** Line spacing, a share of the letter size. */
export const TITLE_LINE_HEIGHT = 1.28;
/** How far the letters rest tipped back, in degrees. */
export const TITLE_REST_TILT = -7;
/** A stage world holds at most this many props. */
export const TITLE_PROPS_MAX = 12;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

// ---- fonts ----

interface Typeface {
  resolution: number;
  glyphs: Record<string, { ha: number }>;
}
const faces = new Map<string, Typeface>();

/** The font file of a face and weight, and the id the film registers it under. */
export function titleFont(face: TitleFace, heavy: boolean): { id: string; src: string; file: string } {
  const file = `${TITLE_FACES[face]}_${heavy ? 'bold' : 'regular'}`;
  return { id: `font-${file}`, src: `/fonts/${file}.typeface.json`, file };
}

function typeface(file: string): Typeface {
  let t = faces.get(file);
  if (!t) {
    const m = TITLE_METRICS[file];
    if (!m) throw new Error(`no metrics for the title font '${file}'`);
    const chars = [...m.chars];
    t = { resolution: m.resolution, glyphs: Object.fromEntries(chars.map((ch, n) => [ch, { ha: m.ha[n]! }])) };
    faces.set(file, t);
  }
  return t;
}

/** Characters a face may lack, written another way so the letters never silently drop out. */
const STAND_INS: Record<string, string> = { '€': 'EUR ', '₹': 'INR ', '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...' };

/** The text as the face can draw it: a missing character becomes its stand-in, or is left out. */
export function drawable(text: string, file: string): string {
  const g = typeface(file).glyphs;
  let out = '';
  for (const ch of text) {
    if (ch === '\n' || ch === ' ' || g[ch]) out += ch;
    else if (STAND_INS[ch]) out += [...STAND_INS[ch]].filter((c) => c === ' ' || g[c]).join('');
  }
  return out.replace(/ +/g, ' ').trim();
}

/** How wide one line is, in the units of `size` (the letters' em). */
export function lineWidth(line: string, file: string, size: number): number {
  const t = typeface(file);
  let w = 0;
  for (const ch of line) w += (t.glyphs[ch]?.ha ?? t.glyphs[' ']?.ha ?? t.resolution * 0.3) / t.resolution;
  return w * size;
}

/** Breaks the text into lines no wider than `maxWidth` (at least one word a line). */
export function wrapTitle(text: string, file: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && lineWidth(next, file, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  // two lines are split where they come out most even ("Wild Berry / Greek Yoghurt", not "Wild Berry Greek / Yoghurt")
  if (lines.length === 2) {
    const words = text.split(/\s+/).filter(Boolean);
    let best = lines;
    let widest = Math.max(...lines.map((l) => lineWidth(l, file, size)));
    for (let n = 1; n < words.length; n++) {
      const pair = [words.slice(0, n).join(' '), words.slice(n).join(' ')];
      const w = Math.max(...pair.map((l) => lineWidth(l, file, size)));
      if (w <= maxWidth && w < widest) {
        best = pair;
        widest = w;
      }
    }
    return best;
  }
  return lines;
}

// ---- space ----

/** Screen pixels to the titles' world: pixels per world unit, and the world point of a pixel. */
export function titleSpace(W: number, H: number): { ppu: number; at: (px: number, py: number, z?: number) => [number, number, number] } {
  const visible = 2 * TITLE_CAMERA.distance * Math.tan((TITLE_CAMERA.fov * Math.PI) / 360);
  const ppu = H / visible;
  return { ppu, at: (px, py, z = 0) => [r3((px - W / 2) / ppu), r3((H / 2 - py) / ppu), r3(z)] };
}

// ---- materials ----

/** The letters' surface: a finish over an ink colour (chrome and gold carry their own colour). */
export function letterMaterial(finish: TitleFinish, ink: string): Obj {
  // a fully metallic letter shows only what it reflects, and a camera straight on sees little to reflect, so it would go black: the metals
  // are part metal over a bright base, under a clear coat, and read as polished chrome and gold in any light
  if (finish === 'chrome') return { color: '#eef2f6', metalness: 0.6, roughness: 0.14, clearcoat: 1 };
  if (finish === 'gold') return { color: '#f2c463', metalness: 0.55, roughness: 0.2, clearcoat: 1 };
  if (finish === 'satin') return { color: ink, metalness: 0, roughness: 0.42, clearcoat: 0.3 };
  return { color: ink, metalness: 0.05, roughness: 0.07, clearcoat: 1 };
}

/** A plate's surface: dark or pale lacquered glass under the letters, the tone opposite their ink. */
export function plateMaterial(dark: boolean): Obj {
  return dark ? { color: '#0d0f16', metalness: 0.2, roughness: 0.1, clearcoat: 1, opacity: 0.72 } : { color: '#f6f6f8', metalness: 0, roughness: 0.1, clearcoat: 1, opacity: 0.78 };
}

// ---- shapes ----

/** A rounded rectangle's outline in pixels (y down), corners of radius `r`, centred on the origin. */
export function roundedRect(w: number, h: number, r: number, steps = 8): Array<[number, number]> {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const pts: Array<[number, number]> = [];
  const corners: Array<[number, number, number]> = [
    [w / 2 - rr, -h / 2 + rr, -90],
    [w / 2 - rr, h / 2 - rr, 0],
    [-w / 2 + rr, h / 2 - rr, 90],
    [-w / 2 + rr, -h / 2 + rr, 180],
  ];
  for (const [cx, cy, start] of corners) {
    if (rr === 0) {
      pts.push([r2(cx), r2(cy)]);
      continue;
    }
    for (let s = 0; s <= steps; s++) {
      const a = ((start + (90 * s) / steps) * Math.PI) / 180;
      pts.push([r2(cx + rr * Math.cos(a)), r2(cy + rr * Math.sin(a))]);
    }
  }
  return pts;
}

// ---- members ----

type Key = { t: number; v: number[]; easeIn?: number[]; easeOut?: number[] };
const OUT = [0.16, 1, 0.3, 1];
const IN_OUT = [0.42, 0, 0.58, 1];
/** How far the price coin and its numbers swell on a beat, and how far they swing. */
export const PULSE = { grow: 1.14, swing: 22 };
const k = (t: number, v: number[], e = OUT): Key => ({ t: Math.max(0, Math.round(t)), v: v.map(r3), easeIn: e, easeOut: e });
/** Keys in frame order with no two on one frame (the later one wins). */
const keys = (ks: Key[]): Key[] => {
  const out: Key[] = [];
  for (const x of [...ks].sort((a, b) => a.t - b.t)) {
    if (out.at(-1)?.t === x.t) out[out.length - 1] = x;
    else out.push(x);
  }
  return out;
};

export interface TitleWords {
  id: string;
  text: string;
  face: TitleFace;
  heavy: boolean;
  /** the letters' em in pixels */
  px: number;
  /** where the block's centre sits, in pixels */
  cx: number;
  cy: number;
  align?: 'left' | 'center' | 'right';
  ink: string;
  finish: TitleFinish;
  enter: TitleEnter;
  /** frames: the letters start arriving, start leaving (none = they stay), and the prop's last frame */
  inAt: number;
  outAt?: number;
  end: number;
  /** a slow turn while the words rest, so the light slides across the letters */
  drift?: boolean;
  /** frames at which the words give a small swing with the price coin */
  swing?: number[];
}

/**
 * How the letters come in: a line with little time on screen brings them in faster and closer together, so the last letter has landed
 * within about half the time the line is shown (and in under a second either way).
 */
export function letterTiming(text: string, frames: number, fps: number): { each: number; seconds: number } {
  const letters = Math.max(1, text.replace(/\s/g, '').length);
  const arrive = Math.min(0.95, Math.max(0.25, (frames / fps) * 0.5));
  const seconds = Math.min(0.55, arrive * 0.6);
  return { each: r3(letters > 1 ? Math.min(0.045, (arrive - seconds) / (letters - 1)) : 0), seconds: r2(seconds) };
}

/**
 * How the letters leave: a fade from the last letter back. A line with a long rest takes its time (about 0.4 s for ten letters);
 * a line on a short shot leaves in under a third of its rest, so it is whole on screen for most of the time it is shown.
 */
export function titleExit(text: string, restFrames: number, fps: number): { seconds: number; each: number; frames: number } {
  const letters = Math.max(1, text.replace(/\s/g, '').length);
  const total = Math.min(0.22 + 0.02 * letters, Math.max(0.12, (restFrames / fps) * 0.3));
  const seconds = r2(Math.min(0.22, total * 0.6));
  const each = letters > 1 ? r3(Math.max(0, (total - seconds) / (letters - 1))) : 0;
  return { seconds, each, frames: Math.ceil((seconds + each * (letters - 1)) * fps) + 1 };
}

/** The frame a line starts to leave so its last letter is gone by `goneBy` (and it stays at least a fifth of a second). */
export function titleLeaveAt(text: string, inAt: number, goneBy: number, fps: number): number {
  const least = inAt + Math.ceil(0.2 * fps);
  let out = goneBy - titleExit(text, Infinity, fps).frames;
  for (let n = 0; n < 4; n++) out = goneBy - titleExit(text, out - inAt, fps).frames;
  while (out > least && out + titleExit(text, out - inAt, fps).frames > goneBy) out -= 1;
  return Math.max(least, out);
}

/** One title as a text3d prop of the titles world. */
export function wordsProp(stage: string, w: TitleWords, ppu: number, fps: number, at: (px: number, py: number, z?: number) => [number, number, number]): Obj {
  const size = r3(w.px / ppu);
  const leave = w.outAt !== undefined ? w.outAt : undefined;
  const exit = leave !== undefined ? titleExit(w.text, leave - w.inAt, fps) : undefined;
  const settled = w.inAt + 0.75 * fps;
  // the letters rest tipped a little back, so the light runs along their tops and bevels and they read as solid
  const rest = [TITLE_REST_TILT, 0, 0];
  const rot: Key[] = [k(w.inAt, [-14, -18, 0]), k(settled, rest)];
  if (w.drift && (leave ?? w.end) > settled + 0.3 * fps) rot.push(k(leave ?? w.end, [TITLE_REST_TILT, 6, 0], IN_OUT));
  const pulse: Key[] = [];
  for (const s of w.swing ?? []) {
    rot.push(k(s - 0.2 * fps, rest, IN_OUT), k(s, [TITLE_REST_TILT, PULSE.swing, 0], IN_OUT), k(s + 0.3 * fps, rest, IN_OUT));
    pulse.push(k(s - 0.2 * fps, [1, 1, 1], IN_OUT), k(s, [PULSE.grow, PULSE.grow, PULSE.grow], IN_OUT), k(s + 0.3 * fps, [1, 1, 1], IN_OUT));
  }
  return {
    id: w.id,
    kind: 'prop3d',
    stage,
    inPoint: Math.max(0, w.inAt),
    outPoint: leave !== undefined && exit ? Math.min(w.end, leave + exit.frames) : w.end,
    source: {
      type: 'text3d',
      text: w.text,
      font: titleFont(w.face, w.heavy).id,
      size,
      depth: r3(size * TITLE_DEPTH.depth),
      bevel: { thickness: r3(size * TITLE_DEPTH.bevel), size: r3(size * TITLE_DEPTH.bevelSize), segments: 3 },
      align: w.align ?? 'center',
      lineHeight: TITLE_LINE_HEIGHT,
      enter: { style: w.enter, atFrame: w.inAt, ...letterTiming(w.text, (leave ?? w.end) - w.inAt, fps) },
      ...(leave !== undefined && exit ? { exit: { atFrame: leave, seconds: exit.seconds, each: exit.each } } : {}),
    },
    position: at(w.cx, w.cy),
    rotation: keys(rot),
    ...(pulse.length ? { scale: keys(pulse) } : {}),
    castShadow: false,
    material: letterMaterial(w.finish, w.ink),
  };
}

/** The words' size on screen in pixels: width of the widest line and height of the stack. */
export function wordsBox(text: string, face: TitleFace, heavy: boolean, px: number): { w: number; h: number } {
  const file = titleFont(face, heavy).file;
  const lines = text.split('\n');
  return { w: Math.max(...lines.map((l) => lineWidth(l, file, px))), h: px * (0.75 + TITLE_LINE_HEIGHT * (lines.length - 1)) };
}

/**
 * A slab under words or a price: an extruded outline in pixels (a pill, a bar, a coin, a tag), standing behind the letters, growing in
 * from its middle across (a plate) or spinning in (a coin), and going the way it came.
 */
export function slabProp(
  stage: string,
  o: { id: string; outline: Array<[number, number]>; w: number; h: number; depthPx: number; cx: number; cy: number; z: number; material: Obj; inAt: number; outAt?: number; end: number; grow: 'across' | 'spin'; swing?: number[] },
  ppu: number,
  fps: number,
  at: (px: number, py: number, z?: number) => [number, number, number],
): Obj {
  // a fitted prop stands on its base: its origin is the bottom of the outline, so it is placed half its height lower
  const [x, y] = at(o.cx, o.cy + o.h / 2);
  const intro = o.grow === 'across' ? 0.28 * fps : 0.6 * fps;
  const scale: Key[] = [];
  const rot: Key[] = [];
  const lift: Key[] = [];
  if (o.grow === 'across') {
    scale.push(k(o.inAt - 0.05 * fps, [0.001, 1, 1]), k(o.inAt - 0.05 * fps + intro, [1, 1, 1]));
    if (o.outAt !== undefined) scale.push(k(o.outAt, [1, 1, 1], IN_OUT), k(o.outAt + 0.2 * fps, [0.001, 1, 1], IN_OUT));
  } else {
    rot.push(k(o.inAt, [0, -200, 0]), k(o.inAt + intro, [0, 0, 0]));
    for (const s of o.swing ?? []) {
      rot.push(k(s - 0.2 * fps, [0, 0, 0], IN_OUT), k(s, [0, PULSE.swing, 0], IN_OUT), k(s + 0.3 * fps, [0, 0, 0], IN_OUT));
      const g = PULSE.grow;
      scale.push(k(s - 0.2 * fps, [1, 1, 1], IN_OUT), k(s, [g, g, g], IN_OUT), k(s + 0.3 * fps, [1, 1, 1], IN_OUT));
      // the origin is the base, so a swelling slab rises: lower it by half the extra height to keep its centre still
      const drop = r3(((o.h / ppu) / 2) * (g - 1));
      lift.push(k(s - 0.2 * fps, [0], IN_OUT), k(s, [-drop], IN_OUT), k(s + 0.3 * fps, [0], IN_OUT));
    }
  }
  return {
    id: o.id,
    kind: 'prop3d',
    stage,
    inPoint: Math.max(0, Math.round(o.inAt - 0.05 * fps)),
    outPoint: o.outAt !== undefined ? Math.min(o.end, Math.round(o.outAt + 0.25 * fps)) : o.end,
    source: { type: 'extrude', contour: o.outline, depth: r2(o.depthPx), bevel: r2(Math.min(o.depthPx * 0.4, o.h * 0.12)) },
    size: r3(Math.max(o.w, o.h) / ppu),
    position: lift.length ? keys([k(o.inAt - 0.05 * fps, [x, r3(y), r3(o.z)]), ...lift.map((l) => ({ ...l, v: [x, r3(y + l.v[0]!), r3(o.z)] }))]) : [x, r3(y), r3(o.z)],
    ...(rot.length ? { rotation: keys(rot) } : {}),
    ...(scale.length ? { scale: keys(scale) } : {}),
    castShadow: false,
    material: o.material,
  };
}

/** The titles' world: a fixed camera straight on, no floor or wall, a neutral studio light of its own (the film's tinted key would turn
 * white letters beige) with a softbox in their reflections for the gloss. */
export function titlesWorld(id: string, W: number, H: number, frames: number): Obj {
  return {
    id,
    name: 'Titles',
    kind: 'stage3d',
    inPoint: 0,
    outPoint: frames,
    transform: { position: [W / 2, H / 2], anchor: [W / 2, H / 2], scale: [1, 1], rotation: 0, opacity: 1 },
    viewport: { width: W, height: H },
    camera: { position: [0, 0, TITLE_CAMERA.distance], target: [0, 0, 0], fov: TITLE_CAMERA.fov },
    set: { ground: 'none', wall: false },
    style: { shading: 'pbr', exposure: 1.3 },
    shadow: { opacity: 0 },
    lights: { preset: 'studio', environment: 'softbox', key: { azimuth: -35, elevation: 45, intensity: 2.4 }, fill: { intensity: 0.9 }, rim: { intensity: 1.8 }, ambient: 0.35 },
  };
}
