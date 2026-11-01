// Ported from the upstream AEP schema (types/aep/postFx.ts, MIT).
import { z } from "zod";
import { aepAnimatableOf } from "./transform";

// aep-21: composition-level post-processing effects, applied to the
// Three sub-scene only. Distinct from `aepEffectSchema` (per-layer Pixi
// filters from aep-11) — the runtime homes are different.
export const aepPostFxNameSchema = z.enum([
  "cameraLensBlur",
  "bloom",
  "chromaticAberration",
  "vignette",
  "noise",
]);
export type AepPostFxName = z.infer<typeof aepPostFxNameSchema>;

export const aepPostFxSchema = z
  .object({
    name: aepPostFxNameSchema,
    enabled: z.boolean().optional(),
    params: z.record(
      z.string(),
      z.union([
        z.string(),
        z.boolean(),
        aepAnimatableOf(z.number()),
        aepAnimatableOf(z.string()),
        aepAnimatableOf(z.tuple([z.number(), z.number()])),
      ]),
    ),
  })
  .strict();
export type AepPostFx = z.infer<typeof aepPostFxSchema>;
