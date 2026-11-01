// Ported from the upstream AEP schema (types/aep/transform3D.ts, MIT).
import { z } from "zod";
import { aepAnimatableOf } from "./transform";

// Schema 1.3.0: 3D-aware transform for layers with `is3D: true`. Position,
// anchor, and rotation become 3-tuples; scale stays 2D (AE convention — AE
// "scale" in 3D space is still authored as %X/%Y with the depth implied).
// See specs/features/aep-18-3d-layers-via-three/.

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const vec2 = z.tuple([z.number(), z.number()]);

export const aepTransform3DSchema = z
  .object({
    position: aepAnimatableOf(vec3),
    anchor: aepAnimatableOf(vec3),
    scale: aepAnimatableOf(vec2),
    // Euler XYZ degrees. AE's left-handed Y-down system; the runtime
    // mapper (aep-18) flips Y/Z to match Three's right-handed Y-up.
    rotation: aepAnimatableOf(vec3),
    opacity: aepAnimatableOf(z.number().min(0).max(1)),
  })
  .strict();

export type AepTransform3D = z.infer<typeof aepTransform3DSchema>;
