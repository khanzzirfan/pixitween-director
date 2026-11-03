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

export const GEOMETRY_3D_TYPES = ['box', 'sphere', 'cylinder', 'torus', 'plane', 'gltf', 'text3d', 'extrude', 'lathe', 'liquid', 'mirror', 'smoke', 'caustics'] as const;

export type Geometry3DType = (typeof GEOMETRY_3D_TYPES)[number];

const PositiveVec3Schema = z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]);

export const BoxGeometrySchema = z
  .object({
    type: z.literal('box'),
    size: PositiveVec3Schema,
    /** Corner radius as a share of the shortest side, 0 (sharp, the default) to 0.5 (a ball). */
    round: z.number().min(0).max(0.5).optional(),
  })
  .strict();

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

// A flat contour pushed to a depth (a bean, a petal), centred on the origin. Contour, depth and bevel
// are in the contour's own units (image pixels, y down); `fit` on the object sizes it. Group 0 is the
// front and back caps, group 1 the sides.
export const ExtrudeGeometrySchema = z
  .object({
    type: z.literal('extrude'),
    contour: z.array(z.tuple([z.number(), z.number()])).min(3).max(2000),
    depth: z.number().min(0),
    bevel: z.number().min(0).optional(),
    /** Colour of the extruded sides; the front and back caps take the material (and its map). */
    sideColor: ColorSchema.optional(),
  })
  .strict();

export const LATHE_SHAPES = ['can', 'bottle', 'jar', 'tube', 'pouch'] as const;

// A turned packaging body (can, bottle, ...) from a fixed profile, centred on the origin. The UVs wrap a
// label once around the body (u = angle, v = height), with the label's centre on +z.
export const LatheGeometrySchema = z
  .object({
    type: z.literal('lathe'),
    shape: z.enum(LATHE_SHAPES),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();

export const LIQUID_GEOMETRY_FORMS = ['crown', 'pour', 'blobs', 'vortex'] as const;

// A moving liquid (metaballs that flow together and apart): a crown splash, a pouring stream or floating
// blobs, timed to `duration` seconds from the object's start. It changes shape every frame, so it is not
// fitted: `size` is the edge of the box it plays in, standing on the object's origin. Its look is the
// object's material (a glossy physical surface; transmission for a clear liquid).
export const LiquidGeometrySchema = z
  .object({
    type: z.literal('liquid'),
    form: z.enum(LIQUID_GEOMETRY_FORMS),
    size: z.number().positive(),
    duration: z.number().positive(),
    seed: z.number().int().optional(),
    resolution: z.number().int().min(24).max(64).optional(),
  })
  .strict();

// A glossy floor: the scene reflected in a plane, soft and fading away from the middle (where the product stands). Laid flat by the
// object's rotation like a plane ([-90, 0, 0]), a hair above the floor it shines on.
export const MirrorGeometrySchema = z
  .object({
    type: z.literal('mirror'),
    size: z.tuple([z.number().positive(), z.number().positive()]),
    strength: z.number().min(0).max(1),
    fade: z.number().positive().max(10),
    blur: z.number().min(0).max(1).optional(),
  })
  .strict();

// Caustics: the rippling net of light a glass of liquid throws on the floor, added over the floor, strongest round the middle and gone
// at `fade` metres, tinted by the material's colour. Laid flat by the object's rotation like a plane ([-90, 0, 0]).
export const CausticsGeometrySchema = z
  .object({
    type: z.literal('caustics'),
    size: z.tuple([z.number().positive(), z.number().positive()]),
    strength: z.number().min(0).max(1),
    fade: z.number().positive().max(10),
    scale: z.number().positive().max(200),
  })
  .strict();

export const SMOKE_GEOMETRY_FORMS = ['steam', 'cloud', 'powder'] as const;

// Soft vapour, timed to `duration` seconds from the object's start: steam rising, a cloud of smoke that wraps and clears, or a burst of fine
// powder. Puffs that face the camera, tinted by the material's colour; like a liquid it is never fitted: `size` is the edge of its box.
export const SmokeGeometrySchema = z
  .object({
    type: z.literal('smoke'),
    form: z.enum(SMOKE_GEOMETRY_FORMS),
    size: z.number().positive(),
    duration: z.number().positive(),
    seed: z.number().int().optional(),
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
  ExtrudeGeometrySchema,
  LatheGeometrySchema,
  LiquidGeometrySchema,
  MirrorGeometrySchema,
  SmokeGeometrySchema,
  CausticsGeometrySchema,
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
    /** Flat colours, no shading: the map (or colour) shows as authored. */
    unlit: z.boolean().optional(),
    /** The map has an alpha channel: transparent pixels are cut out. */
    transparent: z.boolean().optional(),
    // Physical material controls; any of them makes the material a MeshPhysicalMaterial.
    clearcoat: z.number().min(0).max(1).optional(),
    transmission: z.number().min(0).max(1).optional(),
    ior: z.number().min(1).max(2.333).optional(),
    thickness: z.number().min(0).optional(),
    /** Beads of water on the surface (a cold can), 0 dry to 1 soaked. Needs a lit material. */
    condensation: z.number().min(0).max(1).optional(),
  })
  .strict();

/** Seconds on the layer's clock the object exists for; outside it the object is hidden. */
export const LifeSchema = z.object({ start: z.number().min(0), end: z.number().min(0) }).strict();

/** Image frames shown in turn on the object's map (a card flipbook). */
export const FlipbookSchema = z
  .object({ frames: z.array(IdSchema).min(2).max(48), fps: z.number().positive().max(60).default(12), loop: z.boolean().default(false) })
  .strict();

/**
 * One object drawn as `count` instanced copies whose pose is a closed-form function of time and `seed`,
 * so a seek draws exactly the frame play would. Positions in world units, `spin` in degrees per second,
 * `stagger` in seconds, `growFrames` in frames at `fps`. Omitted fields take the motion's defaults.
 */
export const Swarm3DSchema = z
  .object({
    count: z.number().int().min(1).max(400),
    seed: z.number().int(),
    motion: z.enum(['fall', 'burst', 'orbit', 'drift', 'pour']),
    emitter: z
      .object({
        shape: z.enum(['point', 'box', 'sphere', 'ring']),
        center: Vec3Schema,
        size: Vec3Schema.optional(),
        radius: z.number().positive().optional(),
      })
      .strict(),
    direction: Vec3Schema.optional(),
    spread: z.number().min(0).max(180).optional(),
    speed: z.number().min(0).optional(),
    gravity: z.number().min(0).optional(),
    drag: z.number().min(0).optional(),
    spin: z.number().min(0).optional(),
    sizeJitter: z.number().min(0).max(0.9).optional(),
    stagger: z.number().min(0).optional(),
    growFrames: z.number().int().min(0).max(30).optional(),
    orbit: z
      .object({ radius: z.number().positive(), angularSpeed: z.number(), height: z.number().min(0).optional(), bob: z.number().min(0).optional() })
      .strict()
      .optional(),
    drift: z
      .object({ velocity: Vec3Schema.optional(), amplitude: Vec3Schema.optional(), frequency: z.number().positive().optional() })
      .strict()
      .optional(),
    bounce: z.boolean().optional(),
    /** Frame rate `growFrames` is counted at. */
    fps: z.number().positive().default(30),
    /** The object's life in seconds; `pour` spreads its copies over most of it by default. */
    duration: z.number().min(0).optional(),
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
    life: LifeSchema.optional(),
    /**
     * Scales the built object uniformly so its largest side is `fit` world units, then stands it on
     * y = 0 centred in x and z (the object's origin is its base).
     */
    fit: z.number().positive().optional(),
    /** Faces the camera every frame; rotation.z still rolls it. */
    billboard: z.boolean().optional(),
    flipbook: FlipbookSchema.optional(),
    swarm: Swarm3DSchema.optional(),
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
    // Overrides of the preset's key, fill and rim lights and ambient. Each is also a `lighting` tween target
    // (keyAzimuth, keyElevation, keyIntensity, fillIntensity, rimIntensity, ambient), applied to the rig every frame.
    keyAzimuth: z.number().optional(),
    keyElevation: z.number().optional(),
    keyIntensity: z.number().min(0).optional(),
    keyColor: ColorSchema.optional(),
    fillIntensity: z.number().min(0).optional(),
    rimIntensity: z.number().min(0).optional(),
    rimColor: ColorSchema.optional(),
    ambient: z.number().min(0).optional(),
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
    /** 0 (hard) to 1 (soft): the key light's shadow blur radius. */
    softness: z.number().min(0).max(1).optional(),
    /** Catcher size in world units [x, z]; omitted, it is fitted to the objects. */
    size: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  })
  .strict();

// A shader transition between the layer's own shots (an open gl-transitions shader by name). From `at` seconds on the
// layer's clock it plays for `duration` seconds: the old shot's last camera pose is mixed into the new shot.
export const Transition3DSchema = z
  .object({
    at: z.number().min(0),
    duration: z.number().min(0.05).max(2),
    name: z.string().min(1).max(40),
    params: z.record(z.string(), z.union([z.number(), z.boolean(), z.array(z.number()).min(2).max(4)])).optional(),
  })
  .strict();

// Motion blur: while a layer is exported frame by frame, each frame inside a span is drawn `samples` times across the shutter's open time and
// the pictures are averaged. `shutter` is the share of a frame's time the shutter stays open (0.5 is the film look). Spans are in the layer's seconds.
export const MotionBlur3DSchema = z
  .object({
    samples: z.number().int().min(2).max(16).default(6),
    spans: z.array(z.object({ from: z.number().min(0), to: z.number().positive(), shutter: z.number().min(0).max(1) }).strict()).max(16),
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
    /** Tone-mapping exposure (ACES input scale). */
    exposure: z.number().positive().max(4).default(1),
    /** Shader transitions at the cuts between the layer's shots (a camera path with cuts). */
    transitions: z.array(Transition3DSchema).max(8).optional(),
    /** Motion blur for frame-by-frame export. */
    motionBlur: MotionBlur3DSchema.optional(),
  })
  .strict();

export type Transition3D = z.output<typeof Transition3DSchema>;
export type Light3D = z.output<typeof Light3DSchema>;
export type Material = z.output<typeof MaterialSchema>;

export type Swarm3D = z.output<typeof Swarm3DSchema>;
export type Animation3D = z.output<typeof Animation3DSchema>;
export type Object3D = z.output<typeof Object3DSchema>;
export type Camera3D = z.output<typeof Camera3DSchema>;
export type Lighting3D = z.output<typeof Lighting3DSchema>;
export type Shadow3D = z.output<typeof Shadow3DSchema>;
export type ThreeLayer = z.output<typeof ThreeLayerSchema>;
