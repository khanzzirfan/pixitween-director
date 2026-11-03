// Ported from the upstream AEP schema (types/aep/layer.ts, MIT).
import { z } from "zod";
import { aepAnimatableOf, aepTransformSchema } from "./transform";
import { aepTransform3DSchema } from "./transform3D";
import { aepMaskSchema, aepBezierPathSchema } from "./mask";
import { aepEffectSchema } from "./effect";
import { aepTextAnimatorSchema } from "./text-animator";
import {
  aepTextAlignSchema,
  aepTextStyleRunSchema,
  type AepTextStyleRun,
} from "./text-runs";
import { aepCameraLayerSchema } from "./camera";
import { aepLightLayerSchema } from "./light";
import { aepThemableColorSchema } from "./theme";
import {
  STAGE3D_LIMITS,
  refineActor3DLayer,
  refineProp3DLayer,
  refineStage3DLayer,
} from "./stage3d";

// `#RRGGBB` or `#RRGGBBAA`. Numeric Pixi conversion happens at render time.
export const aepColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "expected #RRGGBB or #RRGGBBAA");

const aepBlendModeSchema = z.enum([
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
  "add",
]);

// ---------- shape paths ----------------------------------------------------
const aepShapeRectSchema = z
  .object({
    kind: z.literal("rect"),
    size: aepAnimatableOf(z.tuple([z.number(), z.number()])),
    position: aepAnimatableOf(z.tuple([z.number(), z.number()])).optional(),
    roundness: aepAnimatableOf(z.number()).optional(),
  })
  .strict();

const aepShapeEllipseSchema = z
  .object({
    kind: z.literal("ellipse"),
    size: aepAnimatableOf(z.tuple([z.number(), z.number()])),
    position: aepAnimatableOf(z.tuple([z.number(), z.number()])).optional(),
  })
  .strict();

const aepShapePolystarSchema = z
  .object({
    kind: z.literal("polystar"),
    starType: z.enum(["star", "polygon"]),
    points: aepAnimatableOf(z.number()),
    innerRadius: aepAnimatableOf(z.number()).optional(),
    outerRadius: aepAnimatableOf(z.number()),
    innerRoundness: aepAnimatableOf(z.number()).optional(),
    outerRoundness: aepAnimatableOf(z.number()).optional(),
    rotation: aepAnimatableOf(z.number()).optional(),
    position: aepAnimatableOf(z.tuple([z.number(), z.number()])).optional(),
  })
  .strict();

const aepShapeBezierSchema = z
  .object({
    kind: z.literal("bezier"),
    path: z.union([
      aepBezierPathSchema,
      z
        .array(
          z
            .object({
              t: z.number(),
              v: aepBezierPathSchema,
              easeIn: z
                .tuple([z.number(), z.number(), z.number(), z.number()])
                .optional(),
              easeOut: z
                .tuple([z.number(), z.number(), z.number(), z.number()])
                .optional(),
              hold: z.boolean().optional(),
            })
            .strict(),
        )
        .min(1),
    ]),
  })
  .strict();

export const aepShapePathSchema = z.discriminatedUnion("kind", [
  aepShapeRectSchema,
  aepShapeEllipseSchema,
  aepShapePolystarSchema,
  aepShapeBezierSchema,
]);
export type AepShapePath = z.infer<typeof aepShapePathSchema>;

const aepStrokeSchema = z
  .object({
    color: aepAnimatableOf(aepColorSchema),
    width: aepAnimatableOf(z.number().min(0)),
    dashes: z.array(z.number()).optional(),
    lineCap: z.enum(["butt", "round", "square"]).optional(),
    lineJoin: z.enum(["miter", "round", "bevel"]).optional(),
  })
  .strict();

const aepTrimPathSchema = z
  .object({
    start: aepAnimatableOf(z.number().min(0).max(1)),
    end: aepAnimatableOf(z.number().min(0).max(1)),
    offset: aepAnimatableOf(z.number()).optional(),
  })
  .strict();

// ---------- text -----------------------------------------------------------
// `align` accepts 7 enum values + the legacy `"justify"` alias (coerced to
// `"justify-last-left"` at parse time). `tracking` / `leading` are the
// canonical names; `letterSpacing` / `lineHeight` remain as deprecated
// aliases for callers built against earlier schemas.
export const aepTextStyleSchema = z
  .object({
    font: z.string(),
    size: aepAnimatableOf(z.number().min(0)),
    fill: aepThemableColorSchema.optional(),
    stroke: aepStrokeSchema.optional(),
    weight: z.union([z.number(), z.string()]).optional(),
    italic: z.boolean().optional(),
    letterSpacing: aepAnimatableOf(z.number()).optional(),
    lineHeight: aepAnimatableOf(z.number()).optional(),
    tracking: aepAnimatableOf(z.number()).optional(),
    leading: aepAnimatableOf(z.number()).optional(),
    // Layout box. When set, the layout engine wraps soft breaks at this
    // width and uses it as the slack target for justify-* alignment. Both
    // the 2D PixiTextSplit and the 3D Aep3DTextMesh consume it via
    // useAepTextLayout.
    boxWidth: z.number().positive().optional(),
    align: aepTextAlignSchema.optional(),
    runs: z.array(aepTextStyleRunSchema).optional(),
    // Per-run rich-text spans. Renderer can ignore on first pass.
    tagStyles: z
      .record(
        z.string(),
        z
          .object({
            fill: aepColorSchema.optional(),
            weight: z.union([z.number(), z.string()]).optional(),
            italic: z.boolean().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export type AepTextStyle = z.infer<typeof aepTextStyleSchema>;
export type { AepTextStyleRun };

// ---------- common layer fields -------------------------------------------
// `inPoint`/`outPoint` follow Lottie naming — both in frames, half-open
// [in, out). `parent` references another layer's `id` in the same comp.
// Track matte (schema 1.1.0): the matted layer references its matte
// source by id. Mode controls whether the source's alpha or its
// luminance drives the matted layer's visibility, optionally inverted.
const aepTrackMatteSchema = z
  .object({
    sourceId: z.string().min(1),
    mode: z.enum(["alpha", "alpha-inverted", "luma", "luma-inverted"]),
  })
  .strict();
export type AepTrackMatte = z.infer<typeof aepTrackMatteSchema>;

const layerBase = {
  id: z.string().min(1),
  name: z.string().optional(),
  inPoint: z.number().finite(),
  outPoint: z.number().finite(),
  startTime: z.number().finite().optional(),
  parent: z.string().optional(),
  blendMode: aepBlendModeSchema.optional(),
  hidden: z.boolean().optional(),
  transform: aepTransformSchema,
  masks: z.array(aepMaskSchema).optional(),
  effects: z.array(aepEffectSchema).optional(),
  // Added in schema 1.1.0. Source layer must exist in the same comp.
  trackMatte: aepTrackMatteSchema.optional(),
  // Added in schema 1.3.0. When `is3D: true` the runtime reads
  // `transform3D` and routes the layer to the Three sub-scene. The
  // 2D `transform` field stays required for back-compat at parse time;
  // the per-layer refinement requires `transform3D` when `is3D: true`.
  is3D: z.boolean().optional(),
  transform3D: aepTransform3DSchema.optional(),
};

// ---------- per-kind layers -----------------------------------------------
const assetIdField = z.string().min(1);

const aepImageLayerSchema = z
  .object({ ...layerBase, kind: z.literal("image"), assetId: assetIdField })
  .strict();

const aepVideoLayerSchema = z
  .object({
    ...layerBase,
    kind: z.literal("video"),
    assetId: assetIdField,
    timeRemap: aepAnimatableOf(z.number()).optional(),
    muted: z.boolean().optional(),
  })
  .strict();

const aepAudioLayerSchema = z
  .object({
    ...layerBase,
    kind: z.literal("audio"),
    assetId: assetIdField,
    level: aepAnimatableOf(z.number().min(0)).optional(),
    pan: aepAnimatableOf(z.number().min(-1).max(1)).optional(),
  })
  .strict();

const aepGifLayerSchema = z
  .object({ ...layerBase, kind: z.literal("gif"), assetId: assetIdField })
  .strict();

const aepLottieLayerSchema = z
  .object({
    ...layerBase,
    kind: z.literal("lottie"),
    assetId: assetIdField,
    speed: z.number().optional(),
  })
  .strict();

const aepSvgLayerSchema = z
  .object({ ...layerBase, kind: z.literal("svg"), assetId: assetIdField })
  .strict();

const aepTextLayerSchema = z
  .object({
    ...layerBase,
    kind: z.literal("text"),
    source: aepAnimatableOf(z.string()),
    style: aepTextStyleSchema,
    // Schema 1.2.0: per-char/per-word/per-line animators. Absence = single
    // text node (existing PixiTextSprite path). Presence = split renderer.
    animators: z.array(aepTextAnimatorSchema).optional(),
    splitMode: z.enum(["single", "chars", "words", "lines"]).optional(),
    // aep-22: text-layer extrusion (drei <Text3D>).
    extrusion: z
      .lazy(() => aepExtrusionSchema)
      .optional(),
  })
  .strict();

// aep-22: extruded 3D for shape + text. `depth` is the only required
// field. When set on a layer with `is3D: true`, the runtime routes the
// layer to Three's `<extrudeGeometry>` (shapes) or drei `<Text3D>`
// (text) instead of the default solid plane.
const aepExtrusionSchema = z
  .object({
    depth: aepAnimatableOf(z.number().min(0)),
    bevelEnabled: z.boolean().optional(),
    bevelThickness: aepAnimatableOf(z.number().min(0)).optional(),
    bevelSize: aepAnimatableOf(z.number().min(0)).optional(),
    bevelSegments: z.number().int().min(0).optional(),
    curveSegments: z.number().int().min(1).optional(),
    sideMaterial: z
      .object({
        color: aepColorSchema.optional(),
        metalness: z.number().min(0).max(1).optional(),
        roughness: z.number().min(0).max(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type AepExtrusion = z.infer<typeof aepExtrusionSchema>;

const aepShapeLayerSchema = z
  .object({
    ...layerBase,
    kind: z.literal("shape"),
    path: aepShapePathSchema,
    fill: aepThemableColorSchema.optional(),
    stroke: aepStrokeSchema.optional(),
    trimPath: aepTrimPathSchema.optional(),
    extrusion: aepExtrusionSchema.optional(),
  })
  .strict();

const aepNullLayerSchema = z
  .object({ ...layerBase, kind: z.literal("null") })
  .strict();

const aepPrecompLayerSchema = z
  .object({
    ...layerBase,
    kind: z.literal("precomp"),
    compId: z.string().min(1), // refs assets[compId] of type "composition"
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();

// ---------- model3d (schema 1.9.0) ----------------------------------------
// A Three.js product rendered off screen and composited into the Pixi stage
// as an ordinary layer. Unlike `is3D`, it interleaves with 2D layers at its
// own z index and is captured by Pixi's extract/export path.
const aepModel3DProportionsSchema = z
  .object({
    width: z.number().positive(),
    height: z.number().positive(),
    depth: z.number().positive().optional(),
  })
  .strict();

const aepModel3DPrimitiveSourceSchema = z
  .object({
    type: z.literal("primitive"),
    shape: z.enum(["can", "bottle", "box", "jar", "tube", "pouch"]),
    proportions: aepModel3DProportionsSchema.optional(),
    /** A box only: corner radius as a share of its shortest side, 0 (sharp) to 0.5 (a ball). Ice is a little round; a drop is a ball. */
    round: z.number().min(0).max(0.5).optional(),
  })
  .strict();

const aepModel3DExtrudeSourceSchema = z
  .object({
    type: z.literal("extrude"),
    contour: z
      .array(z.tuple([z.number(), z.number()]))
      .min(3)
      .max(2000),
    depth: aepAnimatableOf(z.number().min(0)),
    bevel: z.number().min(0).optional(),
  })
  .strict();

// Which glTF clip plays and how. Omitted -> clip 0, looping at 1x, starting at the layer's in-point
// (the pre-existing behaviour).
const aepModel3DAnimationSchema = z
  .object({
    // Clip name (e.g. "Walk") or index into `gltf.animations`. An unknown selector falls back to
    // clip 0 with a console warning, since clip names are only known once the file is loaded.
    clip: z.union([z.string().min(1), z.number().int().min(0)]).optional(),
    loop: z.boolean().optional(),
    speed: z.number().positive().optional(),
    // Seconds into the clip at the layer's in-point.
    offset: z.number().min(0).optional(),
  })
  .strict();

const aepModel3DGltfSourceSchema = z
  .object({
    type: z.literal("gltf"),
    assetId: assetIdField,
    animation: aepModel3DAnimationSchema.optional(),
  })
  .strict();

export const aepModel3DSourceSchema = z.discriminatedUnion("type", [
  aepModel3DPrimitiveSourceSchema,
  aepModel3DExtrudeSourceSchema,
  aepModel3DGltfSourceSchema,
]);

export const aepModel3DTexturesSchema = z
  .object({
    label: assetIdField.optional(),
    front: assetIdField.optional(),
    side: aepColorSchema.optional(),
  })
  .strict();

const aepModel3DMaterialSchema = z
  .object({
    roughness: aepAnimatableOf(z.number().min(0).max(1)).optional(),
    metalness: aepAnimatableOf(z.number().min(0).max(1)).optional(),
    clearcoat: z.number().min(0).max(1).optional(),
    // Cartoon look. "toon" swaps every material for a stepped-lighting MeshToonMaterial that keeps
    // the original colour and map.
    style: z.enum(["standard", "toon"]).optional(),
    toonSteps: z.number().int().min(2).max(8).optional(),
    // Inverted-hull outline (toon or standard). `width` is in model units.
    outline: z
      .object({
        color: aepColorSchema.optional(),
        width: z.number().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();

const aepModel3DViewSchema = z
  .object({
    rotation: aepAnimatableOf(
      z.tuple([z.number(), z.number(), z.number()]),
    ).optional(),
    position: aepAnimatableOf(
      z.tuple([z.number(), z.number(), z.number()]),
    ).optional(),
    scale: aepAnimatableOf(z.number().positive()).optional(),
  })
  .strict();

export const aepModel3DLightingKeySchema = z
  .object({
    azimuth: aepAnimatableOf(z.number()).optional(),
    elevation: aepAnimatableOf(z.number()).optional(),
    intensity: aepAnimatableOf(z.number().min(0)).optional(),
    color: aepColorSchema.optional(),
  })
  .strict();

const aepModel3DLightingSchema = z
  .object({
    preset: z.enum(["studio", "window", "golden", "night"]).optional(),
    key: aepModel3DLightingKeySchema.optional(),
    fill: z
      .object({
        intensity: aepAnimatableOf(z.number().min(0)).optional(),
      })
      .strict()
      .optional(),
    rim: z
      .object({
        intensity: aepAnimatableOf(z.number().min(0)).optional(),
      })
      .strict()
      .optional(),
    environment: z.enum(["room", "none"]).optional(),
  })
  .strict();

const aepModel3DShadowSchema = z
  .object({
    opacity: aepAnimatableOf(z.number().min(0).max(1)),
    softness: z.number().min(0).max(1).optional(),
    offsetY: z.number().optional(),
  })
  .strict();

export const aepModel3DViewportSchema = z
  .object({
    width: z.number().int().min(16).max(4096),
    height: z.number().int().min(16).max(4096),
  })
  .strict();

// Rest-pose bounds in model units (before `view` scale/position). Frames the camera and sizes the
// shadow when the loaded model's own bounds are wrong, e.g. a skinned glTF whose animation reaches
// far outside its bind pose.
const aepModel3DBoundsSchema = z
  .object({
    center: z.tuple([z.number(), z.number(), z.number()]).optional(),
    size: z.tuple([
      z.number().positive(),
      z.number().positive(),
      z.number().positive(),
    ]),
  })
  .strict();

const aepModel3DLayerSchema = z
  .object({
    ...layerBase,
    kind: z.literal("model3d"),
    viewport: aepModel3DViewportSchema,
    source: aepModel3DSourceSchema,
    textures: aepModel3DTexturesSchema.optional(),
    material: aepModel3DMaterialSchema.optional(),
    view: aepModel3DViewSchema.optional(),
    lighting: aepModel3DLightingSchema.optional(),
    shadow: aepModel3DShadowSchema.optional(),
    bounds: aepModel3DBoundsSchema.optional(),
    camera: z
      .object({
        // Animatable: the camera re-frames the model at every fov, so the model holds its size on screen
        // while the perspective changes (a dolly zoom).
        fov: aepAnimatableOf(z.number().min(10).max(90)).optional(),
        fit: z.number().min(0.5).max(3).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type AepModel3DLayer = z.infer<typeof aepModel3DLayerSchema>;
export type AepModel3DAnimation = z.infer<typeof aepModel3DAnimationSchema>;
export type AepModel3DSource = z.infer<typeof aepModel3DSourceSchema>;
export type AepModel3DLighting = z.infer<typeof aepModel3DLightingSchema>;
export type AepModel3DShadow = z.infer<typeof aepModel3DShadowSchema>;
export type AepModel3DViewport = z.infer<typeof aepModel3DViewportSchema>;
export type AepModel3DBounds = z.infer<typeof aepModel3DBoundsSchema>;

// ---------- stage3d (schema 1.11.0; cinematic fields 1.12.0) ---------------
// One shared Three scene: a set, rigged actors playing named clips, props and
// a product under shared lights and shadows. Rendered off screen like
// `model3d`. Units are metres, Y up, ground at y = 0.
const stageVec3 = z.tuple([z.number(), z.number(), z.number()]);

const aepStageCameraSchema = z
  .object({
    // Animatable from schema 1.12.0: a moving camera re-renders, it does not rebuild the world.
    position: aepAnimatableOf(stageVec3),
    target: aepAnimatableOf(stageVec3),
    fov: aepAnimatableOf(z.number().min(10).max(90)).optional(),
    // Stretch (FR11): focus pull.
    focus: z
      .object({
        distance: aepAnimatableOf(z.number().positive()),
        aperture: z.number().min(0).max(1),
      })
      .strict()
      .optional(),
  })
  .strict();

const aepStageSetSchema = z
  .object({
    backdrop: assetIdField.optional(),
    ground: z.union([aepColorSchema, z.literal("none")]).optional(),
    groundSize: z.tuple([z.number().positive(), z.number().positive()]).optional(),
    // `false` removes the wall entirely (schema 1.12.0); a backdrop needs a wall.
    wall: z
      .union([
        z
          .object({
            distance: z.number().positive().optional(),
            height: z.number().positive().optional(),
            curve: z.number().min(0).optional(),
          })
          .strict(),
        z.literal(false),
      ])
      .optional(),
    fog: z
      .object({
        color: aepColorSchema,
        near: z.number().min(0),
        far: z.number().positive(),
      })
      .strict()
      .optional(),
    // A glossy floor: the world reflected in the ground, soft, strongest under the product and gone at `fade`
    // metres from it (schema 1.12.0). Needs a ground.
    reflection: z
      .object({
        strength: z.number().min(0).max(1),
        fade: z.number().positive().max(10).optional(),
        blur: z.number().min(0).max(1).optional(),
      })
      .strict()
      .optional(),
    // Caustics: the rippling net of light a glass of liquid throws on the floor, strongest round the product and gone at `fade`
    // metres; `scale` is ripples per metre (schema 1.12.0). Needs a ground.
    caustics: z
      .object({
        strength: z.number().min(0).max(1),
        fade: z.number().positive().max(10).optional(),
        scale: z.number().positive().max(200).optional(),
        color: aepColorSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const aepStageSpotSchema = z
  .object({
    id: z.string().min(1),
    position: aepAnimatableOf(stageVec3),
    target: aepAnimatableOf(stageVec3),
    intensity: aepAnimatableOf(z.number().min(0)),
    angle: aepAnimatableOf(z.number().min(1).max(89)).optional(),
    penumbra: z.number().min(0).max(1).optional(),
    color: aepColorSchema.optional(),
    castShadow: z.boolean().optional(),
  })
  .strict();

const aepStageLightsSchema = z
  .object({
    preset: z.enum(["studio", "window", "golden", "night"]).optional(),
    key: aepModel3DLightingKeySchema.optional(),
    fill: z
      .object({ intensity: aepAnimatableOf(z.number().min(0)).optional() })
      .strict()
      .optional(),
    rim: z
      .object({ intensity: aepAnimatableOf(z.number().min(0)).optional(), color: aepColorSchema.optional() })
      .strict()
      .optional(),
    ambient: aepAnimatableOf(z.number().min(0)).optional(),
    environment: z.enum(["room", "none"]).optional(),
    spots: z
      .array(aepStageSpotSchema)
      .max(STAGE3D_LIMITS.spots, `stage3d allows at most ${STAGE3D_LIMITS.spots} spot lights`)
      .optional(),
  })
  .strict();

const aepStageShadowSchema = z
  .object({
    opacity: aepAnimatableOf(z.number().min(0).max(1)).optional(),
    softness: z.number().min(0).max(1).optional(),
  })
  .strict();

// `startFrame` and every keyframe `t` are composition frames (engine convention).
export const aepStageClipSchema = z
  .object({
    clipAssetId: assetIdField.optional(),
    name: z.string().min(1).optional(),
    startFrame: z.number().int().min(0),
    speed: z.number().positive().optional(),
    loop: z.boolean().optional(),
    offset: z.number().min(0).optional(),
    fadeFrames: z.number().int().min(0).max(60).optional(),
  })
  .strict()
  .refine((c) => c.clipAssetId !== undefined || c.name !== undefined, {
    message: "stage clip needs clipAssetId or name",
  });

const aepStageStyleSchema = z
  .object({
    shading: z.enum(["toon", "pbr"]).optional(),
    toonSteps: z.number().int().min(2).max(8).optional(),
    outline: z
      .object({
        color: aepColorSchema.optional(),
        width: z.number().positive(),
      })
      .strict()
      .optional(),
    exposure: z.number().positive().optional(),
  })
  .strict();

// The finish: screen effects over the whole rendered world, the way a commercial is graded. bloom lets bright
// things glow (the halo behind a can, a hot rim), vignette darkens the corners, grain is fine film noise,
// aberration fringes the colours at the edges, grade shifts brightness, contrast, saturation and hue.
// Bloom's intensity can be keyframed (a glow that swells in the end hold). Schema 1.12.0.
const aepStagePostSchema = z
  .object({
    bloom: z
      .object({
        intensity: aepAnimatableOf(z.number().min(0).max(4)),
        threshold: z.number().min(0).max(1).optional(),
        radius: z.number().min(0).max(1).optional(),
      })
      .strict()
      .optional(),
    vignette: z.object({ offset: z.number().min(0).max(1).optional(), darkness: z.number().min(0).max(1) }).strict().optional(),
    grain: z.object({ opacity: z.number().min(0).max(0.5) }).strict().optional(),
    aberration: z.object({ offset: z.number().min(0).max(0.01) }).strict().optional(),
    // Motion blur at export: each frame inside a span is drawn `samples` times across the shutter's open time (a share of the frame, 0 to 1) and averaged.
    motionBlur: z
      .object({
        samples: z.number().int().min(2).max(16).optional(),
        shots: z
          .array(z.object({ startFrame: z.number().finite().min(0), durationFrames: z.number().finite().positive(), shutter: z.number().min(0).max(1) }).strict())
          .max(16),
      })
      .strict()
      .optional(),
    grade: z
      .object({
        brightness: z.number().min(-0.5).max(0.5).optional(),
        contrast: z.number().min(0).max(0.5).optional(),
        saturation: z.number().min(-1).max(1).optional(),
        hue: z.number().min(-180).max(180).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// Shader transitions at the cuts between the world's own shots (an open gl-transitions shader by name, e.g. CrossZoom,
// Ripple, Swirl, GlitchDisplace, FilmBurn). From `startFrame` it plays for `durationFrames`: the old shot's last camera
// pose mixes into the new shot. Composition frames. Schema 1.12.0.
const aepStageShotTransitionSchema = z
  .object({
    startFrame: z.number().finite().min(0),
    durationFrames: z.number().finite().positive(),
    name: z.string().min(1).max(40),
    params: z.record(z.string(), z.union([z.number(), z.boolean(), z.array(z.number()).min(2).max(4)])).optional(),
  })
  .strict();

// The WORLD: camera, set, lights, shadow, style. The only stage layer that
// renders; actor3d / prop3d members name it with `stage` and are gathered into
// its Three scene. Bare ZodObject so it can join the discriminated union;
// layer-level checks live in refineStage3DLayer.
// Defaults: fov 35, ground #d9cbb8, groundSize [10, 8], wall distance 3 /
// height 5 / curve 1, spot angle 25 / penumbra 0.4, shadow opacity 0.55 /
// softness 0.5, shading toon, toonSteps 3, outline #1a1a1a, exposure 1.
const aepStage3DLayerSchema = z
  .object({
    ...layerBase,
    kind: z.literal("stage3d"),
    viewport: aepModel3DViewportSchema,
    camera: aepStageCameraSchema,
    set: aepStageSetSchema.optional(),
    lights: aepStageLightsSchema.optional(),
    shadow: aepStageShadowSchema.optional(),
    style: aepStageStyleSchema.optional(),
    post: aepStagePostSchema.optional(),
    shotTransitions: z.array(aepStageShotTransitionSchema).max(8).optional(),
  })
  .strict();

// Members live in the world's 3D space only: no 2D transform, parent, masks,
// effects, trackMatte, blendMode or is3D. They render nothing at Pixi level.
const stageMemberBase = {
  id: z.string().min(1),
  name: z.string().optional(),
  // The member exists in the scene only while inPoint <= F < outPoint.
  inPoint: z.number().finite(),
  outPoint: z.number().finite(),
  startTime: z.number().finite().optional(),
  // Editor eye toggle: built, but not drawn and casts no shadow.
  hidden: z.boolean().optional(),
  // Id of a stage3d layer in the SAME composition.
  stage: z.string().min(1),
};

const aepActor3DLayerSchema = z
  .object({
    ...stageMemberBase,
    kind: z.literal("actor3d"),
    assetId: assetIdField,
    height: z.number().positive().optional(),
    // [x, z, facingDeg]
    marks: aepAnimatableOf(stageVec3),
    clips: z
      .array(aepStageClipSchema)
      .max(STAGE3D_LIMITS.clipsPerActor, `actor3d allows at most ${STAGE3D_LIMITS.clipsPerActor} clips`)
      .optional(),
    rootMotion: z.enum(["strip", "keep"]).optional(),
    castShadow: z.boolean().optional(),
  })
  .strict();

const aepProp3DAttachSchema = z
  .object({
    actor: z.string().min(1),
    bone: z.string().min(1),
  })
  .strict();

// Cinematic material controls (schema 1.12.0). Roughness/metalness animate;
// the rest are build-time. Glass uses transmission + ior + thickness.
const aepProp3DMaterialSchema = z
  .object({
    color: aepColorSchema.optional(),
    roughness: aepAnimatableOf(z.number().min(0).max(1)).optional(),
    metalness: aepAnimatableOf(z.number().min(0).max(1)).optional(),
    clearcoat: z.number().min(0).max(1).optional(),
    transmission: z.number().min(0).max(1).optional(),
    ior: z.number().min(1).max(2.333).optional(),
    thickness: z.number().min(0).optional(),
    opacity: z.number().min(0).max(1).optional(),
    // Beads of water on the surface (a cold can), 0 dry to 1 soaked. Schema 1.12.0.
    condensation: z.number().min(0).max(1).optional(),
  })
  .strict();

// A flat image plane. The still comes from `textures.front`; `frames` is a
// flipbook that overrides it. Cards are prop3d-only.
const aepProp3DCardSourceSchema = z
  .object({
    type: z.literal("card"),
    frames: z.array(assetIdField).min(2).max(48).optional(),
    fps: z.number().positive().max(60).optional(),
    // default false: hold the last frame.
    loop: z.boolean().optional(),
  })
  .strict();

// A moving liquid: metaballs that flow together and apart, timed to the prop's in/out points. crown is a
// splash rising into a ring that breaks into drops; pour is a stream falling into a pool; blobs float and
// merge round the middle. `size` is the edge of the box it plays in, standing on the prop's position; its
// look is the prop's material (a glossy colour, or transmission for a clear liquid). Prop3d-only.
export const PROP3D_LIQUID_FORMS = ["crown", "pour", "blobs", "vortex"] as const;
const aepProp3DLiquidSourceSchema = z
  .object({
    type: z.literal("liquid"),
    form: z.enum(PROP3D_LIQUID_FORMS),
    seed: z.number().int().optional(),
  })
  .strict();

// Soft vapour: steam rising, a cloud of smoke that wraps and clears, or a burst of fine powder, timed to the prop's
// in/out points and tinted by material.color. `size` is the edge of its box, standing on the prop's position. Prop3d-only.
export const PROP3D_SMOKE_FORMS = ["steam", "cloud", "powder"] as const;
const aepProp3DSmokeSourceSchema = z
  .object({
    type: z.literal("smoke"),
    form: z.enum(PROP3D_SMOKE_FORMS),
    seed: z.number().int().optional(),
  })
  .strict();

const aepProp3DSwarmSchema = z
  .object({
    count: z.number().int().min(1).max(STAGE3D_LIMITS.instancesPerSwarm),
    seed: z.number().int(),
    motion: z.enum(["fall", "burst", "orbit", "drift", "pour"]),
    emitter: z
      .object({
        shape: z.enum(["point", "box", "sphere", "ring"]),
        center: stageVec3,
        size: stageVec3.optional(),
        radius: z.number().positive().optional(),
      })
      .strict(),
    // burst / pour main direction. Defaults to [0, 1, 0].
    direction: stageVec3.optional(),
    spread: z.number().min(0).max(180).optional(),
    speed: z.number().min(0).optional(),
    gravity: z.number().min(0).optional(),
    drag: z.number().min(0).optional(),
    spin: z.number().min(0).optional(),
    sizeJitter: z.number().min(0).max(0.9).optional(),
    stagger: z.number().min(0).optional(),
    growFrames: z.number().int().min(0).max(30).optional(),
    orbit: z
      .object({
        radius: z.number().positive(),
        // degrees per second; the sign sets the direction.
        angularSpeed: z.number(),
        height: z.number().min(0).optional(),
        bob: z.number().min(0).optional(),
      })
      .strict()
      .optional(),
    drift: z
      .object({
        velocity: stageVec3.optional(),
        amplitude: stageVec3.optional(),
        frequency: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    bounce: z.boolean().optional(),
  })
  .strict();

const aepProp3DLayerSchema = z
  .object({
    ...stageMemberBase,
    kind: z.literal("prop3d"),
    // "product" marks the hero object for Director / critic / lint; rendering is identical.
    role: z.enum(["prop", "product"]).optional(),
    source: z.union([aepModel3DSourceSchema, aepProp3DCardSourceSchema, aepProp3DLiquidSourceSchema, aepProp3DSmokeSourceSchema]),
    textures: aepModel3DTexturesSchema.optional(),
    size: z.number().positive().optional(),
    position: aepAnimatableOf(stageVec3).optional(),
    rotation: aepAnimatableOf(stageVec3).optional(),
    scale: aepAnimatableOf(stageVec3).optional(),
    attach: aepProp3DAttachSchema.optional(),
    castShadow: z.boolean().optional(),
    // Faces the camera each frame; Z still applies as a roll.
    billboard: z.boolean().optional(),
    // Card lighting. Cards default to unlit so label colours stay authored.
    lit: z.boolean().optional(),
    material: aepProp3DMaterialSchema.optional(),
    // One prop -> N instanced copies. Omitted motion keeps the single mesh path.
    swarm: aepProp3DSwarmSchema.optional(),
  })
  .strict();

export type AepStage3DLayer = z.infer<typeof aepStage3DLayerSchema>;
export type AepStageClip = z.infer<typeof aepStageClipSchema>;
export type AepActor3DLayer = z.infer<typeof aepActor3DLayerSchema>;
export type AepProp3DLayer = z.infer<typeof aepProp3DLayerSchema>;
export type AepProp3DSource = AepProp3DLayer["source"];
export type AepProp3DCardSource = z.infer<typeof aepProp3DCardSourceSchema>;
export type AepProp3DLiquidSource = z.infer<typeof aepProp3DLiquidSourceSchema>;
export type AepProp3DMaterial = z.infer<typeof aepProp3DMaterialSchema>;
export type AepProp3DSwarm = z.infer<typeof aepProp3DSwarmSchema>;
export type AepStageMemberLayer = AepActor3DLayer | AepProp3DLayer;
export type AepStageSpot = z.infer<typeof aepStageSpotSchema>;
export type AepStageStyle = z.infer<typeof aepStageStyleSchema>;

export const aepLayerSchema = z
  .discriminatedUnion("kind", [
    aepImageLayerSchema,
    aepVideoLayerSchema,
    aepAudioLayerSchema,
    aepGifLayerSchema,
    aepLottieLayerSchema,
    aepSvgLayerSchema,
    aepTextLayerSchema,
    aepShapeLayerSchema,
    aepNullLayerSchema,
    aepPrecompLayerSchema,
    aepModel3DLayerSchema,
    aepStage3DLayerSchema,
    aepActor3DLayerSchema,
    aepProp3DLayerSchema,
    aepCameraLayerSchema,
    aepLightLayerSchema,
  ])
  .superRefine((layer, ctx) => {
    // Schema 1.3.0: `is3D: true` requires a `transform3D`. Camera and
    // light layers always carry `transform3D` (no 2D variant), so we
    // skip them here.
    if (layer.kind === "camera" || layer.kind === "light") return;
    if (layer.kind === "stage3d") refineStage3DLayer(layer, ctx);
    if (layer.kind === "actor3d") refineActor3DLayer(layer, ctx);
    if (layer.kind === "prop3d") refineProp3DLayer(layer, ctx);
    if (layer.kind === "actor3d" || layer.kind === "prop3d") return;
    if (layer.kind === "model3d" && layer.source.type === "primitive" && layer.source.round !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "model3d source.round is only for a stage prop3d box", path: ["source", "round"] });
    }
    if (layer.is3D === true && !layer.transform3D) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "is3D: true requires a `transform3D` field",
        path: ["transform3D"],
      });
    }
  });
export type AepLayer = z.infer<typeof aepLayerSchema>;
export type AepLayerKind = AepLayer["kind"];
