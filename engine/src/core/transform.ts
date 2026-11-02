// Ported idea from reacthub-pixitweenjs src/hocs/AbstractContainer.tsx and src/utils/blendMode.ts (MIT).
import * as THREE from 'three';
import type { Layer } from '../schema';
import type { TargetRef } from './paths';
import { toWorldRotation, toWorldY } from './stage';

// Every 2D node has `display` (the layer transform) and `content` (the meshes, laid out in pixels
// from (0, 0) to (width, -height)). The content is offset by the anchor so position, rotation and
// scale act about the anchor point, like the library's pivot.

const DEG_TO_RAD = Math.PI / 180;

export function createLayerObjects(layer: Pick<Layer, 'id'>): { display: THREE.Group; content: THREE.Group } {
  const display = new THREE.Group();
  display.name = layer.id;
  const content = new THREE.Group();
  content.name = `${layer.id}:content`;
  display.add(content);
  return { display, content };
}

export function applyBaseTransform(
  display: THREE.Object3D,
  content: THREE.Object3D,
  layer: Pick<Layer, 'x' | 'y' | 'rotation' | 'scale' | 'anchor' | 'pivot'>,
  size: { width: number; height: number },
): void {
  display.position.set(layer.x, toWorldY(layer.y), 0);
  display.rotation.z = toWorldRotation(layer.rotation * DEG_TO_RAD);
  if (typeof layer.scale === 'number') display.scale.set(layer.scale, layer.scale, 1);
  else display.scale.set(layer.scale[0], layer.scale[1], 1);
  setAnchor(content, layer.anchor, size, layer.pivot);
}

/**
 * Re-applies the anchor offset when a node's size changes (text redraws, late image loads).
 * `pivot`, when given, is a pixel offset that overrides the fractional anchor (AEP anchor points
 * are pixels, not 0..1 fractions of a measured size), and is unaffected by `size`.
 */
export function setAnchor(
  content: THREE.Object3D,
  anchor: readonly [number, number],
  size: { width: number; height: number },
  pivot?: readonly [number, number],
): void {
  if (pivot) content.position.set(-pivot[0], pivot[1], 0);
  else content.position.set(-anchor[0] * size.width, anchor[1] * size.height, 0);
}

interface BaseTargetNode {
  display: THREE.Object3D;
  alpha: { value: number };
}

/** Doc-space accessors over the display: `y` down, rotation clockwise (radians, from the compiler). */
function makeProxy(node: BaseTargetNode): Record<string, number> {
  const { display, alpha } = node;
  return {
    get x() {
      return display.position.x;
    },
    set x(v: number) {
      display.position.x = v;
    },
    get y() {
      return -display.position.y;
    },
    set y(v: number) {
      display.position.y = toWorldY(v);
    },
    get rotation() {
      return -display.rotation.z;
    },
    set rotation(v: number) {
      display.rotation.z = toWorldRotation(v);
    },
    get scale() {
      return display.scale.x;
    },
    set scale(v: number) {
      display.scale.x = v;
      display.scale.y = v;
    },
    get scaleX() {
      return display.scale.x;
    },
    set scaleX(v: number) {
      display.scale.x = v;
    },
    get scaleY() {
      return display.scale.y;
    },
    set scaleY(v: number) {
      display.scale.y = v;
    },
    get alpha() {
      return alpha.value;
    },
    set alpha(v: number) {
      alpha.value = v;
    },
  };
}

const proxies = new WeakMap<THREE.Object3D, Record<string, number>>();

const BASE_PROPS = new Set(['x', 'y', 'alpha', 'scale', 'scaleX', 'scaleY']);

export function resolveBaseTarget(node: BaseTargetNode, prop: string): TargetRef | null {
  if (prop !== 'rotation' && !BASE_PROPS.has(prop)) return null;
  let proxy = proxies.get(node.display);
  if (!proxy) {
    proxy = makeProxy(node);
    proxies.set(node.display, proxy);
  }
  return { obj: proxy, key: prop, kind: prop === 'rotation' ? 'deg' : 'number' };
}

export type BlendMode = Layer['blendMode'];

export function blendingFor(mode: BlendMode): Partial<THREE.Material> {
  switch (mode) {
    case 'add':
      return { blending: THREE.AdditiveBlending };
    case 'multiply':
      return { blending: THREE.MultiplyBlending, premultipliedAlpha: true };
    case 'screen':
      // premultipliedAlpha scales the colour by the layer alpha, so the One/OneMinusSrcColor factors
      // give dst*(1 - src*alpha); without it a 0.35-alpha screen layer blends at full strength.
      return {
        premultipliedAlpha: true,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcColorFactor,
      };
    case 'soft-light':
      // The soft-light material blends the layer into the frame behind it itself and writes the
      // result, so it replaces the frame instead of blending with it a second time.
      return { blending: THREE.NoBlending };
    case 'normal':
    default:
      return { blending: THREE.NormalBlending };
  }
}

export function applyBlendMode(material: THREE.Material, mode: BlendMode): void {
  Object.assign(material, blendingFor(mode));
}
