// Ported from the upstream AEP schema (types/aep/mask.ts, MIT).
import { z } from "zod";
import { aepAnimatableOf, aepKeyframeOf } from "./transform";

const vec2 = z.tuple([z.number(), z.number()]);

// Bezier mask path — same shape as Lottie ShapeProp.
// vertices/inTangents/outTangents are parallel arrays of 2-tuples;
// `closed` toggles whether the last vertex connects back to the first.
export const aepBezierPathSchema = z
  .object({
    vertices: z.array(vec2),
    inTangents: z.array(vec2),
    outTangents: z.array(vec2),
    closed: z.boolean(),
  })
  .strict();
export type AepBezierPath = z.infer<typeof aepBezierPathSchema>;

export const aepMaskModeSchema = z.enum([
  "add",
  "subtract",
  "intersect",
  "lighten",
  "darken",
  "difference",
  "alpha",
]);
export type AepMaskMode = z.infer<typeof aepMaskModeSchema>;

export const aepMaskSchema = z
  .object({
    id: z.string().min(1),
    mode: aepMaskModeSchema,
    inverted: z.boolean().optional(),
    opacity: aepAnimatableOf(z.number().min(0).max(1)).optional(),
    expansion: aepAnimatableOf(z.number()).optional(),
    // Path keyframes follow the same envelope as transforms — animated
    // mask paths share the cubic-bezier ease handles.
    path: z.union([
      aepBezierPathSchema,
      z.array(aepKeyframeOf(aepBezierPathSchema)).min(1),
    ]),
  })
  .strict();
export type AepMask = z.infer<typeof aepMaskSchema>;
