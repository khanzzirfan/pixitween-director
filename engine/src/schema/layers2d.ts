import { z } from 'zod';
import { ColorSchema, IdSchema, SecondsSchema } from './scalars';
import { Filter2DSchema, PresetRefSchema, TweenSchema } from './parts';
import { LayerSchema } from './layer';

export const LayerBaseShape = {
  id: IdSchema,
  name: z.string().optional(),
  start: SecondsSchema.default(0),
  end: SecondsSchema.optional(),
  x: z.number().default(0),
  y: z.number().default(0),
  anchor: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).default([0.5, 0.5]),
  scale: z.union([z.number(), z.tuple([z.number(), z.number()])]).default(1),
  rotation: z.number().default(0),
  alpha: z.number().min(0).max(1).default(1),
  blendMode: z.enum(['normal', 'add', 'multiply', 'screen']).default('normal'),
  filters: z.array(Filter2DSchema).max(8).default([]),
  enter: PresetRefSchema.optional(),
  exit: PresetRefSchema.optional(),
  loop: PresetRefSchema.optional(),
  tweens: z.array(TweenSchema).max(64).default([]),
};

export const TextStyleSchema = z
  .object({
    fontFamily: z.string().default('Inter, Helvetica, Arial, sans-serif'),
    fontSize: z.number().min(4).max(512).default(64),
    fontWeight: z.enum(['100', '200', '300', '400', '500', '600', '700', '800', '900', 'normal', 'bold']).default('400'),
    fontStyle: z.enum(['normal', 'italic']).default('normal'),
    fill: ColorSchema.default('#ffffff'),
    align: z.enum(['left', 'center', 'right']).default('left'),
    wordWrapWidth: z.number().positive().optional(),
    lineHeight: z.number().positive().optional(),
    letterSpacing: z.number().default(0),
    stroke: z.object({ color: ColorSchema, width: z.number().min(0).max(64) }).strict().optional(),
    dropShadow: z
      .object({
        color: ColorSchema,
        alpha: z.number().min(0).max(1).default(0.5),
        blur: z.number().min(0).max(64).default(4),
        distance: z.number().min(0).max(256).default(4),
        angle: z.number().default(45),
      })
      .strict()
      .optional(),
  })
  .strict();

export const ImageLayerSchema = z
  .object({
    ...LayerBaseShape,
    type: z.literal('image'),
    asset: IdSchema,
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    tint: ColorSchema.default('#ffffff'),
  })
  .strict();

export const TextLayerSchema = z
  .object({
    ...LayerBaseShape,
    type: z.literal('text'),
    text: z.string().min(1).max(2000),
    style: TextStyleSchema.default({}),
  })
  .strict();

export const ShapeLayerSchema = z
  .object({
    ...LayerBaseShape,
    type: z.literal('shape'),
    shape: z.enum(['rect', 'ellipse']),
    width: z.number().positive(),
    height: z.number().positive(),
    fill: ColorSchema.default('#ffffff'),
    radius: z.number().min(0).default(0),
    stroke: z.object({ color: ColorSchema, width: z.number().positive() }).strict().optional(),
  })
  .strict();

export const GroupLayerSchema = z
  .object({
    ...LayerBaseShape,
    type: z.literal('group'),
    children: z.array(z.lazy(() => LayerSchema)).min(1),
  })
  .strict();
