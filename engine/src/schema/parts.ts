import { z } from 'zod';
import { EaseSchema, IdSchema, ParamValueSchema, SecondsSchema, parseUnitTarget } from './scalars';
import { EffectTypeSchema, PresetNameSchema } from './enums';
import { ShotSpecSchema } from './shot';

const NumberOrStringSchema = z.union([z.number(), z.string()]);
const PropMapSchema = z.record(z.string(), NumberOrStringSchema);

// A preset parameter is a number, a string or a boolean — and a shot, which `cameraTo` frames
// (engine/docs/09-camera.md).
const PresetParamValueSchema = z.union([ParamValueSchema, ShotSpecSchema]);

export const STAGGER_ORIGINS = ['start', 'end', 'center', 'edges'] as const;

export const StaggerSchema = z
  .object({
    each: SecondsSchema,
    from: z.enum(STAGGER_ORIGINS).default('start'),
  })
  .strict();

export type Stagger = z.output<typeof StaggerSchema>;

export const TweenSchema = z
  .object({
    target: z.string().optional(),
    at: SecondsSchema,
    duration: SecondsSchema,
    ease: EaseSchema,
    from: PropMapSchema.optional(),
    to: PropMapSchema.refine((value) => Object.keys(value).length >= 1, { message: 'expected at least one property' }),
    repeat: z.number().int().min(0).max(100).default(0),
    yoyo: z.boolean().default(false),
    stagger: StaggerSchema.optional(),
  })
  .strict()
  .superRefine((tween, ctx) => {
    if (tween.stagger && (tween.target === undefined || parseUnitTarget(tween.target) === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'stagger needs a multi-unit target (glyphs:<id>, words:<id> or lines:<id>)',
        path: ['stagger'],
      });
    }
  });

export const PresetRefSchema = z
  .object({
    name: PresetNameSchema,
    duration: SecondsSchema.positive().optional(),
    ease: EaseSchema.optional(),
    target: z.string().optional(),
    params: z.record(z.string(), PresetParamValueSchema).optional(),
  })
  .strict();

export const EffectSchema = z
  .object({
    id: IdSchema,
    type: EffectTypeSchema,
    enabled: z.boolean().default(true),
    params: z.record(z.string(), z.union([z.number(), z.string()])).default({}),
  })
  .strict();

export type EffectSpec = z.output<typeof EffectSchema>;
