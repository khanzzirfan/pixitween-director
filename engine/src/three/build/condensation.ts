import * as THREE from 'three';

// Condensation: the beads of water on a cold can. A tiling height map of round beads (domes, mostly small, some touching), used as a bump
// map, so the lights catch every bead as a small highlight, the way a cold can in a commercial shines. Made once and shared: the same
// seed always gives the same beads.

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

/**
 * The height of a field of beads, `size` by `size`, values 0 to 255 (a dome per bead: its height is the sphere's). It wraps at the
 * edges, so it tiles. Most beads are small and a few are bigger drops, as on a real cold can: a field of a few big round beads reads
 * as dents in the label, not water.
 */
export function beadHeights(size = 512, beads = 16, seed = 7): Uint8Array {
  const rand = mulberry32(seed);
  const h = new Uint8Array(size * size);
  for (let b = 0; b < beads; b++) {
    // mostly fine beads, a few big drops: water collects, it is never an even dust
    const r = Math.max(1.2, size * (0.01 + 0.014 * rand() ** 2));
    const cx = rand() * size;
    const cy = rand() * size;
    const height = 0.6 + 0.4 * rand();
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        const d = Math.hypot(dx, dy);
        if (d >= r) continue;
        const v = Math.round(255 * height * Math.sqrt(1 - (d / r) ** 2));
        const x = (((Math.floor(cx) + dx) % size) + size) % size;
        const y = (((Math.floor(cy) + dy) % size) + size) % size;
        if (v > h[y * size + x]!) h[y * size + x] = v;
      }
    }
  }
  return h;
}

/** How much of the beads' height each smaller copy of the map keeps (copy n keeps this to the n): see `beadLevels`. */
export const BEAD_FADE = 0.5;

/**
 * The map and its smaller copies, the ones the GPU reads when the can is small in the frame. Each copy halves the last; its beads
 * are flattened by `BEAD_FADE` per step, so a far can turns smoothly glossy and never smears its beads into blotches. Red is the
 * height (the bump), green the roughness: a bead is clear and glossy, the can between beads keeps its own finish.
 */
export function beadLevels(heights: Uint8Array, size: number): Array<{ data: Uint8Array; width: number; height: number }> {
  let h: Float32Array = Float32Array.from(heights, (v) => v / 255);
  let wet: Float32Array = Float32Array.from(heights, (v) => (v > 0 ? 1 : 0));
  const levels: Array<{ data: Uint8Array; width: number; height: number }> = [];
  for (let n = 0, s = size; s >= 1; n++, s >>= 1) {
    if (n > 0) {
      const half = (a: Float32Array): Float32Array => {
        const out = new Float32Array(s * s);
        const p = s * 2;
        for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) out[y * s + x] = (a[2 * y * p + 2 * x]! + a[2 * y * p + 2 * x + 1]! + a[(2 * y + 1) * p + 2 * x]! + a[(2 * y + 1) * p + 2 * x + 1]!) / 4;
        return out;
      };
      h = half(h);
      wet = half(wet);
    }
    const keep = BEAD_FADE ** n;
    const data = new Uint8Array(s * s * 4);
    for (let i = 0; i < s * s; i++) {
      // a bead is glossy (0.1 of the finish), dry can is its own finish (1); a far, faded copy drifts back towards the dry finish
      const gloss = 1 - 0.9 * wet[i]! * keep;
      data.set([Math.round(255 * h[i]! * keep), Math.round(255 * gloss), 0, 255], i * 4);
    }
    levels.push({ data, width: s, height: s });
  }
  return levels;
}

let shared: THREE.DataTexture | undefined;

/** The bead bump texture (one for every can in the film). */
export function beadTexture(): THREE.DataTexture {
  if (shared) return shared;
  const size = 512;
  const levels = beadLevels(beadHeights(size), size);
  const t = new THREE.DataTexture(levels[0]!.data, size, size, THREE.RGBAFormat);
  t.mipmaps = levels as unknown as THREE.DataTexture['mipmaps'];
  t.generateMipmaps = false;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  shared = t;
  return t;
}

/**
 * Wets a material: the bead bump map at a strength from `amount` (0 to 1), the surface a little glossier. The beads repeat so they
 * stay small on a large body. Does nothing at 0.
 */
export function wet(material: THREE.MeshStandardMaterial, amount: number): void {
  if (amount <= 0) return;
  const beads = beadTexture().clone();
  beads.needsUpdate = true;
  // a can's label is about as long round as it is tall, so the same repeat both ways keeps the beads round
  beads.repeat.set(1.5, 1.5);
  material.bumpMap = beads;
  material.bumpScale = 0.3 + 0.7 * amount;
  material.roughnessMap = beads;
  material.roughness = Math.max(0.1, material.roughness * (1 - 0.4 * amount));
  if (material instanceof THREE.MeshPhysicalMaterial) material.clearcoat = Math.max(material.clearcoat, 0.6 + 0.4 * amount);
}
