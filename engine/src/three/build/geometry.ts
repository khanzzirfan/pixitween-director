// Ported from reacthub-pixitweenjs src/components/AepComposition/model3d/geometry.ts (MIT).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { type Geometry3D } from '../../schema/layer3d';

// Primitive geometries for `three` layers. Every builder returns a BufferGeometry in model units
// centred on the origin (BoxGeometry and PlaneGeometry are already centred). glTF geometry is loaded
// asynchronously elsewhere, so it is not part of this union.

export type PrimitiveGeometry = Exclude<Geometry3D, { type: 'gltf' | 'text3d' | 'liquid' | 'mirror' | 'smoke' | 'caustics' }>;

// Segment counts from the spec (engine/docs/04-three.md): a sphere is 48 x 32, a cylinder has 48
// radial segments and a torus is 32 radial x 96 tubular, so primitives stay smooth without being
// needlessly dense.
const SPHERE_WIDTH_SEGMENTS = 48;
const SPHERE_HEIGHT_SEGMENTS = 32;
const CYLINDER_RADIAL_SEGMENTS = 48;
const ROUND_SEGMENTS = 3;
const TORUS_RADIAL_SEGMENTS = 32;
const TORUS_TUBULAR_SEGMENTS = 96;

export function buildGeometry(spec: PrimitiveGeometry): THREE.BufferGeometry {
  switch (spec.type) {
    case 'box':
      return spec.round
        ? new RoundedBoxGeometry(spec.size[0], spec.size[1], spec.size[2], ROUND_SEGMENTS, spec.round * Math.min(...spec.size))
        : new THREE.BoxGeometry(spec.size[0], spec.size[1], spec.size[2]);
    case 'sphere':
      return new THREE.SphereGeometry(spec.radius, SPHERE_WIDTH_SEGMENTS, SPHERE_HEIGHT_SEGMENTS);
    case 'cylinder':
      return new THREE.CylinderGeometry(spec.radiusTop, spec.radiusBottom, spec.height, CYLINDER_RADIAL_SEGMENTS);
    case 'torus':
      return new THREE.TorusGeometry(spec.radius, spec.tube, TORUS_RADIAL_SEGMENTS, TORUS_TUBULAR_SEGMENTS);
    case 'plane':
      return new THREE.PlaneGeometry(spec.size[0], spec.size[1]);
    case 'extrude':
      return spec.section !== undefined ? buildBody(spec) : buildExtrude(spec);
    case 'lathe':
      return buildLathe(spec);
  }
}

// Profile tables are [radiusFraction, heightFraction], bottom (0) to top (1). Radius 0 at an end closes
// that end of the lathe. Same tables as the reacthub-pixitweenjs model3d primitives.
const LATHE_PROFILES: Record<Extract<PrimitiveGeometry, { type: 'lathe' }>['shape'], ReadonlyArray<readonly [number, number]>> = {
  can: [[0, 0], [0.5, 0], [0.5, 0.04], [0.5, 0.9], [0.48, 0.95], [0.4, 0.99], [0.4, 1], [0, 1]],
  bottle: [[0, 0], [0.3, 0], [0.4, 0.05], [0.42, 0.2], [0.4, 0.55], [0.34, 0.68], [0.18, 0.78], [0.14, 0.86], [0.14, 0.96], [0.18, 1], [0, 1]],
  jar: [[0, 0], [0.46, 0], [0.5, 0.04], [0.5, 0.82], [0.46, 0.9], [0.4, 0.94], [0.4, 1], [0, 1]],
  tube: [[0, 0], [0.34, 0], [0.34, 0.08], [0.34, 0.88], [0.3, 0.94], [0.3, 1], [0, 1]],
  pouch: [[0, 0], [0.22, 0], [0.38, 0.05], [0.46, 0.2], [0.44, 0.6], [0.38, 0.82], [0.24, 0.94], [0.18, 1], [0, 1]],
};
const LATHE_SEGMENTS = 64;

function buildLathe(spec: Extract<PrimitiveGeometry, { type: 'lathe' }>): THREE.BufferGeometry {
  const profile = LATHE_PROFILES[spec.shape];
  const points = profile.map(([r, h]) => new THREE.Vector2(Math.max(0, r * spec.width), (h - 0.5) * spec.height));
  const geometry = new THREE.LatheGeometry(points, LATHE_SEGMENTS);
  // LatheGeometry sets v from the profile point INDEX, so a body spanning a few points would squeeze
  // the label into a sliver; v is remapped to the real height fraction (0 bottom, 1 top).
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, profile[i % profile.length][1]);
  uv.needsUpdate = true;
  return geometry;
}

// The contour is in image pixels (y down), so y is flipped. Caps get a planar UV over the contour's box;
// sides wrap the same map along the depth. Centred on the origin in all three axes.
function buildExtrude(spec: Extract<PrimitiveGeometry, { type: 'extrude' }>): THREE.BufferGeometry {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of spec.contour) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const width = Math.max(maxX - minX, 1e-6);
  const height = Math.max(maxY - minY, 1e-6);
  const shape = new THREE.Shape();
  spec.contour.forEach(([x, y], index) => {
    if (index === 0) shape.moveTo(x - cx, cy - y);
    else shape.lineTo(x - cx, cy - y);
  });
  shape.closePath();

  const depth = Math.max(spec.depth, 1e-6);
  const bevel = Math.max(0, spec.bevel ?? 0);
  const uvGenerator = {
    generateTopUV(_g: THREE.ExtrudeGeometry, v: number[], a: number, b: number, c: number): THREE.Vector2[] {
      const uv = (i: number) => new THREE.Vector2((v[i * 3] + width / 2) / width, (v[i * 3 + 1] + height / 2) / height);
      return [uv(a), uv(b), uv(c)];
    },
    generateSideWallUV(_g: THREE.ExtrudeGeometry, v: number[], a: number, b: number, c: number, d: number): THREE.Vector2[] {
      const uv = (i: number) =>
        new THREE.Vector2((v[i * 3] + width / 2) / width, (v[i * 3 + 1] + height / 2) / height + v[i * 3 + 2] / depth);
      return [uv(a), uv(b), uv(c), uv(d)];
    },
  };
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: bevel > 0 ? 2 : 0,
    curveSegments: 16,
    UVGenerator: uvGenerator,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

const BODY_ROWS = 72;
const BODY_ARC = 28;
/** How far inside the outline, as a share of the width, the side wall reads the photo. */
const BODY_EDGE_INSET = 0.012;

/** The left and right edge of the outline across the row at height `y` (image pixels, y down), or undefined when the outline does not reach it. */
function rowSpan(contour: ReadonlyArray<readonly [number, number]>, y: number): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < contour.length; i++) {
    const [x0, y0] = contour[i]!;
    const [x1, y1] = contour[(i + 1) % contour.length]!;
    if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
      const x = x0 + ((y - y0) / (y1 - y0)) * (x1 - x0);
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
  }
  return lo <= hi ? [lo, hi] : undefined;
}

// A solid from the cut-out's outline: each row (or, for a body lying across, each column) is swept round a centre line into a superellipse of its own width, as deep as `depth` is to the widest row.
// The front half's UVs are the photo laid flat; the back half reads it the other way so its text is not mirrored. Centred on the origin in all three axes.
// Written in (a, b): a runs across a slice and b along the body, so an upright body has (a, b) = (x, y) and a body lying across has (a, b) = (y, x).
function buildBody(spec: Extract<PrimitiveGeometry, { type: 'extrude' }>): THREE.BufferGeometry {
  const across = spec.axis === 'across';
  const contour = across ? spec.contour.map(([x, y]) => [y, x] as const) : spec.contour;
  let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
  for (const [a, b] of contour) {
    minA = Math.min(minA, a); maxA = Math.max(maxA, a);
    minB = Math.min(minB, b); maxB = Math.max(maxB, b);
  }
  const width = Math.max(maxA - minA, 1e-6);
  const height = Math.max(maxB - minB, 1e-6);
  const cA = (minA + maxA) / 2;
  const cB = (minB + maxB) / 2;
  const ratio = Math.max(spec.depth, 1e-6) / width;
  const power = 2 / (spec.section ?? 2);

  // one span per slice, sampled at the middle of its band; a slice the outline misses takes its neighbour's
  const spans: Array<[number, number]> = [];
  for (let j = 0; j <= BODY_ROWS; j++) {
    const t = minB + (height * Math.min(Math.max(j, 0.01), BODY_ROWS - 0.01)) / BODY_ROWS;
    const span = rowSpan(contour, t) ?? spans[j - 1];
    spans.push(span ?? [cA, cA]);
  }
  for (let j = BODY_ROWS - 1; j >= 0; j--) if (spans[j]![0] === cA && spans[j]![1] === cA && spans[j + 1]![0] !== spans[j + 1]![1]) spans[j] = spans[j + 1]!;

  const positions: number[] = [];
  const uvs: number[] = [];
  const views: number[] = [];
  const index: number[] = [];
  const per = BODY_ARC + 1;
  for (const back of [false, true]) {
    const base = positions.length / 3;
    for (let j = 0; j <= BODY_ROWS; j++) {
      const [lo, hi] = spans[j]!;
      const mid = (lo + hi) / 2;
      const half = (hi - lo) / 2;
      const b = minB + (height * j) / BODY_ROWS;
      for (let k = 0; k <= BODY_ARC; k++) {
        const theta = Math.PI * (k / BODY_ARC) + (back ? Math.PI : 0);
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        // the end slices close the body: they shrink to the centre line
        const close = j === 0 || j === BODY_ROWS ? 0 : 1;
        const a = mid + close * half * Math.sign(c) * Math.abs(c) ** power;
        const z = close * half * ratio * Math.sign(s) * Math.abs(s) ** power;
        if (across) positions.push(b - cB, cA - a, z);
        else positions.push(a - cA, cB - b, z);
        // the side wall would stretch the photo's last pixels across its whole depth into stripes: as the surface turns side-on its picture is eased to the edge (a little inside, clear of the cut-out's clear border)
        const edge = (mid + Math.sign(c) * half - minA) / width - Math.sign(c) * BODY_EDGE_INSET;
        const side = Math.min(1, Math.max(0, (Math.abs(c) - 0.75) / 0.22));
        const ease = side * side * (3 - 2 * side);
        const aFlat = (a - minA) / width;
        const along = (b - minB) / height;
        if (across) {
          // the photo's x runs along the body (the back reads it the other way round); its y runs across it and is the one eased on the side wall
          const v = 1 - aFlat;
          const vEdge = 1 - edge;
          uvs.push(back ? 1 - along : along, v + (vEdge - v) * ease);
        } else {
          // the back reads the picture the other way round, but both halves end on the same edge column so the side wall has no seam
          const flat = back ? 1 - aFlat : aFlat;
          uvs.push(flat + (edge - flat) * ease, 1 - along);
          // the pictures laid along their own directions (engine/src/three/build/views.ts): the photo's u straight across the front, and the side
          // picture's u across the depth, the front (+z) at its left; one formula all round, so the blend has no seam
          if (spec.views) views.push(aFlat, 1 - along, 0.5 - z / Math.max(2 * half * ratio, 1e-6));
        }
      }
    }
    for (let j = 0; j < BODY_ROWS; j++) {
      for (let k = 0; k < BODY_ARC; k++) {
        const p = base + j * per + k;
        const q = p + 1;
        const r = p + per;
        const t = r + 1;
        // sweeping columns instead of rows mirrors the body, so its triangles are wound the other way to keep the faces outward
        if (across) index.push(p, r, q, q, r, t);
        else index.push(p, q, r, q, t, r);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  // group 0 is the front half, group 1 the back half: a body given a back picture wears two materials (one material ignores the groups)
  const halfIndices = index.length / 2;
  geometry.addGroup(0, halfIndices, 0);
  geometry.addGroup(halfIndices, halfIndices, 1);
  geometry.computeVertexNormals();
  // the two halves meet along the silhouette; their normals are averaged there so the shading has no crease
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const half = positions.length / 3 / 2;
  const mix = new THREE.Vector3();
  for (let j = 0; j <= BODY_ROWS; j++) {
    for (const [f, b] of [[0, BODY_ARC], [BODY_ARC, 0]] as const) {
      const fi = j * per + f;
      const bi = half + j * per + b;
      mix.set(normal.getX(fi) + normal.getX(bi), normal.getY(fi) + normal.getY(bi), normal.getZ(fi) + normal.getZ(bi)).normalize();
      normal.setXYZ(fi, mix.x, mix.y, mix.z);
      normal.setXYZ(bi, mix.x, mix.y, mix.z);
    }
  }
  if (views.length) geometry.setAttribute('views', new THREE.Float32BufferAttribute(views, 3));
  return geometry;
}

