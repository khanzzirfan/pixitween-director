import { formatErrorPath } from '../schema/doc';
import type { MotionDoc } from '../schema/doc';
import type { Layer } from '../schema/layer';
import { PRESET_LIGHT_IDS } from '../schema/layer3d';
import { parseUnitTarget, type UnitTargetKind } from '../schema/scalars';
import { countUnits } from '../three/text/layout';
import { staggerSpan } from './compile';

export interface TargetError {
  path: string;
  message: string;
  /** Absent means an error; `warning` is advisory (a stagger running past the layer's end). */
  severity?: 'warning';
}

type PathSegment = string | number;

const BASE_LAYER_PROPS = ['x', 'y', 'alpha', 'rotation', 'scale', 'scaleX', 'scaleY'] as const;

/** The tweenable properties per layer type (engine/docs/02-timeline.md, "Target paths"). */
export const LAYER_PROPS: Record<Layer['type'], readonly string[]> = {
  image: [...BASE_LAYER_PROPS, 'tint'],
  text: [...BASE_LAYER_PROPS, 'fill'],
  shape: [...BASE_LAYER_PROPS, 'fill'],
  group: [...BASE_LAYER_PROPS],
  three: [...BASE_LAYER_PROPS],
};

export const CAMERA_PROPS: readonly string[] = [
  'position.x',
  'position.y',
  'position.z',
  'lookAt.x',
  'lookAt.y',
  'lookAt.z',
  'fov',
  // The rig moves (engine/docs/09-camera.md, "Rig targets"): degrees for the turns, metres for
  // the travels, all relative to the camera's rest pose.
  'rig.pan',
  'rig.tilt',
  'rig.roll',
  'rig.dolly',
  'rig.truck',
  'rig.pedestal',
];

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
  | { kind: 'object' | 'light' | 'effect'; id: string }
  | { kind: 'unknown'; raw: string };

const ID_TARGETS = ['object', 'light', 'effect'] as const;

/** `undefined` -> the layer itself; `camera`; `<prefix>:<id>` (object, light, effect). */
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

function idExists(layer: Layer, kind: 'object' | 'light' | 'effect', id: string): boolean {
  switch (kind) {
    case 'object':
      return layer.type === 'three' && layer.objects.some((object) => object.id === id);
    case 'light':
      return layer.type === 'three' && (layer.lights.some((light) => light.id === id) || (PRESET_LIGHT_IDS as readonly string[]).includes(id));
    case 'effect':
      return layer.effects.some((effect) => effect.id === id);
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
    case 'effect':
      // Effect param names are the effect table's job, so only the target itself is checked here.
      return { props: [], checkProps: false };
    case 'unknown':
      return null;
  }
}

const UNIT_PROPS: readonly string[] = ['offset.x', 'offset.y', 'offset.z', 'rotation.x', 'rotation.y', 'rotation.z', 'scale', 'scale.x', 'scale.y', 'scale.z'];

function unitPropsFor(kind: UnitTargetKind): readonly string[] {
  return kind === 'glyphs' ? [...UNIT_PROPS, 'alpha'] : UNIT_PROPS;
}

function validateUnitTween(
  doc: MotionDoc,
  layer: Layer,
  tween: Layer['tweens'][number],
  unit: { kind: UnitTargetKind; id: string },
  tweenPath: PathSegment[],
  errors: TargetError[],
): void {
  const targetPath = formatErrorPath([...tweenPath, 'target']);
  if (layer.type !== 'three') {
    errors.push({ path: targetPath, message: `target "${tween.target}" is only allowed on a three layer with a text3d object` });
    return;
  }
  const object = layer.objects.find((o) => o.id === unit.id);
  if (object === undefined) {
    errors.push({ path: targetPath, message: `target "${tween.target}" names an object this layer does not have` });
    return;
  }
  if (object.geometry.type !== 'text3d') {
    errors.push({ path: targetPath, message: `target "${tween.target}" needs a text3d object, "${unit.id}" is a ${object.geometry.type}` });
    return;
  }

  const allowed = new Set(unitPropsFor(unit.kind));
  for (const map of ['to', 'from'] as const) {
    const values = tween[map];
    if (values === undefined) continue;
    for (const key of Object.keys(values)) {
      if (!allowed.has(key)) {
        errors.push({
          path: formatErrorPath([...tweenPath, map, key]),
          message: `unknown property "${key}" on ${tween.target}`,
        });
      }
    }
  }

  if (tween.stagger) {
    const units = countUnits(object.geometry.text)[unit.kind];
    const span = staggerSpan(units, tween.stagger.each, tween.stagger.from, tween.duration, tween.repeat);
    const length = (layer.end ?? doc.duration) - layer.start;
    const total = tween.at + span;
    if (total > length + 1e-9) {
      errors.push({
        path: formatErrorPath([...tweenPath, 'stagger']),
        message: `stagger of ${units} ${unit.kind} ends at ${Number(total.toFixed(4))}s, past the layer's length ${Number(length.toFixed(4))}s`,
        severity: 'warning',
      });
    }
  }
}

function validateTween(doc: MotionDoc, layer: Layer, tween: Layer['tweens'][number], tweenPath: PathSegment[], errors: TargetError[]): void {
  const targetPath = [...tweenPath, 'target'];
  const unit = tween.target === undefined ? null : parseUnitTarget(tween.target);
  if (unit !== null) {
    validateUnitTween(doc, layer, tween, unit, tweenPath, errors);
    return;
  }
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
  if (form.kind === 'effect' && !idExists(layer, 'effect', form.id)) {
    errors.push({ path: formatErrorPath(targetPath), message: targetOf('effect') });
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

function validateLayer(doc: MotionDoc, layer: Layer, path: PathSegment[], errors: TargetError[]): void {
  layer.tweens.forEach((tween, index) => validateTween(doc, layer, tween, [...path, 'tweens', index], errors));
  if (layer.type === 'group') {
    layer.children.forEach((child, index) => validateLayer(doc, child, [...path, 'children', index], errors));
  }
}

/**
 * Static check of every tween target and property against the allowlist, so a typo is reported at
 * load time with a path (engine/docs/02-timeline.md, "Target paths"). Returns one error per bad
 * target or property; a bad target short-circuits that tween's property checks.
 */
export function validateTargets(doc: MotionDoc): TargetError[] {
  const errors: TargetError[] = [];
  doc.layers.forEach((layer, index) => validateLayer(doc, layer, ['layers', index], errors));
  return errors;
}
