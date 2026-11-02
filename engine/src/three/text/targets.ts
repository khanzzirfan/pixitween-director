import type * as THREE from 'three';
import { pathRef, type TargetRef } from '../../core/paths';
import type { UnitTargetKind } from '../../schema/scalars';
import type { Text3DResult } from './build';

// Rest positions, captured the first time a group is targeted (before any tween has written to it).
const restPositions = new WeakMap<THREE.Object3D, THREE.Vector3>();

function rest(group: THREE.Object3D): THREE.Vector3 {
  let v = restPositions.get(group);
  if (!v) {
    v = group.position.clone();
    restPositions.set(group, v);
  }
  return v;
}

function offsetRef(group: THREE.Object3D, axis: 'x' | 'y' | 'z'): TargetRef {
  const base = rest(group);
  const proxy = {
    get offset(): number {
      return group.position[axis] - base[axis];
    },
    set offset(value: number) {
      group.position[axis] = base[axis] + value;
    },
  };
  return { obj: proxy, key: 'offset', kind: 'number' };
}

function scaleRef(group: THREE.Object3D): TargetRef {
  const proxy = {
    get scale(): number {
      return group.scale.x;
    },
    set scale(value: number) {
      group.scale.setScalar(value);
    },
  };
  return { obj: proxy, key: 'scale', kind: 'number' };
}

function alphaRef(mesh: THREE.Mesh): TargetRef {
  const material = mesh.material as THREE.Material;
  const proxy = {
    get alpha(): number {
      return material.opacity;
    },
    set alpha(value: number) {
      material.opacity = value;
      // `transparent` is part of the shader program key (the OPAQUE define), so flipping it after the
      // first draw needs a recompile; otherwise the glyph keeps drawing fully opaque.
      if (!material.transparent) {
        material.transparent = true;
        material.needsUpdate = true;
      }
    },
  };
  return { obj: proxy, key: 'alpha', kind: 'number' };
}

/**
 * One ref per glyph, word or line group of a text3d object, or null when `prop` is not allowed for
 * that kind. `alpha` needs a material, so it exists for glyphs only.
 */
export function resolveUnitTargets(text: Text3DResult, kind: UnitTargetKind, prop: string): TargetRef[] | null {
  const groups = kind === 'glyphs' ? text.glyphs : kind === 'words' ? text.words : text.lines;
  switch (prop) {
    case 'offset.x':
    case 'offset.y':
    case 'offset.z':
      return groups.map((g) => offsetRef(g, prop.slice(-1) as 'x' | 'y' | 'z'));
    case 'rotation.x':
    case 'rotation.y':
    case 'rotation.z':
      return groups.map((g) => pathRef(g.rotation, prop.slice(-1), 'deg'));
    case 'scale':
      return groups.map(scaleRef);
    case 'scale.x':
    case 'scale.y':
    case 'scale.z':
      return groups.map((g) => pathRef(g.scale, prop.slice(-1), 'number'));
    case 'alpha':
      return kind === 'glyphs' ? text.meshes.map(alphaRef) : null;
    default:
      return null;
  }
}
