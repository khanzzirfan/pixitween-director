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
      return buildExtrude(spec);
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
