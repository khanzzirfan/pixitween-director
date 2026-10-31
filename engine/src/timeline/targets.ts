import { formatErrorPath } from '../schema/doc';
import type { MotionDoc } from '../schema/doc';
import type { Layer } from '../schema/layer';
import { PRESET_LIGHT_IDS } from '../schema/layer3d';

export interface TargetError {
  path: string;
  message: string;
}

type PathSegment = string | number;

const BASE_LAYER_PROPS = ['x', 'y', 'alpha', 'rotation', 'scale', 'scaleX', 'scaleY', 'skewX', 'skewY'] as const;

/** The tweenable properties per layer type (engine/docs/02-timeline.md, "Target paths"). */
export const LAYER_PROPS: Record<Layer['type'], readonly string[]> = {
  image: [...BASE_LAYER_PROPS, 'tint'],
  text: [...BASE_LAYER_PROPS, 'fill'],
  shape: [...BASE_LAYER_PROPS, 'fill'],
  group: [...BASE_LAYER_PROPS],
  three: [...BASE_LAYER_PROPS],
};

export const CAMERA_PROPS: readonly string[] = ['position.x', 'position.y', 'position.z', 'lookAt.x', 'lookAt.y', 'lookAt.z', 'fov'];

export const OBJECT_PROPS: readonly string[] = [
  'position.x',
  'position.y',
  'position.z',
  'rotation.x',
  'rotation.y',
  'rotation.z',
  'scale',
  'scale.x',
  'scale.y',
  'scale.z',
  'material.color',
  'material.emissive',
  'material.emissiveIntensity',
  'material.roughness',
  'material.metalness',
  'material.opacity',
];

export const LIGHT_PROPS: readonly string[] = ['intensity', 'color', 'position.x', 'position.y', 'position.z'];

type TargetForm =
  | { kind: 'layer' }
  | { kind: 'camera' }
  | { kind: 'object' | 'light' | 'postfx' | 'filter'; id: string }
  | { kind: 'unknown'; raw: string };

const ID_TARGETS = ['object', 'light', 'postfx', 'filter'] as const;

/** `undefined` -> the layer itself; `camera`; `<prefix>:<id>` (object, light, postfx, filter). */
function parseTarget(raw: string | undefined): TargetForm {
  if (raw === undefined) return { kind: 'layer' };
  if (raw === 'camera') return { kind: 'camera' };
  const colon = raw.indexOf(':');
  if (colon > 0) {
    const prefix = raw.slice(0, colon);
    const id = raw.slice(colon + 1);
    if (id !== '' && (ID_TARGETS as readonly string[]).includes(prefix)) {
      return { kind: prefix as (typeof ID_TARGETS)[number], id };
    }
  }
  return { kind: 'unknown', raw };
}

function idExists(layer: Layer, kind: 'object' | 'light' | 'postfx' | 'filter', id: string): boolean {
  switch (kind) {
    case 'object':
      return layer.type === 'three' && layer.objects.some((object) => object.id === id);
    case 'light':
      return layer.type === 'three' && (layer.lights.some((light) => light.id === id) || (PRESET_LIGHT_IDS as readonly string[]).includes(id));
    case 'postfx':
      return layer.type === 'three' && layer.postFx.some((effect) => effect.id === id);
    case 'filter':
      return layer.filters.some((filter) => filter.id === id);
  }
}

/** The allowlist for a target, or `null` when the form is not allowed on this layer type. */
function allowlistFor(form: TargetForm, layer: Layer): { props: readonly string[]; checkProps: boolean } | null {
  const three = layer.type === 'three';
  switch (form.kind) {
    case 'layer':
      return { props: LAYER_PROPS[layer.type], checkProps: true };
    case 'camera':
      return three ? { props: CAMERA_PROPS, checkProps: true } : null;
    case 'object':
      return three ? { props: OBJECT_PROPS, checkProps: true } : null;
    case 'light':
      return three ? { props: LIGHT_PROPS, checkProps: true } : null;
    case 'postfx':
      return three ? { props: [], checkProps: false } : null;
    case 'filter':
      // Filter and postFx param names are the compiler's job, so only the target itself is checked here.
      return { props: [], checkProps: false };
    case 'unknown':
      return null;
  }
}

function validateTween(layer: Layer, tween: Layer['tweens'][number], tweenPath: PathSegment[], errors: TargetError[]): void {
  const targetPath = [...tweenPath, 'target'];
  const form = parseTarget(tween.target);
  const allowlist = allowlistFor(form, layer);

  if (allowlist === null) {
    const message = form.kind === 'unknown' ? `unknown tween target "${form.raw}"` : `target "${tween.target}" is only allowed on a three layer`;
    errors.push({ path: formatErrorPath(targetPath), message });
    return;
  }

  const targetOf = (kind: string): string => `target "${tween.target}" names a ${kind} this layer does not have`;
  if (form.kind === 'object' && !idExists(layer, 'object', form.id)) {
    errors.push({ path: formatErrorPath(targetPath), message: targetOf('object') });
    return;
  }
  if (form.kind === 'light' && !idExists(layer, 'light', form.id)) {
    errors.push({ path: formatErrorPath(targetPath), message: targetOf('light') });
    return;
  }
  if (form.kind === 'postfx' && !idExists(layer, 'postfx', form.id)) {
    errors.push({ path: formatErrorPath(targetPath), message: targetOf('postFx effect') });
    return;
  }
  if (form.kind === 'filter' && !idExists(layer, 'filter', form.id)) {
    errors.push({ path: formatErrorPath(targetPath), message: targetOf('filter') });
    return;
  }

  if (!allowlist.checkProps) return;

  const allowed = new Set(allowlist.props);
  for (const map of ['to', 'from'] as const) {
    const values = tween[map];
    if (values === undefined) continue;
    for (const key of Object.keys(values)) {
      if (!allowed.has(key)) {
        errors.push({
          path: formatErrorPath([...tweenPath, map, key]),
          message: `unknown property "${key}" on ${tween.target ?? 'layer'}`,
        });
      }
    }
  }
}

function validateLayer(layer: Layer, path: PathSegment[], errors: TargetError[]): void {
  layer.tweens.forEach((tween, index) => validateTween(layer, tween, [...path, 'tweens', index], errors));
  if (layer.type === 'group') {
    layer.children.forEach((child, index) => validateLayer(child, [...path, 'children', index], errors));
  }
}

/**
 * Static check of every tween target and property against the allowlist, so a typo is reported at
 * load time with a path (engine/docs/02-timeline.md, "Target paths"). Returns one error per bad
 * target or property; a bad target short-circuits that tween's property checks.
 */
export function validateTargets(doc: MotionDoc): TargetError[] {
  const errors: TargetError[] = [];
  doc.layers.forEach((layer, index) => validateLayer(layer, ['layers', index], errors));
  return errors;
}
