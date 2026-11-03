import * as THREE from 'three';

// Soft vapour: steam rising off a product, a cloud of smoke that wraps it and clears, or a burst of fine powder.
//
// Cloud and powder are many soft puffs, each a quad that always faces the camera (turned in the vertex shader), drawn as one instanced
// mesh. Steam is a few tall ribbons cut into wisps by a noise texture that scrolls upward, twisted and blown sideways by the same noise
// (the coffee-smoke shader technique from Bruno Simon's Three.js Journey, written here from scratch). Everything is a closed-form
// function of time and a seed, so seeking backwards and rendering a frame twice give the same picture (a particle library that
// simulates step by step with unseeded randomness cannot do that).
//
// Units: the puffs live in a box `size` across, standing on the object's origin (like a liquid), positions in box units 0..1.

export const SMOKE_FORMS = ['steam', 'cloud', 'powder'] as const;
export type SmokeForm = (typeof SMOKE_FORMS)[number];

export interface Puff {
  x: number;
  y: number;
  z: number;
  /** Diameter in box units. */
  size: number;
  alpha: number;
  /** Turn of the puff's picture, radians. */
  spin: number;
}

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

/** Cloud: a thick bank of smoke round the middle that slowly rolls and swells, then thins and clears to reveal what is inside. */
function cloud(t: number, d: number, rand: () => number): Puff[] {
  const out: Puff[] = [];
  const n = 30;
  const clear = 1 - clamp01((t / d - 0.45) / 0.5);
  const grow = clamp01(t / 0.35);
  for (let k = 0; k < n; k++) {
    const a = rand() * Math.PI * 2;
    const r = 0.12 + 0.26 * rand();
    const y = 0.12 + 0.6 * rand();
    const roll = (0.15 + 0.2 * rand()) * (rand() < 0.5 ? -1 : 1);
    const ang = a + roll * t;
    const spread = 1 + 0.35 * (t / d);
    out.push({
      x: 0.5 + Math.cos(ang) * r * spread,
      y: y + 0.05 * Math.sin(t * 0.8 + a),
      z: 0.5 + Math.sin(ang) * r * spread,
      size: (0.28 + 0.22 * rand()) * (0.6 + 0.4 * grow) * spread,
      alpha: 0.55 * grow * clear,
      spin: a + roll * t * 2,
    });
  }
  return out;
}

/** Powder: a burst of fine dust out of the middle that flies outward, slows in the air, sinks a little and fades. */
function powder(t: number, d: number, rand: () => number): Puff[] {
  const out: Puff[] = [];
  const n = 90;
  for (let k = 0; k < n; k++) {
    const born = rand() * 0.15;
    const age = t - born;
    if (age <= 0) {
      rand();
      rand();
      rand();
      rand();
      continue;
    }
    const a = rand() * Math.PI * 2;
    const up = (rand() - 0.25) * 0.9;
    const speed = 0.5 + 0.7 * rand();
    // drag: the burst slows to a drift; the distance gone is speed * (1 - e^-kt) / k
    const kdrag = 3;
    const go = (speed * (1 - Math.exp(-kdrag * age))) / kdrag;
    const big = rand();
    out.push({
      x: 0.5 + Math.cos(a) * go,
      y: 0.35 + up * go - 0.05 * age * age,
      z: 0.5 + Math.sin(a) * go,
      size: 0.02 + 0.07 * big * big + 0.05 * age,
      alpha: 0.5 * clamp01(age / 0.05) * clamp01((d - t) / (0.5 * d)),
      spin: a,
    });
  }
  return out;
}

/** The puffs of `form` at `t` seconds of a `duration`-second life. Pure: the same arguments give the same puffs. */
export function smokePuffs(form: Exclude<SmokeForm, 'steam'>, t: number, duration: number, seed = 1): Puff[] {
  const d = Math.max(0.2, duration);
  const time = Math.min(Math.max(0, t), d);
  const rand = mulberry32(seed);
  return form === 'cloud' ? cloud(time, d, rand) : powder(time, d, rand);
}

/** How much of the steam shows at `t` of a `duration`-second life: it rises in over the first half second and thins over the last. */
export function steamFade(t: number, duration: number): number {
  const d = Math.max(0.2, duration);
  return clamp01(t / 0.5) * clamp01((d - t) / 0.6);
}

const NOISE_SIZE = 128;
let noiseTexture: THREE.DataTexture | undefined;
/**
 * Tileable smooth noise in the red channel (four octaves of value noise on a wrapping lattice), the stand-in for a Perlin picture.
 * Seeded, so every frame and every machine gets the same wisps.
 */
export function noiseMap(): THREE.DataTexture {
  if (noiseTexture) return noiseTexture;
  const n = NOISE_SIZE;
  const rand = mulberry32(91);
  const lattice = (cells: number): Float32Array => Float32Array.from({ length: cells * cells }, () => rand());
  const octaves = [4, 8, 16, 32].map((cells, i) => ({ cells, grid: lattice(cells), weight: 0.5 ** (i + 1) }));
  const smooth = (x: number) => x * x * (3 - 2 * x);
  const values = new Float32Array(n * n);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let v = 0;
      for (const o of octaves) {
        const fx = (x / n) * o.cells;
        const fy = (y / n) * o.cells;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = smooth(fx - x0);
        const ty = smooth(fy - y0);
        const at = (cx: number, cy: number) => o.grid[(cy % o.cells) * o.cells + (cx % o.cells)]!;
        const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
        const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
        v += (top * (1 - ty) + bottom * ty) * o.weight;
      }
      values[y * n + x] = v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  const data = new Uint8Array(n * n * 4);
  values.forEach((v, i) => {
    const g = Math.round((255 * (v - lo)) / (hi - lo));
    data.set([g, g, g, 255], i * 4);
  });
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  noiseTexture = t;
  return t;
}

const STEAM_VERTEX = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
vec2 turn(vec2 v, float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, s, -s, c) * v;
}
void main() {
  vec3 p = position;
  // a plume starts thin at its source and spreads as it rises
  p.x *= 0.3 + 0.9 * uv.y;
  // twist: each height turns by its own noise, so the ribbon curls round its own axis
  float twist = texture2D(uNoise, vec2(0.5 + uSeed, uv.y * 0.2 - uTime * 0.03)).r;
  p.xz = turn(p.xz, twist * 10.0);
  // wind: the same noise read elsewhere pushes the top sideways, more the higher it goes
  vec2 wind = vec2(
    texture2D(uNoise, vec2(0.25 + uSeed, uTime * 0.03)).r - 0.5,
    texture2D(uNoise, vec2(0.75 + uSeed, uTime * 0.03)).r - 0.5
  );
  p.xz += wind * uv.y * uv.y * 0.9;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const STEAM_FRAGMENT = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uSeed;
uniform vec3 color;
uniform float opacity;
varying vec2 vUv;
void main() {
  vec2 st = vec2(vUv.x * 0.6 + uSeed, vUv.y * 0.35 - uTime * 0.1);
  float wisp = smoothstep(0.52, 1.0, texture2D(uNoise, st).r);
  wisp *= smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
  wisp *= smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
  float a = wisp * opacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(color, a);
}`;

/** Steam: a few tall twisted ribbons standing on the middle of the box floor, cut into rising wisps. */
function buildSteam(o: SmokeOptions): SmokeRig {
  const group = new THREE.Group();
  const rand = mulberry32(o.seed ?? 1);
  const geometry = new THREE.PlaneGeometry(1, 1, 16, 64);
  geometry.translate(0, 0.5, 0);
  const materials: THREE.ShaderMaterial[] = [];
  const base = o.opacity ?? 1;
  // two ribbons crossed and offset in the noise, so the plume has body from any side
  for (let k = 0; k < 2; k++) {
    const material = new THREE.ShaderMaterial({
      vertexShader: STEAM_VERTEX,
      fragmentShader: STEAM_FRAGMENT,
      uniforms: { uNoise: { value: noiseMap() }, uTime: { value: 0 }, uSeed: { value: rand() }, color: { value: new THREE.Color(o.color) }, opacity: { value: base } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ribbon = new THREE.Mesh(geometry, material);
    ribbon.scale.set(o.size * 0.45, o.size, o.size * 0.45);
    ribbon.rotation.y = k * (Math.PI / 2) + rand() * 0.6;
    ribbon.frustumCulled = false;
    ribbon.renderOrder = 2;
    group.add(ribbon);
    materials.push(material);
  }
  const mesh = new THREE.Mesh();
  mesh.add(group);
  const setTime = (seconds: number): void => {
    const fade = steamFade(seconds, o.duration);
    for (const m of materials) {
      m.uniforms.uTime!.value = seconds;
      m.uniforms.opacity!.value = base * 0.7 * fade;
    }
    group.visible = fade > 0;
  };
  setTime(0);
  return { mesh, setTime };
}

let puffTexture: THREE.DataTexture | undefined;
/** A soft round puff with a little lumpiness, white, alpha only at its edge: tinted by the material colour. */
export function puffMap(): THREE.DataTexture {
  if (puffTexture) return puffTexture;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const rand = mulberry32(17);
  const lumps = Array.from({ length: 7 }, () => ({ x: 0.3 + 0.4 * rand(), y: 0.3 + 0.4 * rand(), r: 0.18 + 0.14 * rand() }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      let a = 0;
      for (const l of lumps) {
        const dd = Math.hypot(u - l.x, v - l.y) / l.r;
        a = Math.max(a, Math.max(0, 1 - dd * dd));
      }
      const edge = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) / 0.5);
      const alpha = Math.round(255 * Math.min(1, a * edge * 1.4));
      data.set([255, 255, 255, alpha], (y * size + x) * 4);
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  puffTexture = t;
  return t;
}

const VERTEX = /* glsl */ `
attribute vec3 aOffset;
attribute float aSize;
attribute float aAlpha;
attribute float aSpin;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vUv = uv;
  vAlpha = aAlpha;
  float c = cos(aSpin);
  float s = sin(aSpin);
  vec2 corner = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * aSize;
  // facing the camera: the corner is added in view space, after the puff's centre is moved there
  vec4 centre = modelViewMatrix * vec4(aOffset, 1.0);
  centre.xy += corner;
  gl_Position = projectionMatrix * centre;
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform vec3 color;
uniform float opacity;
varying vec2 vUv;
varying float vAlpha;
void main() {
  float a = texture2D(map, vUv).a * vAlpha * opacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(color, a);
}`;

export interface SmokeOptions {
  form: SmokeForm;
  duration: number;
  seed?: number;
  /** Edge of the box in world units. */
  size: number;
  color: string;
  opacity?: number;
}

export interface SmokeRig {
  mesh: THREE.Mesh;
  setTime: (seconds: number) => void;
}

const MAX_PUFFS = 120;

/** The vapour as one instanced mesh, `size` across, standing on y = 0. */
export function buildSmoke(o: SmokeOptions): SmokeRig {
  if (o.form === 'steam') return buildSteam(o);
  const form = o.form;
  const geometry = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  geometry.setAttribute('uv', quad.getAttribute('uv'));
  const offsets = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 3), 3);
  const sizes = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS), 1);
  const alphas = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS), 1);
  const spins = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS), 1);
  for (const a of [offsets, sizes, alphas, spins]) a.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aOffset', offsets);
  geometry.setAttribute('aSize', sizes);
  geometry.setAttribute('aAlpha', alphas);
  geometry.setAttribute('aSpin', spins);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { map: { value: puffMap() }, color: { value: new THREE.Color(o.color) }, opacity: { value: o.opacity ?? 1 } },
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.castShadow = false;
  let last = -1;
  const setTime = (seconds: number): void => {
    if (seconds === last) return;
    last = seconds;
    const puffs = smokePuffs(form, seconds, o.duration, o.seed).slice(0, MAX_PUFFS);
    // box units to world: the box is `size` across, centred in x and z, its floor at y = 0
    puffs.forEach((p, i) => {
      offsets.setXYZ(i, (p.x - 0.5) * o.size, p.y * o.size, (p.z - 0.5) * o.size);
      sizes.setX(i, p.size * o.size);
      alphas.setX(i, p.alpha);
      spins.setX(i, p.spin);
    });
    geometry.instanceCount = puffs.length;
    for (const a of [offsets, sizes, alphas, spins]) a.needsUpdate = true;
  };
  setTime(0);
  return { mesh, setTime };
}
