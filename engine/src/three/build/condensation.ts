import * as THREE from 'three';

// Condensation: the beads of water on a cold can. A tiling height map of round beads (domes, random sizes, some touching), used as a bump
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

/** The height of a field of beads, `size` by `size`, values 0 to 255 (a dome per bead: its height is the sphere's). It wraps at the edges, so it tiles. */
export function beadHeights(size = 256, beads = 70, seed = 7): Uint8Array {
  const rand = mulberry32(seed);
  const h = new Uint8Array(size * size);
  for (let b = 0; b < beads; b++) {
    // mostly small beads, some big drops: water collects, it is never an even dust
    const r = size * (0.03 + 0.06 * rand() ** 2.2);
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

let shared: THREE.DataTexture | undefined;

/** The bead bump texture (one for every can in the film). */
export function beadTexture(): THREE.DataTexture {
  if (shared) return shared;
  const size = 256;
  const heights = beadHeights(size);
  const rgba = new Uint8Array(size * size * 4);
  // red is the height (bump map), green the roughness: a bead is clear and glossy, the can between beads stays a matte frost
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i]!;
    rgba.set([h, h > 0 ? 24 : 255, 0, 255], i * 4);
  }
  const t = new THREE.DataTexture(rgba, size, size, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
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
  beads.repeat.set(2, 1.5);
  material.bumpMap = beads;
  material.bumpScale = 0.4 + 1.0 * amount;
  material.roughnessMap = beads;
  material.roughness = Math.max(0.1, material.roughness * (1 - 0.4 * amount));
  if (material instanceof THREE.MeshPhysicalMaterial) material.clearcoat = Math.max(material.clearcoat, 0.6 + 0.4 * amount);
}
