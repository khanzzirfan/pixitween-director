// Ported from the upstream AEP schema (types/aep/camera.ts, MIT).
import { z } from "zod";
import { aepAnimatableOf, aepTransformSchema } from "./transform";
import { aepTransform3DSchema } from "./transform3D";

// Schema 1.3.0: Camera layer. Routed via aep-18 to a Three
// `<PerspectiveCamera>` inside the PixiThreeSprite sub-scene.
//
// Carries the same `transform` field as 2D layers for shape compatibility
// with downstream consumers (parent chain, sequence wrapping). The 3D
// transform on `transform3D` is the one the camera-mapper reads.

export const aepCameraLayerSchema = z
  .object({
    kind: z.literal("camera"),
    id: z.string().min(1),
    name: z.string().optional(),
    inPoint: z.number().finite(),
    outPoint: z.number().finite(),
    startTime: z.number().finite().optional(),
    parent: z.string().optional(),
    hidden: z.boolean().optional(),
    transform: aepTransformSchema,
    transform3D: aepTransform3DSchema,
    // Vertical field-of-view, degrees. AE's "Zoom" maps to this.
    fov: aepAnimatableOf(z.number().positive()),
    // Depth-of-field controls. Honored once aep-18's R3F post-processing
    // stack lands; emitted by the importer regardless so we don't lose data.
    focusDistance: aepAnimatableOf(z.number().positive()).optional(),
    aperture: aepAnimatableOf(z.number().min(0)).optional(),
    blurLevel: aepAnimatableOf(z.number().min(0)).optional(),
    zoom: aepAnimatableOf(z.number().positive()).optional(),
    // aep-21: when true, suppress the cameraLensBlur auto-inject even if
    // focusDistance/aperture/blurLevel are set. Authors can still attach
    // an explicit `cameraLensBlur` postFx entry to override.
    disableCameraDoF: z.boolean().optional(),
  })
  .strict();

export type AepCameraLayer = z.infer<typeof aepCameraLayerSchema>;
