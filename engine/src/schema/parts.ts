import { z } from 'zod';
import { EaseSchema, IdSchema, ParamValueSchema, SecondsSchema } from './scalars';
import { Filter2DTypeSchema, PostFxTypeSchema, PresetNameSchema } from './enums';

const NumberOrStringSchema = z.union([z.number(), z.string()]);
const PropMapSchema = z.record(z.string(), NumberOrStringSchema);

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
  })
  .strict();

export const PresetRefSchema = z
  .object({
    name: PresetNameSchema,
    duration: SecondsSchema.positive().optional(),
    ease: EaseSchema.optional(),
    target: z.string().optional(),
    params: z.record(z.string(), ParamValueSchema).optional(),
  })
  .strict();

export const Filter2DSchema = z
  .object({
    id: IdSchema,
    type: Filter2DTypeSchema,
    enabled: z.boolean().default(true),
    params: z.record(z.string(), ParamValueSchema).default({}),
  })
  .strict();

export const PostFxSchema = z
  .object({
    id: IdSchema,
    type: PostFxTypeSchema,
    enabled: z.boolean().default(true),
    params: z.record(z.string(), z.number()).default({}),
  })
  .strict();
