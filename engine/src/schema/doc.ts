import { z } from 'zod';
import { ColorSchema, IdSchema, parseUnitTarget } from './scalars';
import { EffectSchema } from './parts';
import { EFFECT_SCOPES, CAMERA_PRESET_SET } from './enums';
import { LayerSchema } from './layer';
import type { Layer } from './layer';
import type { PresetName } from './enums';

const EPSILON = 1e-9;

export const ASSET_TYPES = ['image', 'gltf', 'font'] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

export const AssetSchema = z
  .object({
    type: z.enum(ASSET_TYPES),
    url: z.string().regex(/^(?:https?:\/\/|data:|\/)/, 'expected an http(s), data: or root-relative url'),
  })
  .strict();

export type Asset = z.output<typeof AssetSchema>;

type PathSegment = string | number;

// Default durations from engine/docs/02-timeline.md; rule 6 only needs the enter/exit presets.
const PRESET_DEFAULT_DURATIONS: Record<PresetName, number> = {
  fadeIn: 0.6,
  fadeInUp: 0.7,
  fadeInDown: 0.7,
  fadeInLeft: 0.7,
  fadeInRight: 0.7,
  slideInUp: 0.6,
  slideInDown: 0.6,
  slideInLeft: 0.6,
  slideInRight: 0.6,
  zoomIn: 0.6,
  popIn: 0.5,
  rotateIn: 0.7,
  dropIn: 0.9,
  fadeOut: 0.5,
  fadeOutUp: 0.6,
  fadeOutDown: 0.6,
  slideOutLeft: 0.6,
  slideOutRight: 0.6,
  zoomOut: 0.5,
  spin: 4,
  float: 3,
  pulse: 1.2,
  sway: 2.4,
  cameraTo: 1.5,
  crane: 2,
  dollyZoom: 1.5,
  orbit: 6,
  handheld: 2,
  glyphRise: 0.5,
  glyphPop: 0.45,
  glyphFlip: 0.6,
  glyphFadeOut: 0.4,
  glyphWave: 1.2,
};

export const MotionDocBaseSchema = z
  .object({
    version: z.literal(1),
    /** Edit counter for applyEdit / undoEdit (agent/edit.ts); absent means 0. */
    revision: z.number().int().min(0).optional(),
    width: z.number().int().min(16).max(4096),
    height: z.number().int().min(16).max(4096),
    fps: z.number().int().min(1).max(120).default(30),
    duration: z.number().finite().positive().max(600),
    background: z.union([ColorSchema, z.literal('transparent')]).default('#000000'),
    assets: z.record(IdSchema, AssetSchema).default({}),
    layers: z.array(LayerSchema).min(1),
    effects: z.array(EffectSchema).max(8).default([]),
  })
  .strict();

type ParsedDoc = z.output<typeof MotionDocBaseSchema>;

function fillLayerEnds(layer: Layer, inheritedEnd: number): Layer {
  const end = layer.end ?? inheritedEnd;
  if (layer.type === 'group') {
    return { ...layer, end, children: layer.children.map((child) => fillLayerEnds(child, end - layer.start)) };
  }
  return { ...layer, end };
}

function fillDocEnds(doc: ParsedDoc): ParsedDoc {
  return { ...doc, layers: doc.layers.map((layer) => fillLayerEnds(layer, doc.duration)) };
}

interface LayerVisit {
  layer: Layer;
  path: PathSegment[];
  depth: number;
}

function* visitLayers(layers: Layer[], base: PathSegment[], depth: number): Generator<LayerVisit> {
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    const path = [...base, index];
    yield { layer, path, depth };
    if (layer.type === 'group') {
      yield* visitLayers(layer.children, [...path, 'children'], depth + 1);
    }
  }
}

function checkAsset(assets: Record<string, Asset>, id: string, expected: AssetType, path: PathSegment[], ctx: z.RefinementCtx): void {
  const asset = assets[id];
  if (!asset) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown asset "${id}"`, path });
  } else if (asset.type !== expected) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `asset "${id}" is a ${asset.type} asset, expected ${expected}`, path });
  }
}

function checkUniqueIds(items: { id: string }[], label: string, base: PathSegment[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate ${label} id "${item.id}"`, path: [...base, index, 'id'] });
    } else {
      seen.add(item.id);
    }
  });
}

function checkChildBounds(layers: Layer[], base: PathSegment[], parentLength: number | undefined, ctx: z.RefinementCtx): void {
  layers.forEach((layer, index) => {
    const path = [...base, index];
    const end = layer.end;
    if (parentLength !== undefined && end !== undefined && end > parentLength + EPSILON) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `end ${end} is after the group's length ${parentLength}`,
        path: [...path, 'end'],
      });
    }
    if (layer.type === 'group') {
      checkChildBounds(layer.children, [...path, 'children'], end !== undefined ? end - layer.start : undefined, ctx);
    }
  });
}

function presetDuration(ref: { name: PresetName; duration?: number }): number {
  return ref.duration ?? PRESET_DEFAULT_DURATIONS[ref.name];
}

/** The camera properties a path declares, so they cannot also be tweened (engine/docs/09-camera.md). */
const CAMERA_MOVE_PROPS = ['position.x', 'position.y', 'position.z', 'lookAt.x', 'lookAt.y', 'lookAt.z'];

/** True when a tween moves the camera's position or its lookAt. */
function movesCamera(tween: Layer['tweens'][number]): boolean {
  if (tween.target !== 'camera') return false;
  return [tween.to, tween.from].some((map) => {
    if (!map) return false;
    return Object.keys(map).some((key) => CAMERA_MOVE_PROPS.includes(key));
  });
}

/** The object ids a shot's subject names, or null when the subject is not a subject at all. */
function shotSubjectIds(subject: string): string[] | null {
  const separator = subject.indexOf(':');
  if (separator < 0) return null;
  const kind = subject.slice(0, separator);
  if (kind !== 'object' && kind !== 'objects') return null;
  const ids = subject
    .slice(separator + 1)
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  return ids.length > 0 ? ids : null;
}

function applyCrossFieldRules(doc: ParsedDoc, ctx: z.RefinementCtx): void {
  const { assets, duration } = doc;
  const seenLayerIds = new Set<string>();
  let total = 0;

  for (const { layer, path, depth } of visitLayers(doc.layers, ['layers'], 1)) {
    total += 1;

    if (depth > 4) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'group nesting depth must not exceed 4', path });
    }

    if (seenLayerIds.has(layer.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate layer id "${layer.id}"`, path: [...path, 'id'] });
    } else {
      seenLayerIds.add(layer.id);
    }

    checkUniqueIds(layer.effects, 'effect', [...path, 'effects'], ctx);
    layer.effects.forEach((effect, index) => {
      const scope = EFFECT_SCOPES[effect.type];
      const is3D = layer.type === 'three';
      if ((scope === 'three' && !is3D) || (scope === '2d' && is3D)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `effect type "${effect.type}" is only allowed on ${scope === 'three' ? 'three' : '2D'} layers`,
          path: [...path, 'effects', index, 'type'],
        });
      }
    });

    const end = layer.end;
    if (end !== undefined && end <= layer.start) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `end ${end} must be greater than start ${layer.start}`, path: [...path, 'end'] });
    }

    if (end !== undefined) {
      const length = end - layer.start;

      layer.tweens.forEach((tween, index) => {
        const tweenEnd = tween.at + tween.duration * (tween.repeat + 1);
        if (tweenEnd > length + EPSILON) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `tween ends at ${tweenEnd}s but the layer is ${length}s long`,
            path: [...path, 'tweens', index],
          });
        }
      });

      const enter = layer.enter ? presetDuration(layer.enter) : 0;
      const exit = layer.exit ? presetDuration(layer.exit) : 0;
      if (enter + exit > length + EPSILON) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `enter (${enter}s) + exit (${exit}s) exceed the ${length}s layer`,
          path: [...path, 'enter'],
        });
      }
    }

    if (layer.type === 'image') {
      checkAsset(assets, layer.asset, 'image', [...path, 'asset'], ctx);
    }

    if (layer.type === 'three') {
      checkUniqueIds(layer.objects, 'object', [...path, 'objects'], ctx);
      checkUniqueIds(layer.lights, 'light', [...path, 'lights'], ctx);
      layer.objects.forEach((object, index) => {
        if (object.geometry.type === 'gltf') {
          checkAsset(assets, object.geometry.asset, 'gltf', [...path, 'objects', index, 'geometry', 'asset'], ctx);
        }
        if (object.geometry.type === 'text3d') {
          checkAsset(assets, object.geometry.font, 'font', [...path, 'objects', index, 'geometry', 'font'], ctx);
        }
        object.flipbook?.frames.forEach((frame, f) => {
          checkAsset(assets, frame, 'image', [...path, 'objects', index, 'flipbook', 'frames', f], ctx);
        });
        if (object.material.map !== undefined) {
          checkAsset(assets, object.material.map, 'image', [...path, 'objects', index, 'material', 'map'], ctx);
        }
      });

      // A shot frames objects of this layer, so the subject must name one (engine/docs/09-camera.md).
      if (layer.camera.shot) {
        const subject = layer.camera.shot.subject;
        const ids = shotSubjectIds(subject);
        const known = ids !== null && ids.every((id) => layer.objects.some((object) => object.id === id));
        if (!known) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `camera.shot subject "${subject}" must name objects of this layer (object:<id> or objects:<id>,<id>)`,
            path: [...path, 'camera', 'shot', 'subject'],
          });
        }
      }

      // A path declares the camera, so it cannot also be tweened, and its keys stay inside the layer.
      if (layer.camera.path) {
        if (layer.tweens.some(movesCamera)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'camera.path declares the camera, so it cannot be combined with camera position or lookAt tweens',
            path: [...path, 'camera', 'path'],
          });
        }
        const length = (layer.end ?? layer.start) - layer.start;
        layer.camera.path.keys.forEach((key, index) => {
          if (key.t > length + EPSILON) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `path key at ${key.t}s is after the layer's ${length}s`,
              path: [...path, 'camera', 'path', 'keys', index, 't'],
            });
          }
        });
      }
    }

    for (const key of ['enter', 'exit', 'loop'] as const) {
      const ref = layer[key];
      if (ref?.target === undefined) continue;
      const unit = parseUnitTarget(ref.target);
      if (unit) {
        const isText = layer.type === 'three' && layer.objects.some((object) => object.id === unit.id && object.geometry.type === 'text3d');
        if (!isText) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${key} target "${ref.target}" must name a text3d object of a three layer (${unit.kind}:<id>)`,
            path: [...path, key, 'target'],
          });
        }
      } else if (key !== 'loop' || layer.type !== 'three') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "target is only allowed on a three layer's loop (or glyphs:/words:/lines: of a text3d object)",
          path: [...path, key, 'target'],
        });
      } else {
        const target = ref.target;
        const match = /^object:(.+)$/.exec(target);
        const exists = match ? layer.objects.some((object) => object.id === match[1]) : false;
        if (!exists) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `loop target "${target}" must name an object of this layer (object:<id>)`,
            path: [...path, 'loop', 'target'],
          });
        }
      }
    }

    // The camera presets move a three layer's camera, and `cameraTo` frames a shot (engine/docs/09-camera.md).
    for (const key of ['enter', 'exit', 'loop'] as const) {
      const ref = layer[key];
      if (!ref || !CAMERA_PRESET_SET.has(ref.name)) continue;
      if (layer.type !== 'three') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `preset "${ref.name}" moves the camera, so it is only allowed on a three layer`,
          path: [...path, key, 'name'],
        });
      }
      if (ref.name === 'cameraTo' && ref.params?.shot === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'preset "cameraTo" needs a shot to frame (params.shot)',
          path: [...path, key, 'params', 'shot'],
        });
      }
    }
  }

  if (total > 200) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `a doc may have at most 200 layers (found ${total})`, path: ['layers'] });
  }

  doc.layers.forEach((layer, index) => {
    if (layer.end !== undefined && layer.end > duration + EPSILON) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `end ${layer.end} is after the ${duration}s doc duration`,
        path: ['layers', index, 'end'],
      });
    }
  });

  checkChildBounds(doc.layers, ['layers'], undefined, ctx);
  checkUniqueIds(doc.effects, 'effect', ['effects'], ctx);
  doc.effects.forEach((effect, index) => {
    if (EFFECT_SCOPES[effect.type] !== 'any') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `effect type "${effect.type}" is not allowed on the whole stage`,
        path: ['effects', index, 'type'],
      });
    }
  });
}

export const MotionDocSchema = MotionDocBaseSchema.transform(fillDocEnds).superRefine(applyCrossFieldRules);

export type MotionDoc = z.output<typeof MotionDocSchema>;
export type MotionDocInput = z.input<typeof MotionDocSchema>;

export interface MotionDocError {
  path: string;
  message: string;
}

export type ParseMotionDocResult = { ok: true; doc: MotionDoc } | { ok: false; errors: MotionDocError[] };

export function formatErrorPath(path: PathSegment[]): string {
  return path.reduce<string>((out, segment) => {
    if (typeof segment === 'number') return `${out}[${segment}]`;
    return out === '' ? segment : `${out}.${segment}`;
  }, '');
}

export function parseMotionDoc(input: unknown): ParseMotionDocResult {
  const result = MotionDocSchema.safeParse(input);
  if (result.success) {
    return { ok: true, doc: result.data };
  }
  return { ok: false, errors: result.error.issues.map((issue) => ({ path: formatErrorPath(issue.path), message: issue.message })) };
}
