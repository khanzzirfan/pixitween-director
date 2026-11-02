// Ported from the upstream AEP schema (types/aep/transform.ts, MIT).
import { z, type ZodTypeAny } from "zod";

// Bezier-handle ease — same shape as CSS cubic-bezier (x1,y1,x2,y2).
// Importers must convert AE's Influence/Speed to this form.
export const aepEaseHandleSchema = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .describe("cubic-bezier(x1,y1,x2,y2)");
export type AepEaseHandle = z.infer<typeof aepEaseHandleSchema>;

// Keyframe<T>. `t` is in frames (composition fps is the source of truth).
// `hold: true` means step-interpolation (no tween to the next kf).
export const aepKeyframeOf = <V extends ZodTypeAny>(value: V) =>
  z
    .object({
      t: z.number().finite(),
      v: value,
      easeIn: aepEaseHandleSchema.optional(),
      easeOut: aepEaseHandleSchema.optional(),
      hold: z.boolean().optional(),
    })
    .strict();

// "Static T or animated T[]". Renderer dispatches on Array.isArray.
export const aepAnimatableOf = <V extends ZodTypeAny>(value: V) =>
  z.union([value, z.array(aepKeyframeOf(value)).min(1)]);

// Generic alias mirroring the runtime schema for downstream consumers.
export type AepKeyframe<T> = {
  t: number;
  v: T;
  easeIn?: AepEaseHandle;
  easeOut?: AepEaseHandle;
  hold?: boolean;
};
export type AepAnimatable<T> = T | AepKeyframe<T>[];

const vec2 = z.tuple([z.number(), z.number()]);

export const aepTransformSchema = z
  .object({
    position: aepAnimatableOf(vec2),
    anchor: aepAnimatableOf(vec2),
    scale: aepAnimatableOf(vec2),
    rotation: aepAnimatableOf(z.number()), // degrees, or radians for a legacy film (see ./rotation.ts)
    opacity: aepAnimatableOf(z.number().min(0).max(1)),
    skew: aepAnimatableOf(z.number()).optional(),
    skewAxis: aepAnimatableOf(z.number()).optional(),
  })
  .strict();

export type AepTransform = z.infer<typeof aepTransformSchema>;
