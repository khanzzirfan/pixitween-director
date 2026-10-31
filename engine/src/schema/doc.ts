import { z } from 'zod';
import { ColorSchema, IdSchema } from './scalars';
import { Filter2DSchema } from './parts';
import { LayerSchema } from './layer';
import type { Layer } from './layer';
import type { PresetName } from './enums';

const EPSILON = 1e-9;

export const ASSET_TYPES = ['image', 'gltf'] as const;

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
};

export const MotionDocBaseSchema = z
  .object({
    version: z.literal(1),
    width: z.number().int().min(16).max(4096),
    height: z.number().int().min(16).max(4096),
    fps: z.number().int().min(1).max(120).default(30),
    duration: z.number().finite().positive().max(600),
    background: z.union([ColorSchema, z.literal('transparent')]).default('#000000'),
    assets: z.record(IdSchema, AssetSchema).default({}),
    layers: z.array(LayerSchema).min(1),
    filters: z.array(Filter2DSchema).max(8).default([]),
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

    checkUniqueIds(layer.filters, 'filter', [...path, 'filters'], ctx);

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
      checkUniqueIds(layer.postFx, 'postFx', [...path, 'postFx'], ctx);
      layer.objects.forEach((object, index) => {
        if (object.geometry.type === 'gltf') {
          checkAsset(assets, object.geometry.asset, 'gltf', [...path, 'objects', index, 'geometry', 'asset'], ctx);
        }
        if (object.material.map !== undefined) {
          checkAsset(assets, object.material.map, 'image', [...path, 'objects', index, 'material', 'map'], ctx);
        }
      });
    }

    for (const key of ['enter', 'exit'] as const) {
      const ref = layer[key];
      if (ref?.target !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "target is only allowed on a three layer's loop",
          path: [...path, key, 'target'],
        });
      }
    }

    if (layer.loop?.target !== undefined) {
      if (layer.type !== 'three') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "target is only allowed on a three layer's loop",
          path: [...path, 'loop', 'target'],
        });
      } else {
        const target = layer.loop.target;
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
  checkUniqueIds(doc.filters, 'filter', ['filters'], ctx);
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
