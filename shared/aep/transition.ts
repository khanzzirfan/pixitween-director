// Ported from the upstream AEP schema (types/aep/transition.ts, MIT).
import { z } from "zod";
type GlTransitionParam = number | boolean | number[];
export type GlTransitionParams = Record<string, GlTransitionParam>;

const transitionParamSchema = z.union([
  z.number(),
  z.boolean(),
  z.array(z.number()),
]);

export const aepTransitionSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["element", "scene"]),
    name: z.string().min(1),
    from: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    to: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    startFrame: z.number().finite().min(0),
    durationFrames: z.number().finite().positive(),
    ease: z.union([
      z.tuple([z.number(), z.number(), z.number(), z.number()]),
      z.string(),
    ]).optional(),
    params: z.record(z.string(), transitionParamSchema).optional(),
    region: z.object({
      x: z.number().finite(),
      y: z.number().finite(),
      width: z.number().positive(),
      height: z.number().positive(),
    }).strict().optional(),
    includeShared: z.boolean().optional(),
  })
  .strict()
  .superRefine((transition, ctx) => {
    if (transition.kind === "element" && (Array.isArray(transition.from) || Array.isArray(transition.to))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "element transitions require one from and one to layer id",
        path: [Array.isArray(transition.from) ? "from" : "to"],
      });
    }
  });

export type AepTransition = z.infer<typeof aepTransitionSchema>;

export interface AepTransitionOverride {
  name?: string;
  params?: GlTransitionParams;
  durationFrames?: number;
  disabled?: boolean;
}

export type AepTransitionOverrideMap = Record<string, AepTransitionOverride>;

export const transitionLayerIds = (value: AepTransition["from"] | AepTransition["to"]): string[] =>
  Array.isArray(value) ? value : [value];
