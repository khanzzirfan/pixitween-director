import { z } from 'zod';
import { ColorSchema, IdSchema, SecondsSchema, Vec3Schema } from './scalars';
import { LayerBaseShape } from './layers2d';
import { ShotSpecSchema } from './shot';

// The shot vocabulary lives in its own leaf module (it is what an author writes); it is re-exported
// here so the camera module and the schema never drift apart.
export { SHOT_ANGLES, SHOT_SIDES, SHOT_SIZES, ShotSpecSchema } from './shot';
export type { ShotSpec } from './shot';

export const LIGHT_3D_TYPES = ['ambient', 'directional', 'point', 'spot'] as const;

export type Light3DType = (typeof LIGHT_3D_TYPES)[number];

export const Light3DTypeSchema = z.enum(LIGHT_3D_TYPES);

export const PRESET_LIGHT_IDS = ['key', 'fill', 'rim', 'ambient'] as const;

export type PresetLightId = (typeof PRESET_LIGHT_IDS)[number];

const isPresetLightId = (id: string): boolean => (PRESET_LIGHT_IDS as readonly string[]).includes(id);

export const LIGHTING_PRESETS = ['studio', 'window', 'golden', 'night', 'disco', 'none'] as const;

export type LightingPreset = (typeof LIGHTING_PRESETS)[number];

export const LightingPresetSchema = z.enum(LIGHTING_PRESETS);

export const LIGHTING_ENVIRONMENTS = ['room', 'none'] as const;

export type LightingEnvironment = (typeof LIGHTING_ENVIRONMENTS)[number];

export const LightingEnvironmentSchema = z.enum(LIGHTING_ENVIRONMENTS);

export const GEOMETRY_3D_TYPES = ['box', 'sphere', 'cylinder', 'torus', 'plane', 'gltf', 'text3d'] as const;

export type Geometry3DType = (typeof GEOMETRY_3D_TYPES)[number];

const PositiveVec3Schema = z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]);

export const BoxGeometrySchema = z.object({ type: z.literal('box'), size: PositiveVec3Schema }).strict();

export const SphereGeometrySchema = z.object({ type: z.literal('sphere'), radius: z.number().positive() }).strict();

export const CylinderGeometrySchema = z
  .object({
    type: z.literal('cylinder'),
    radiusTop: z.number().positive(),
    radiusBottom: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();

export const TorusGeometrySchema = z.object({ type: z.literal('torus'), radius: z.number().positive(), tube: z.number().positive() }).strict();

export const PlaneGeometrySchema = z.object({ type: z.literal('plane'), size: z.tuple([z.number().positive(), z.number().positive()]) }).strict();

export const GltfGeometrySchema = z.object({ type: z.literal('gltf'), asset: IdSchema, height: z.number().positive().optional() }).strict();

export const Bevel3DSchema = z
  .object({
    thickness: z.number().min(0).default(0.01),
    size: z.number().min(0).default(0.01),
    segments: z.number().int().min(1).max(8).default(2),
  })
  .strict();

export const Text3DGeometrySchema = z
  .object({
    type: z.literal('text3d'),
    font: IdSchema,
    text: z.string().min(1).max(200),
    size: z.number().positive().default(0.5),
    depth: z.number().min(0).default(0.1),
    curveSegments: z.number().int().min(2).max(24).default(8),
    bevel: Bevel3DSchema.optional(),
    align: z.enum(['left', 'center', 'right']).default('center'),
    lineHeight: z.number().positive().default(1.2),
    letterSpacing: z.number().default(0),
  })
  .strict();

export const Geometry3DSchema = z.discriminatedUnion('type', [
  BoxGeometrySchema,
  SphereGeometrySchema,
  CylinderGeometrySchema,
  TorusGeometrySchema,
  PlaneGeometrySchema,
  GltfGeometrySchema,
  Text3DGeometrySchema,
]);

export type Geometry3D = z.output<typeof Geometry3DSchema>;

export const MaterialSchema = z
  .object({
    color: ColorSchema.default('#cccccc'),
    roughness: z.number().min(0).max(1).default(0.4),
    metalness: z.number().min(0).max(1).default(0),
    emissive: ColorSchema.default('#000000'),
    emissiveIntensity: z.number().min(0).default(0),
    opacity: z.number().min(0).max(1).default(1),
    map: IdSchema.optional(),
  })
  .strict();

export const Animation3DSchema = z
  .object({
    clip: z.string().min(1).optional(),
    speed: z.number().min(0).max(10).default(1),
    loop: z.boolean().default(true),
    offset: SecondsSchema.default(0),
  })
  .strict();

export const Object3DSchema = z
  .object({
    id: IdSchema,
    geometry: Geometry3DSchema,
    position: Vec3Schema.default([0, 0, 0]),
    rotation: Vec3Schema.default([0, 0, 0]),
    scale: z.union([z.number(), Vec3Schema]).default(1),
    material: MaterialSchema.default({}),
    castShadow: z.boolean().default(true),
    animation: Animation3DSchema.optional(),
  })
  .strict()
  .superRefine((object, ctx) => {
    if (object.animation && object.geometry.type !== 'gltf') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `animation is only allowed on a gltf geometry, not ${object.geometry.type}`,
        path: ['animation'],
      });
    }
  });

export const Light3DSchema = z
  .object({
    id: IdSchema,
    type: Light3DTypeSchema,
    color: ColorSchema.default('#ffffff'),
    intensity: z.number().min(0).default(1),
    position: Vec3Schema.default([3, 5, 4]),
    target: Vec3Schema.default([0, 0, 0]),
    castShadow: z.boolean().default(false),
  })
  .strict()
  .refine((light) => !isPresetLightId(light.id), {
    message: `light ids ${PRESET_LIGHT_IDS.join(', ')} are reserved for the lighting preset rig`,
    path: ['id'],
  });

export const CameraPathKeySchema = z
  .object({
    /** Layer-local seconds. */
    t: SecondsSchema,
    position: Vec3Schema,
    lookAt: Vec3Schema,
    /** Optional: the lens holds its value until the next key that sets it. */
    fov: z.number().min(10).max(120).optional(),
  })
  .strict();

export type CameraPathKey = z.output<typeof CameraPathKeySchema>;

export const CameraPathSchema = z
  .object({
    keys: z.array(CameraPathKeySchema).min(2),
    curve: z.enum(['linear', 'smooth']).default('smooth'),
  })
  .strict()
  .superRefine((path, ctx) => {
    path.keys.forEach((key, index) => {
      const previous = path.keys[index - 1];
      if (!previous) return;
      if (key.t <= previous.t) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `path keys must be sorted by increasing t (the key at ${key.t}s follows the one at ${previous.t}s)`,
          path: ['keys', index, 't'],
        });
      }
    });
  });

export type CameraPath = z.output<typeof CameraPathSchema>;

export const Camera3DSchema = z
  .object({
    position: Vec3Schema.default([0, 1.2, 6]),
    lookAt: Vec3Schema.default([0, 0.6, 0]),
    fov: z.number().min(10).max(120).default(35),
    near: z.number().positive().default(0.1),
    far: z.number().positive().default(200),
    /** Frames a subject by film vocabulary; replaces position/lookAt/fov when the rig is built. */
    shot: ShotSpecSchema.optional(),
    /** A camera move declared as keys; sampled statelessly on every update. */
    path: CameraPathSchema.optional(),
  })
  .strict();

export const Lighting3DSchema = z
  .object({
    preset: LightingPresetSchema.default('studio'),
    environment: LightingEnvironmentSchema.optional(),
  })
  .strict()
  .transform((lighting) => ({
    ...lighting,
    environment:
      lighting.environment ??
      (lighting.preset === 'studio' || lighting.preset === 'window' || lighting.preset === 'golden' ? 'room' : 'none'),
  }));

export const Shadow3DSchema = z
  .object({
    enabled: z.boolean().default(true),
    opacity: z.number().min(0).max(1).default(0.35),
    y: z.number().default(0),
  })
  .strict();

export const ThreeLayerSchema = z
  .object({
    ...LayerBaseShape,
    type: z.literal('three'),
    width: z.number().int().min(16).max(2048),
    height: z.number().int().min(16).max(2048),
    background: z.union([ColorSchema, z.literal('transparent')]).default('transparent'),
    camera: Camera3DSchema.default({}),
    lighting: Lighting3DSchema.default({}),
    lights: z.array(Light3DSchema).max(6).default([]),
    shadow: Shadow3DSchema.default({}),
    objects: z.array(Object3DSchema).min(1).max(50),
  })
  .strict();

export type Light3D = z.output<typeof Light3DSchema>;
export type Material = z.output<typeof MaterialSchema>;
export type Animation3D = z.output<typeof Animation3DSchema>;
export type Object3D = z.output<typeof Object3DSchema>;
export type Camera3D = z.output<typeof Camera3DSchema>;
export type Lighting3D = z.output<typeof Lighting3DSchema>;
export type Shadow3D = z.output<typeof Shadow3DSchema>;
export type ThreeLayer = z.output<typeof ThreeLayerSchema>;
