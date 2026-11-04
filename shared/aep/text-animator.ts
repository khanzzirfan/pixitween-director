// Ported from the upstream AEP schema (types/aep/text-animator.ts, MIT).
import { z } from "zod";
import { aepAnimatableOf } from "./transform";

// AE's range selector "Shape" enum. Drives the per-character amount curve
// across [start, end].
export const aepRangeShapeSchema = z.enum([
  "square",
  "ramp-up",
  "ramp-down",
  "triangle",
  "round",
  "smooth",
]);
export type AepRangeShape = z.infer<typeof aepRangeShapeSchema>;

// AE selector "Based On" enum.
export const aepRangeBasedOnSchema = z.enum(["chars", "words", "lines"]);
export type AepRangeBasedOn = z.infer<typeof aepRangeBasedOnSchema>;

// Range selector — AE: Start, End, Offset, all in [0,1] (we use direct
// fractions; importers normalize AE's 0..100% to 0..1).
export const aepTextRangeSelectorSchema = z
  .object({
    start: aepAnimatableOf(z.number()),
    end: aepAnimatableOf(z.number()),
    offset: aepAnimatableOf(z.number()).optional(),
    basedOn: aepRangeBasedOnSchema.optional(),
    shape: aepRangeShapeSchema.optional(),
    smoothness: aepAnimatableOf(z.number()).optional(),
    easeHigh: aepAnimatableOf(z.number()).optional(),
    easeLow: aepAnimatableOf(z.number()).optional(),
  })
  .strict();
export type AepTextRangeSelector = z.infer<typeof aepTextRangeSelectorSchema>;

// One animator — `amount` 0..1 modulates the offsets' contribution. AE's
// "fill color" offset is replace-style at amount=1, blended at <1.
export const aepTextAnimatorSchema = z
  .object({
    range: aepTextRangeSelectorSchema,
    amount: aepAnimatableOf(z.number()).optional(),
    positionOffset: aepAnimatableOf(z.tuple([z.number(), z.number()])).optional(),
    scaleOffset: aepAnimatableOf(z.tuple([z.number(), z.number()])).optional(),
    rotationOffset: aepAnimatableOf(z.number()).optional(),
    opacityOffset: aepAnimatableOf(z.number()).optional(),
    fillOffset: z
      .string()
      .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
      .optional(),
  })
  .strict();
export type AepTextAnimator = z.infer<typeof aepTextAnimatorSchema>;
