// Ported from the upstream AEP schema (types/aep/effect.ts, MIT).
import { z } from "zod";
import { aepAnimatableOf } from "./transform";

// Stock AE effects bridged in phase 11. Names match AE's menu labels
// (lowercased, kebab-cased) so importers can map verbatim.
export const aepEffectNameSchema = z.enum([
  "drop-shadow",
  "gaussian-blur",
  "directional-blur",
  "glow",
  "levels",
  "curves",
  "hue-saturation",
  "tint",
  "fill",
  "tritone",
  "fast-box-blur",
  "color-balance",
  "brightness-contrast",
]);
export type AepEffectName = z.infer<typeof aepEffectNameSchema>;

// `params` is an animatable bag — the renderer dispatches on `name`
// and reads only the params it knows about for that effect.
export const aepEffectSchema = z
  .object({
    name: aepEffectNameSchema,
    enabled: z.boolean().optional(),
    params: z.record(
      z.string(),
      // Each param is either a static primitive or an animatable form.
      // Strings cover hex colors; animatable<string> lets a color tween
      // between hex stops (drop-shadow.color, glow.color, …).
      z.union([
        z.string(),
        z.boolean(),
        aepAnimatableOf(z.number()),
        aepAnimatableOf(z.string()),
        aepAnimatableOf(z.tuple([z.number(), z.number()])),
        aepAnimatableOf(
          z.tuple([z.number(), z.number(), z.number(), z.number()]),
        ),
      ]),
    ),
  })
  .strict();
export type AepEffect = z.infer<typeof aepEffectSchema>;
