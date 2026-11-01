// Ported from the upstream AEP schema (types/aep/light.ts, MIT).
import { z } from "zod";
import { aepAnimatableOf, aepTransformSchema } from "./transform";
import { aepTransform3DSchema } from "./transform3D";

// Schema 1.3.0: Light layer. Routed via aep-18 to a Three light primitive
// (`ambient` | `point` | `spot` | `parallel` -> `directional`).
//
// Carries `transform` for shape compatibility with downstream consumers
// (parent chain, sequence wrapping); the 3D transform on `transform3D`
// drives the light placement.

const aepLightColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "expected #RRGGBB or #RRGGBBAA");

export const aepLightLayerSchema = z
  .object({
    kind: z.literal("light"),
    id: z.string().min(1),
    name: z.string().optional(),
    inPoint: z.number().finite(),
    outPoint: z.number().finite(),
    startTime: z.number().finite().optional(),
    parent: z.string().optional(),
    hidden: z.boolean().optional(),
    transform: aepTransformSchema,
    transform3D: aepTransform3DSchema,
    lightType: z.enum(["ambient", "point", "spot", "parallel"]),
    intensity: aepAnimatableOf(z.number().min(0)),
    color: aepAnimatableOf(aepLightColorSchema),
    falloff: aepAnimatableOf(z.number().min(0)).optional(),
    // Spot-only — ignored by other light types.
    coneAngle: aepAnimatableOf(z.number().min(0).max(180)).optional(),
    coneFeather: aepAnimatableOf(z.number().min(0).max(100)).optional(),
    castsShadows: z.boolean().optional(),
  })
  .strict();

export type AepLightLayer = z.infer<typeof aepLightLayerSchema>;
