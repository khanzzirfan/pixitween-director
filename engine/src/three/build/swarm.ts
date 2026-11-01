// Ported from reacthub-pixitweenjs src/components/AepComposition/stage3d/swarmMath.ts (MIT).
import * as THREE from 'three';
import type { Swarm3D } from '../../schema/layer3d';

// Pure, seeded swarm paths. Every value is a closed-form function of time, so seeking backwards and
// rendering frame N twice produce identical poses. The random draws happen in the same order as the
// library's, so a film keeps the exact copies it was authored with.

type SwarmMotion = Swarm3D['motion'];

interface SwarmCopy {
  p0: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  rot0: THREE.Euler;
  spin: THREE.Vector3;
  startDelay: number;
  size: number;
  speedK: number;
  heightK: number;
  sizeK: number;
  phase: number;
}

export interface SwarmConstants {
  motion: SwarmMotion;
  count: number;
  gravity: number;
  drag: number;
  bounce: boolean;
  growFrames: number;
  fps: number;
  center: THREE.Vector3;
  orbit: { radius: number; angularSpeed: number; height: number; bob: number } | null;
  drift: { velocity: THREE.Vector3; amplitude: THREE.Vector3; frequency: number } | null;
  halfHeight: number;
  copies: SwarmCopy[];
}

const V = new THREE.Vector3();
const Q = new THREE.Quaternion();
const Q2 = new THREE.Quaternion();
const E = new THREE.Euler();
const S = new THREE.Vector3();

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

const gravityDefault = (motion: SwarmMotion): number => (motion === 'fall' || motion === 'burst' || motion === 'pour' ? 9.81 : 0);

interface Emitter {
  shape: 'point' | 'box' | 'sphere' | 'ring';
  size: THREE.Vector3;
  radius: number;
}

function sampleEmitter(rand: () => number, emitter: Emitter, out: THREE.Vector3): THREE.Vector3 {
  if (emitter.shape === 'point') return out.set(0, 0, 0);
  if (emitter.shape === 'sphere') {
    const r = Math.cbrt(rand()) * emitter.radius;
    const theta = rand() * Math.PI * 2;
    const z = rand() * 2 - 1;
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    return out.set(r * s * Math.cos(theta), r * z, r * s * Math.sin(theta));
  }
  if (emitter.shape === 'ring') {
    const a = rand() * Math.PI * 2;
    return out.set(Math.cos(a) * emitter.radius, 0, Math.sin(a) * emitter.radius);
  }
  const half = emitter.size.clone().multiplyScalar(0.5);
  return out.set((rand() - 0.5) * 2 * half.x, (rand() - 0.5) * 2 * half.y, (rand() - 0.5) * 2 * half.z);
}

const axisVector = (v: readonly number[]): THREE.Vector3 => new THREE.Vector3(v[0], v[1], v[2]).normalize();

function randomInCone(rand: () => number, axis: THREE.Vector3, halfAngleDeg: number, out: THREE.Vector3): THREE.Vector3 {
  const cosMax = Math.cos((halfAngleDeg * Math.PI) / 180);
  const cosTheta = 1 - rand() * (1 - cosMax);
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const phi = rand() * Math.PI * 2;
  Q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  return out.set(sinTheta * Math.cos(phi), cosTheta, sinTheta * Math.sin(phi)).applyQuaternion(Q);
}

/** Every per-copy constant, built once. `halfHeight` is one copy's local half-height (the bounce rest pose). */
export function createSwarmConstants(swarm: Swarm3D, halfHeight = 0.5): SwarmConstants {
  const motion = swarm.motion;
  const rand = mulberry32(swarm.seed ?? 1);
  const count = Math.max(1, Math.min(swarm.count, 400));
  const speed = swarm.speed ?? 1.5;
  const spread = swarm.spread ?? 35;
  const spinDeg = swarm.spin ?? 240;
  const sizeJitter = swarm.sizeJitter ?? 0.25;
  const stagger = swarm.stagger ?? (motion === 'pour' ? 0.8 * (swarm.duration ?? 1.5) : 0.4);
  const gravity = swarm.gravity ?? gravityDefault(motion);
  const drag = swarm.drag ?? (motion === 'burst' ? 2 : 0);
  const center = new THREE.Vector3(...swarm.emitter.center);
  const emitter: Emitter = {
    shape: swarm.emitter.shape,
    size: new THREE.Vector3(...(swarm.emitter.size ?? [0.4, 0, 0.4])),
    radius: swarm.emitter.radius ?? 0.3,
  };
  const orbit = swarm.orbit
    ? {
        radius: swarm.orbit.radius,
        angularSpeed: (swarm.orbit.angularSpeed * Math.PI) / 180,
        height: swarm.orbit.height ?? 0.1,
        bob: swarm.orbit.bob ?? 0.02,
      }
    : null;
  const drift =
    motion === 'drift'
      ? {
          velocity: new THREE.Vector3(...(swarm.drift?.velocity ?? [0, 0.05, 0])),
          amplitude: new THREE.Vector3(...(swarm.drift?.amplitude ?? [0.03, 0.03, 0.03])),
          frequency: swarm.drift?.frequency ?? 0.4,
        }
      : null;
  const baseDir = motion === 'fall' ? axisVector(swarm.direction ?? [0, -1, 0]) : axisVector(swarm.direction ?? [0, 1, 0]);

  const copies: SwarmCopy[] = [];
  for (let i = 0; i < count; i++) {
    const speedK = rand();
    const heightK = rand();
    const sizeK = rand();
    const phase = rand();
    const offset = sampleEmitter(rand, emitter, new THREE.Vector3()).add(center);
    const dir = motion === 'burst' || motion === 'pour' ? randomInCone(rand, baseDir, spread, new THREE.Vector3()) : baseDir.clone();
    copies.push({
      p0: motion === 'pour' ? center.clone() : offset,
      dir,
      speed: speed * (1 + sizeJitter * (sizeK * 2 - 1)),
      rot0: new THREE.Euler(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2),
      spin: new THREE.Vector3(
        (rand() * 2 - 1) * spinDeg * (Math.PI / 180),
        (rand() * 2 - 1) * spinDeg * (Math.PI / 180),
        (rand() * 2 - 1) * spinDeg * (Math.PI / 180),
      ),
      startDelay: (i / count) * stagger,
      size: 1 + sizeJitter * (sizeK * 2 - 1),
      speedK,
      heightK,
      sizeK,
      phase,
    });
  }

  return {
    motion,
    count,
    gravity,
    drag,
    bounce: swarm.bounce ?? false,
    growFrames: swarm.growFrames ?? 3,
    fps: swarm.fps,
    center,
    orbit,
    drift,
    halfHeight,
    copies,
  };
}

function travel(t: number, drag: number): number {
  return drag > 0 ? (1 - Math.exp(-drag * t)) / drag : t;
}

/** One bounce, then rest at half the copy's height. */
function bounced(constants: SwarmConstants, copy: SwarmCopy, t: number, gravity: number): { y: number; restSeconds: number } | null {
  if (gravity <= 0) return null;
  const vy = copy.dir.y * copy.speed;
  const y0 = copy.p0.y;
  const disc = vy * vy + 2 * gravity * y0;
  if (disc < 0) return null;
  const hit = (vy + Math.sqrt(disc)) / gravity;
  if (hit <= 0 || t < hit) return null;
  const vHit = Math.abs(vy - gravity * hit);
  const tb = t - hit;
  if (tb <= 0) return { y: 0, restSeconds: 0 };
  const lift = (0.3 * 0.3 * vHit * vHit) / (2 * gravity);
  const duration = (2 * 0.3 * vHit) / gravity;
  if (tb < duration) {
    const u = tb / duration;
    return { y: 4 * lift * u * (1 - u), restSeconds: 0 };
  }
  return { y: constants.halfHeight * copy.size, restSeconds: tb - duration };
}

/** Poses copy `index` at `seconds` since the swarm began; writes `out`. */
export function swarmPose(constants: SwarmConstants, index: number, seconds: number, out: THREE.Matrix4): void {
  const copy = constants.copies[index];
  const t = seconds - copy.startDelay;
  if (t <= 0) {
    out.makeScale(0, 0, 0);
    return;
  }
  const { motion, gravity, drag, fps } = constants;
  let x = 0;
  let y = 0;
  let z = 0;
  let bounceRest = 0;

  if (motion === 'fall' || motion === 'burst' || motion === 'pour') {
    const dist = travel(t, drag);
    x = copy.p0.x + copy.dir.x * copy.speed * dist;
    z = copy.p0.z + copy.dir.z * copy.speed * dist;
    y = copy.p0.y + copy.dir.y * copy.speed * dist - 0.5 * gravity * t * t;
    if (constants.bounce && motion === 'fall') {
      const b = bounced(constants, copy, t, gravity);
      if (b !== null) {
        y = b.y;
        bounceRest = b.restSeconds;
      }
    }
  } else if (motion === 'drift' && constants.drift) {
    const d = constants.drift;
    const phase = Math.PI * 2 * d.frequency * t;
    x = copy.p0.x + d.velocity.x * t + d.amplitude.x * Math.sin(phase + Math.PI * 2 * copy.phase);
    y = copy.p0.y + d.velocity.y * t + d.amplitude.y * Math.sin(phase + Math.PI * 2 * copy.heightK);
    z = copy.p0.z + d.velocity.z * t + d.amplitude.z * Math.sin(phase + Math.PI * 2 * copy.sizeK);
  } else if (constants.orbit) {
    const o = constants.orbit;
    const radius = o.radius * (0.8 + 0.4 * copy.speedK);
    const angle = Math.PI * 2 * copy.phase + o.angularSpeed * t;
    x = constants.center.x + Math.cos(angle) * radius;
    z = constants.center.z + Math.sin(angle) * radius;
    y = constants.center.y + (copy.heightK - 0.5) * o.height + o.bob * Math.sin(Math.PI * t + Math.PI * 2 * copy.phase);
  } else {
    x = copy.p0.x;
    y = copy.p0.y;
    z = copy.p0.z;
  }

  let s = copy.size;
  if (constants.growFrames > 0) {
    const g = Math.min(1, (t * fps) / constants.growFrames);
    s *= 1 - (1 - g) * (1 - g) * (1 - g);
  }

  V.set(x, y, z);
  E.set(copy.rot0.x + copy.spin.x * t, copy.rot0.y + copy.spin.y * t, copy.rot0.z + copy.spin.z * t);
  Q.setFromEuler(E);
  if (bounceRest > 0) {
    const snapped = new THREE.Euler(Math.round(E.x / (Math.PI / 2)) * (Math.PI / 2), E.y, Math.round(E.z / (Math.PI / 2)) * (Math.PI / 2));
    Q2.setFromEuler(snapped);
    Q.slerp(Q2, Math.min(1, (bounceRest * fps) / 4));
  }
  S.set(s, s, s);
  out.compose(V, Q, S);
}

export interface SwarmRig {
  mesh: THREE.InstancedMesh;
  /** Poses every copy for `seconds` since the swarm began. */
  setTime: (seconds: number) => void;
}

const MATRIX = new THREE.Matrix4();

/**
 * One InstancedMesh from an already fitted source mesh: its local matrix is baked into the instanced
 * geometry so copies keep the source's size and base pivot, and copies share its first material.
 */
export function buildSwarm(source: THREE.Mesh, cfg: Swarm3D): SwarmRig {
  source.updateWorldMatrix(true, false);
  const geometry = source.geometry.clone();
  geometry.applyMatrix4(source.matrixWorld);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(1, 1, 1);
  const material = Array.isArray(source.material) ? source.material[0] : source.material;
  const constants = createSwarmConstants(cfg, box.y / 2);
  const mesh = new THREE.InstancedMesh(geometry, material, constants.count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  const setTime = (seconds: number): void => {
    for (let i = 0; i < constants.count; i++) {
      swarmPose(constants, i, seconds, MATRIX);
      mesh.setMatrixAt(i, MATRIX);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  setTime(0);
  return { mesh, setTime };
}
