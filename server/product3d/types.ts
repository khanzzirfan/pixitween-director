// Owned by S13a. A local zod mirror of the engine's `model3d` layer subset we write, so this repo validates what it writes before the engine is loaded.
// Mirrors reacthub-pixitweenjs schema 1.9.0 (src/types/aep/layer.ts); the engine stays the authority and rejects anything this lets through.
import { z } from 'zod';

const kf = <V extends z.ZodTypeAny>(value: V) =>
  z
    .object({
      t: z.number().finite(),
      v: value,
      easeIn: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
      easeOut: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
      hold: z.boolean().optional(),
    })
    .strict();
const animatable = <V extends z.ZodTypeAny>(value: V) => z.union([value, z.array(kf(value)).min(1)]);

const colour = z.string().regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'expected #RRGGBB or #RRGGBBAA');
const vec2 = z.tuple([z.number(), z.number()]);
const vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const SHAPES = ['can', 'bottle', 'box', 'jar', 'tube', 'pouch'] as const;
export type PrimitiveShape = (typeof SHAPES)[number];
export const PRESETS = ['studio', 'window', 'golden', 'night'] as const;
export type LightPreset = (typeof PRESETS)[number];

const primitive = z
  .object({
    type: z.literal('primitive'),
    shape: z.enum(SHAPES),
    proportions: z.object({ width: z.number().positive(), height: z.number().positive(), depth: z.number().positive().optional() }).strict().optional(),
  })
  .strict();
const extrude = z
  .object({
    type: z.literal('extrude'),
    contour: z.array(vec2).min(3).max(2000),
    depth: animatable(z.number().min(0)),
    bevel: z.number().min(0).optional(),
  })
  .strict();
const gltf = z.object({ type: z.literal('gltf'), assetId: z.string().min(1) }).strict();

export const model3dLayerSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    kind: z.literal('model3d'),
    inPoint: z.number().finite(),
    outPoint: z.number().finite(),
    parent: z.string().optional(),
    hidden: z.boolean().optional(),
    transform: z
      .object({
        position: animatable(vec2),
        anchor: animatable(vec2),
        scale: animatable(vec2),
        rotation: animatable(z.number()),
        opacity: animatable(z.number().min(0).max(1)),
      })
      .strict(),
    viewport: z.object({ width: z.number().int().min(16).max(4096), height: z.number().int().min(16).max(4096) }).strict(),
    source: z.discriminatedUnion('type', [primitive, extrude, gltf]),
    textures: z.object({ label: z.string().min(1).optional(), front: z.string().min(1).optional(), side: colour.optional() }).strict().optional(),
    material: z
      .object({
        roughness: animatable(z.number().min(0).max(1)).optional(),
        metalness: animatable(z.number().min(0).max(1)).optional(),
        clearcoat: z.number().min(0).max(1).optional(),
      })
      .strict()
      .optional(),
    view: z.object({ rotation: animatable(vec3).optional(), position: animatable(vec3).optional(), scale: animatable(z.number().positive()).optional() }).strict().optional(),
    lighting: z
      .object({
        preset: z.enum(PRESETS).optional(),
        key: z.object({ azimuth: animatable(z.number()).optional(), elevation: animatable(z.number()).optional(), intensity: animatable(z.number().min(0)).optional(), color: colour.optional() }).strict().optional(),
        fill: z.object({ intensity: animatable(z.number().min(0)).optional() }).strict().optional(),
        rim: z.object({ intensity: animatable(z.number().min(0)).optional() }).strict().optional(),
        environment: z.enum(['room', 'none']).optional(),
      })
      .strict()
      .optional(),
    shadow: z.object({ opacity: animatable(z.number().min(0).max(1)), softness: z.number().min(0).max(1).optional(), offsetY: z.number().optional() }).strict().optional(),
    bounds: z.object({ center: vec3.optional(), size: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]) }).strict().optional(),
    camera: z.object({ fov: z.number().min(10).max(90).optional(), fit: z.number().min(0.5).max(3).optional() }).strict().optional(),
  })
  .strict();

export type Model3DLayer = z.infer<typeof model3dLayerSchema>;
export type Model3DSource = Model3DLayer['source'];

export interface Model3DIssue {
  path: string;
  message: string;
}

/** Parses one layer; each issue names the field (for example `source.contour`) so a model can repair it in one turn. */
export function parseModel3D(layer: unknown): { ok: true; layer: Model3DLayer } | { ok: false; issues: Model3DIssue[] } {
  const r = model3dLayerSchema.safeParse(layer);
  if (r.success) return { ok: true, layer: r.data };
  return { ok: false, issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
}
