// Ported from reacthub-pixitweenjs src/components/AepComposition/model3d/geometry.ts (MIT).
import * as THREE from 'three';
import { type Geometry3D } from '../../schema/layer3d';

// Primitive geometries for `three` layers. Every builder returns a BufferGeometry in model units
// centred on the origin (BoxGeometry and PlaneGeometry are already centred). glTF geometry is loaded
// asynchronously elsewhere, so it is not part of this union.

export type PrimitiveGeometry = Exclude<Geometry3D, { type: 'gltf' }>;

// Segment counts from the spec (engine/docs/04-three.md): a sphere is 48 x 32, a cylinder has 48
// radial segments and a torus is 32 radial x 96 tubular, so primitives stay smooth without being
// needlessly dense.
const SPHERE_WIDTH_SEGMENTS = 48;
const SPHERE_HEIGHT_SEGMENTS = 32;
const CYLINDER_RADIAL_SEGMENTS = 48;
const TORUS_RADIAL_SEGMENTS = 32;
const TORUS_TUBULAR_SEGMENTS = 96;

export function buildGeometry(spec: PrimitiveGeometry): THREE.BufferGeometry {
  switch (spec.type) {
    case 'box':
      return new THREE.BoxGeometry(spec.size[0], spec.size[1], spec.size[2]);
    case 'sphere':
      return new THREE.SphereGeometry(spec.radius, SPHERE_WIDTH_SEGMENTS, SPHERE_HEIGHT_SEGMENTS);
    case 'cylinder':
      return new THREE.CylinderGeometry(spec.radiusTop, spec.radiusBottom, spec.height, CYLINDER_RADIAL_SEGMENTS);
    case 'torus':
      return new THREE.TorusGeometry(spec.radius, spec.tube, TORUS_RADIAL_SEGMENTS, TORUS_TUBULAR_SEGMENTS);
    case 'plane':
      return new THREE.PlaneGeometry(spec.size[0], spec.size[1]);
  }
}
