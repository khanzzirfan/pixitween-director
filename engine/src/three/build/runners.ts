import * as THREE from 'three';

// Runners: the drops that run down a cold, wet can. Each drop sits still while it grows (static friction holds it), slips once it is
// heavy enough, slides with gravity easing in, catches on the dry surface and stops, then slips again, leaving a wet trail behind it.
// The physics follows the droplet-flow simulation (github.com/natTP/droplet-flow-simulation: gravity against static and dynamic
// friction, drops as instanced half spheres), but nothing is stepped: a drop's place is a closed-form function of time and seed, so
// any frame can be drawn on its own and seeking gives the same picture. The drops are clear water (transmission, ior 1.33): they bend
// the label behind them and catch the lights, the Fresnel look the simulation draws with its own shader.

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

/** The radius of a round body at height `y`, or null outside it. */
export type Profile = (y: number) => number | null;

export interface RunnerOptions {
  profile: Profile;
  /** The heights the drops run between: they start near the top and run off at the bottom. */
  top: number;
  bottom: number;
  /** The body's axis, in its parent's x and z. */
  axis: [number, number];
  /** How wet, 0 to 1: more drops, and they run more often. */
  amount: number;
  seed?: number;
}

/** Where one drop is at a moment: its height and angle round the body, its size and stretch, and its trail. */
export interface RunnerState {
  y: number;
  angle: number;
  /** Radius of the drop, as a share of the body's radius at that height; 0 when it is not there. */
  size: number;
  /** How long the drop is drawn for its width: it stretches while it slides. */
  stretch: number;
  /** The trail runs from `trailTop` down to the drop; `trailWidth` is a share of the drop's width, 0 once it has dried. */
  trailTop: number;
  trailWidth: number;
}

const HOPS = 3;

/**
 * Drop `i` at `t` seconds. One run lasts `period` seconds: the drop grows in place, then makes `HOPS` hops (a slide of length L in
 * time s covers L·x², x the share of s gone: gravity's ease-in, and an abrupt stop where the dry surface catches it), the last one off
 * the bottom. Each run starts from a new place, so the same lane is never run twice.
 */
export function runnerState(i: number, t: number, o: Pick<RunnerOptions, 'top' | 'bottom' | 'seed'>): RunnerState {
  const base = mulberry32((o.seed ?? 11) * 7919 + i * 104729);
  const period = 3.2 + 2.4 * base();
  const offset = base() * period;
  const run = Math.floor((t + offset) / period);
  const tau = t + offset - run * period;
  const rand = mulberry32((o.seed ?? 11) * 7919 + i * 104729 + run * 15485863);

  // most drops on the side the product shows to camera (its front, +z): a drop round the back is never seen
  const angle = (rand() - 0.5) * Math.PI * 1.5;
  const span = o.top - o.bottom;
  const start = o.top - span * 0.25 * rand();
  const size = 0.07 + 0.07 * rand();
  // the drop's time: growing while it holds, then hold-slide pairs, the last slide running off the bottom
  const grow = period * (0.2 + 0.15 * rand());
  const hops: { hold: number; slide: number; length: number }[] = [];
  let left = start - o.bottom + span * 0.1;
  for (let k = 0; k < HOPS; k++) {
    const length = k === HOPS - 1 ? left : left * (0.25 + 0.3 * rand());
    left -= length;
    hops.push({ hold: k === 0 ? 0 : 0.15 + 0.5 * rand(), slide: 0.25 + 0.5 * length / span, length });
  }
  const used = grow + hops.reduce((sum, h) => sum + h.hold + h.slide, 0);
  const scale = Math.min(1, (period * 0.85) / used); // a long run is sped up to fit its period
  const wobble = rand() * 10;

  let clock = tau / scale;
  let y = start;
  let speed = 0;
  let grown = Math.min(1, clock / grow);
  clock -= grow;
  if (clock > 0) {
    for (const hop of hops) {
      if (clock < hop.hold) break;
      clock -= hop.hold;
      if (clock < hop.slide) {
        const x = clock / hop.slide;
        y -= hop.length * x * x;
        speed = x;
        break;
      }
      y -= hop.length;
      clock -= hop.slide;
    }
  }
  grown = 0.55 + 0.45 * grown;
  // the trail thins as it dries in the last of the run; the drop is gone once it has run off the bottom
  const end = tau / period;
  const dry = end < 0.85 ? 1 : Math.max(0, 1 - (end - 0.85) / 0.15);
  const on = y > o.bottom;
  return {
    y,
    angle: angle + 0.04 * Math.sin(wobble + y * 60),
    size: on ? size * grown : 0,
    stretch: 1.15 + 0.7 * speed,
    trailTop: start,
    trailWidth: start - y > 1e-4 ? 0.45 * dry : 0,
  };
}

/** How many drops run for a wetness of `amount`: a few, 2 to 5, as on a can in a commercial; a crowd of them reads as a coat of grit. */
export const runnerCount = (amount: number): number => Math.round(2 + 3 * Math.min(1, Math.max(0, amount)));

/**
 * A round body's radius by height, from the vertices of its geometry under `matrix` (its fitted size in the parent): the widest point
 * of each band, bands joined in straight lines. Null when the body is not round (a box, a flat card): drops then do not run on it.
 */
export function roundProfile(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): { profile: Profile; top: number; bottom: number; axis: [number, number] } | null {
  const pos = geometry.getAttribute('position');
  if (!pos) return null;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let k = 0; k < pos.count; k++) box.expandByPoint(v.fromBufferAttribute(pos, k).applyMatrix4(matrix));
  const w = box.max.x - box.min.x;
  const d = box.max.z - box.min.z;
  const h = box.max.y - box.min.y;
  if (!(w > 0 && d > 0 && h > 0) || Math.max(w, d) / Math.min(w, d) > 1.2) return null;
  const axis: [number, number] = [(box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2];
  const bands = 32;
  const radius = new Array<number>(bands + 1).fill(0);
  for (let k = 0; k < pos.count; k++) {
    v.fromBufferAttribute(pos, k).applyMatrix4(matrix);
    const b = Math.round(((v.y - box.min.y) / h) * bands);
    radius[b] = Math.max(radius[b]!, Math.hypot(v.x - axis[0], v.z - axis[1]));
  }
  // a band with no vertices (a long straight side) takes its neighbours' line
  for (let b = 0; b <= bands; b++) {
    if (radius[b]! > 0) continue;
    let lo = b - 1;
    while (lo >= 0 && radius[lo]! === 0) lo--;
    let hi = b + 1;
    while (hi <= bands && radius[hi]! === 0) hi++;
    const a = lo >= 0 ? radius[lo]! : radius[hi] ?? 0;
    const c = hi <= bands ? radius[hi]! : a;
    radius[b] = lo >= 0 && hi <= bands ? a + ((c - a) * (b - lo)) / (hi - lo) : a;
  }
  const profile: Profile = (y) => {
    const s = ((y - box.min.y) / h) * bands;
    if (s < 0 || s > bands) return null;
    const b = Math.min(bands - 1, Math.floor(s));
    return radius[b]! + (radius[b + 1]! - radius[b]!) * (s - b);
  };
  // drops run on the side, clear of the shoulders and the base
  return { profile, top: box.min.y + h * 0.88, bottom: box.min.y + h * 0.06, axis };
}

export interface RunnersRig {
  mesh: THREE.InstancedMesh;
  setTime: (seconds: number) => void;
}

/** The running drops of a wet body: one instance for each drop and one for its trail. */
export function buildRunners(o: RunnerOptions): RunnersRig {
  const count = runnerCount(o.amount);
  // a half sphere, its dome facing out of the surface (+z)
  const dome = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);
  const material = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.04,
    metalness: 0,
    transmission: 1,
    ior: 1.33,
    thickness: 0.004,
    specularIntensity: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
  });
  const mesh = new THREE.InstancedMesh(dome, material, count * 2);
  mesh.name = 'runners';
  mesh.frustumCulled = false;
  mesh.castShadow = false;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const place = (slot: number, y: number, angle: number, width: number, height: number, depth: number): void => {
    const r = o.profile(y) ?? 0;
    if (!(width > 0) || r <= 0) {
      mesh.setMatrixAt(slot, m.makeScale(0, 0, 0));
      return;
    }
    p.set(o.axis[0] + Math.sin(angle) * r, y, o.axis[1] + Math.cos(angle) * r);
    q.setFromAxisAngle(up, angle);
    s.set(width, height, depth);
    mesh.setMatrixAt(slot, m.compose(p, q, s));
  };

  const setTime = (seconds: number): void => {
    for (let i = 0; i < count; i++) {
      const d = runnerState(i, seconds, o);
      const r = o.profile(d.y) ?? 0;
      const w = d.size * r;
      // the head: a flattened dome, a little longer than wide, drawn a hair lower than its centre so it looks heavy at the bottom
      place(i * 2, d.y - w * 0.15, d.angle, w, w * d.stretch, w * 0.55);
      // the trail: a long, very flat streak from where it started down to the head
      const length = (d.trailTop - d.y) / 2;
      place(i * 2 + 1, d.y + length, d.angle, w * d.trailWidth, length, w * 0.12);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  setTime(0);
  return { mesh, setTime };
}
