import type * as THREE from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';

// A liquid made of metaballs (three's MarchingCubes): soft spheres whose fields add up, so drops that
// come close flow into one smooth surface and pull apart again. Every ball's place is a closed-form
// function of time and a seed, so seeking backwards and rendering frame N twice give the same shape.
//
// The field is a unit box (0..1 on each axis, y up); the mesh is that box `size` across, standing on
// y = 0 of its parent so the liquid's floor meets the ground the way a prop's base does.

export const LIQUID_FORMS = ['crown', 'pour', 'blobs', 'vortex'] as const;
export type LiquidForm = (typeof LIQUID_FORMS)[number];

export interface LiquidOptions {
  form: LiquidForm;
  /** Seconds the liquid plays for (its layer's length); the form is timed to it. */
  duration: number;
  seed?: number;
  /** Field cells per side: more is smoother and slower. */
  resolution?: number;
  /** Edge length of the box in world units. */
  size: number;
}

export interface Ball {
  x: number;
  y: number;
  z: number;
  /** Radius in box units (0..1) for a lone ball; neighbours swell into each other. */
  r: number;
}

const SUBTRACT = 12;
const ISOLATION = 80;
/** The floor of the box the liquid lands on, in box units. */
export const LIQUID_FLOOR = 0.06;
/** Where a pool's balls sit: below the floor, so only their tops show and they read as a thin sheet. */
const POOL_Y = 0.035;
/** Slow-motion gravity in box units per second squared (ads shoot splashes at high frame rates). */
const GRAVITY = 2.4;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
const smooth = (a: number, b: number, x: number) => {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};

/** A drop in flight, with a smaller ball trailing behind it along its path, so it reads as a falling teardrop, not a bead. */
function drop(out: Ball[], x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number): void {
  out.push({ x, y, z, r });
  const sp = Math.hypot(vx, vy, vz) || 1;
  const lag = r * 1.4;
  out.push({ x: x - (vx / sp) * lag, y: y - (vy / sp) * lag, z: z - (vz / sp) * lag, r: r * 0.62 });
}

/** A thin pool on the floor: rings of small balls, sunk so only their tops show, which flow into one smooth sheet. */
function sheet(out: Ball[], cx: number, cz: number, radius: number, r: number, sink = 0): void {
  const rings = Math.max(1, Math.round(radius / (r * 1.3)));
  const y = POOL_Y - sink;
  out.push({ x: cx, y, z: cz, r });
  for (let i = 1; i <= rings; i++) {
    const rr = (i / rings) * radius;
    const n = Math.max(6, Math.round((2 * Math.PI * rr) / (r * 1.25)));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + i * 0.37;
      out.push({ x: cx + Math.cos(a) * rr, y, z: cz + Math.sin(a) * rr, r });
    }
  }
}

/**
 * Crown splash, the shot of something landing in liquid: a thin ring wall rises from a pool and flares out
 * at its lip, the lip grows points that break off as drops arcing away and falling, and the wall sinks back.
 * The middle stays open, so a product standing there is ringed by the splash, not covered by it.
 */
function crown(t: number, d: number, rand: () => number): Ball[] {
  const out: Ball[] = [];
  const u = t / d;
  const fade = 1 - smooth(0.8, 1, u);
  // packed closer than a ball's size round the ring and up the wall, so the wall reads as one sheet, not beads
  const n = 48;
  const rows = 8;
  const jitter = Array.from({ length: n }, () => rand());
  const spike = Array.from({ length: n }, () => 0.6 + rand() * 0.8);
  const radius = 0.13 + 0.17 * easeOut(u / 0.5);
  const wall = 0.19 * Math.sin(Math.PI * clamp01(u / 0.75)) * fade;
  const breakAt = 0.3 * d;
  // the pool thins as the splash settles
  sheet(out, 0.5, 0.5, radius * 1.05, 0.03, 0.012 * smooth(0.5, 1, u));
  for (let k = 0; k < n; k++) {
    const a = ((k + jitter[k]! * 0.3) / n) * Math.PI * 2;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    // the wall: a stack of small balls up the ring, flaring outward toward the lip
    for (let j = 1; j < rows; j++) {
      const f = j / (rows - 1);
      const h = f * wall;
      const rr = radius + 0.09 * f ** 1.6 * clamp01(wall / 0.12);
      out.push({ x: 0.5 + cx * rr, y: LIQUID_FLOOR + h, z: 0.5 + cz * rr, r: (0.028 - 0.008 * f) * fade });
    }
    // every third point of the lip grows a spike, then breaks off into a drop on a ballistic arc
    if (k % 3) continue;
    const lip = radius + 0.09 * clamp01(wall / 0.12);
    if (t < breakAt) {
      const grow = t / breakAt;
      out.push({ x: 0.5 + cx * (lip + 0.02 * grow), y: LIQUID_FLOOR + wall + 0.045 * spike[k]! * grow, z: 0.5 + cz * (lip + 0.02 * grow), r: 0.017 * fade });
    } else {
      const age = t - breakAt - jitter[k]! * 0.1 * d;
      if (age < 0) continue;
      const vx = 0.3 * spike[k]!;
      const vy0 = 0.7 * spike[k]!;
      const y = LIQUID_FLOOR + 0.19 + vy0 * age - 0.5 * GRAVITY * age * age;
      if (y < LIQUID_FLOOR) continue;
      const reach = lip + 0.02 + vx * age;
      drop(out, 0.5 + cx * reach, y, 0.5 + cz * reach, cx * vx, vy0 - GRAVITY * age, cz * vx, 0.016 * spike[k]! * fade);
    }
  }
  return out;
}

/**
 * Pour: a glossy stream falls from above on a curve, wobbling a little, and spreads into a pool where it
 * lands; it stops at 70 % of the time and the tail falls after it.
 */
function pour(shotT: number, d: number, rand: () => number): Ball[] {
  const out: Ball[] = [];
  // the stream is already falling when the shot opens: it started a fall's length before
  const PREROLL = 0.8;
  const t = shotT + PREROLL;
  // the stream lands about a quarter of the box from the middle, beside whatever stands there
  const spout = { x: 0.58 + rand() * 0.04, y: 0.95, z: 0.5 };
  const vx = 0.05 + rand() * 0.04;
  const stopAt = 0.7 * d + PREROLL;
  const every = 0.02;
  const wob = rand() * Math.PI * 2;
  const emitted = Math.floor(Math.min(t, stopAt) / every);
  const pool: Ball[] = [];
  for (let i = Math.max(0, emitted - 160); i <= emitted; i++) {
    const born = i * every;
    const age = t - born;
    if (age < 0) continue;
    const x = spout.x + vx * age;
    const y = spout.y - 0.25 * age - 0.5 * GRAVITY * age * age;
    const z = spout.z + 0.015 * Math.sin(born * 9 + wob);
    if (y > LIQUID_FLOOR + 0.02) {
      // thicker at the spout, thinning as it falls, like a real stream
      out.push({ x, y, z, r: 0.024 - 0.009 * clamp01((spout.y - y) / 0.8) });
    } else {
      // landed: when, and where, by solving the fall for the floor
      const a = 0.5 * GRAVITY;
      const b = 0.25;
      const c = LIQUID_FLOOR + 0.02 - spout.y;
      const land = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
      const since = age - land;
      const ang = ((i * 2.399) % (Math.PI * 2)) + wob;
      const spread = 0.17 * (1 - Math.exp(-since * 2.5));
      pool.push({ x: spout.x + vx * land + Math.cos(ang) * spread, y: POOL_Y, z: z + Math.sin(ang) * spread, r: 0.034 });
    }
  }
  // a pool is a few dozen balls at most: the newest carry the spreading edge
  return out.concat(pool.slice(-36));
}

/**
 * Blobs: floating drops of liquid in a loose ring round the middle (where the product stands). Each drop is
 * three balls circling close together, so it wobbles and changes shape like liquid without gravity, and it
 * drifts round the ring; small droplets circle further out.
 */
function blobs(t: number, d: number, rand: () => number): Ball[] {
  const out: Ball[] = [];
  const grow = easeOut(t / Math.min(0.5, d * 0.3)) * (1 - smooth(0.85, 1, t / d));
  const n = 4;
  for (let k = 0; k < n; k++) {
    const drift = 0.25 + rand() * 0.25;
    const a = (k / n) * Math.PI * 2 + rand() * 0.8 + drift * t;
    const ring = 0.28 + rand() * 0.06;
    const cy = 0.4 + rand() * 0.25 + 0.05 * Math.sin(t * (0.8 + rand() * 0.6) + k * 1.7);
    const size = (0.055 + rand() * 0.02) * grow;
    const spin = 2.2 + rand() * 1.6;
    const tilt = rand() * Math.PI;
    for (let j = 0; j < 3; j++) {
      // three lobes on a small tilted circle, their distance breathing so the drop stretches and rounds
      const b = spin * t + (j / 3) * Math.PI * 2;
      const reach = size * (0.55 + 0.25 * Math.sin(t * 2.7 + j + k));
      const lx = Math.cos(b) * reach;
      const ly = Math.sin(b) * reach * Math.cos(tilt);
      const lz = Math.sin(b) * reach * Math.sin(tilt);
      out.push({ x: 0.5 + Math.cos(a) * ring + lx, y: cy + ly, z: 0.5 + Math.sin(a) * ring + lz, r: size * (0.72 + 0.1 * j) });
    }
  }
  for (let k = 0; k < 6; k++) {
    const w = 0.5 + rand() * 0.5;
    const p = rand() * Math.PI * 2;
    const ring = 0.38 + rand() * 0.06;
    out.push({ x: 0.5 + ring * Math.cos(w * t + p), y: 0.35 + 0.3 * rand() + 0.05 * Math.sin(w * 1.7 * t + p), z: 0.5 + ring * Math.sin(w * t + p), r: 0.016 * grow });
  }
  return out;
}

/**
 * Vortex: a band of liquid winding round the middle (where the product stands), climbing as it goes and spiralling outward. It grows
 * along its length from the floor, turns steadily, thins toward its tail and throws drops outward from that end that arc and fall.
 * The middle stays open for the product.
 */
function vortex(t: number, d: number, rand: () => number): Ball[] {
  const out: Ball[] = [];
  const u = t / d;
  const grow = easeOut(u / 0.4);
  const fade = 1 - smooth(0.8, 1, u);
  const spin = 2.6 * t;
  const turns = 1.5 + rand() * 0.5;
  const n = 130;
  const at = (s: number, extra = 0) => {
    const a = -turns * Math.PI * 2 * s + spin + extra;
    const r = 0.16 + 0.2 * s;
    return { x: 0.5 + Math.cos(a) * r, z: 0.5 + Math.sin(a) * r, y: LIQUID_FLOOR + 0.05 + 0.3 * s * (1 - 0.3 * s), a, r };
  };
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1);
    if (s > grow) break;
    const p = at(s);
    // thick in the middle of its length, thin at both ends, so it reads as a poured ribbon and not a bead chain
    const th = (0.011 + 0.008 * Math.sin(Math.PI * Math.min(1, s * 1.15))) * fade;
    for (let w = -1; w <= 1; w++) out.push({ x: p.x, y: p.y + w * 0.022, z: p.z, r: th * (w === 0 ? 1.1 : 0.85) });
  }
  // drops flung from the tail end: each leaves the ribbon at its own time, going outward and up, then falling
  for (let k = 0; k < 12; k++) {
    const born = (0.3 + 0.5 * rand()) * d;
    const s = 0.55 + 0.45 * rand();
    const age = t - born;
    if (age <= 0 || s > grow) continue;
    const p = at(s, 0);
    const pBorn = at(s, 0);
    const a0 = -turns * Math.PI * 2 * s + 2.6 * born;
    const out0 = { x: 0.5 + Math.cos(a0) * pBorn.r, z: 0.5 + Math.sin(a0) * pBorn.r };
    const vr = 0.22 + 0.2 * rand();
    const x = out0.x + Math.cos(a0) * vr * age - Math.sin(a0) * 0.15 * age;
    const z = out0.z + Math.sin(a0) * vr * age + Math.cos(a0) * 0.15 * age;
    const y = p.y + 0.18 * age - 0.5 * GRAVITY * age * age;
    if (y < LIQUID_FLOOR) continue;
    drop(out, x, y, z, Math.cos(a0) * vr, 0.18 - GRAVITY * age, Math.sin(a0) * vr, 0.014 * fade * (0.7 + 0.6 * rand()));
  }
  return out;
}

/** The balls of `form` at `t` seconds. Pure: the same arguments give the same balls. */
export function liquidBalls(form: LiquidForm, t: number, duration: number, seed = 1): Ball[] {
  const d = Math.max(0.2, duration);
  const rand = mulberry32(seed);
  const time = Math.min(Math.max(0, t), d);
  const balls = form === 'crown' ? crown(time, d, rand) : form === 'pour' ? pour(time, d, rand) : form === 'vortex' ? vortex(time, d, rand) : blobs(time, d, rand);
  // the field ends at the box's edge: a ball outside it would be cut flat
  return balls.filter((b) => b.r > 0.004 && b.x > 0.03 && b.x < 0.97 && b.y > 0.03 && b.y < 0.97 && b.z > 0.03 && b.z < 0.97);
}

export interface LiquidRig {
  mesh: MarchingCubes;
  /** Shapes the liquid for `seconds` since it began. */
  setTime: (seconds: number) => void;
}

/** The liquid as one mesh with `material`, `size` across, standing on y = 0. */
export function buildLiquid(o: LiquidOptions, material: THREE.Material): LiquidRig {
  const resolution = Math.round(Math.min(64, Math.max(24, o.resolution ?? 64)));
  const mesh = new MarchingCubes(resolution, material, false, false, 60000);
  mesh.isolation = ISOLATION;
  mesh.scale.setScalar(o.size / 2);
  mesh.position.y = o.size / 2;
  mesh.frustumCulled = false;
  let last = -1;
  const setTime = (seconds: number): void => {
    if (seconds === last) return;
    last = seconds;
    mesh.reset();
    for (const b of liquidBalls(o.form, seconds, o.duration, o.seed)) {
      mesh.addBall(b.x, b.y, b.z, b.r * b.r * (SUBTRACT + ISOLATION), SUBTRACT);
    }
    mesh.update();
  };
  setTime(0);
  return { mesh, setTime };
}
