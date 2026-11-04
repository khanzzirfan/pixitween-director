import { z } from 'zod';
import { GroupLayerSchema, ImageLayerSchema, ShapeLayerSchema, TextLayerSchema } from './layers2d';
import { ThreeLayerSchema } from './layer3d';

export type ImageLayer = z.output<typeof ImageLayerSchema>;
export type TextLayer = z.output<typeof TextLayerSchema>;
export type ShapeLayer = z.output<typeof ShapeLayerSchema>;
export type ThreeLayer = z.output<typeof ThreeLayerSchema>;
export type LayerBase = Omit<ImageLayer, 'type' | 'asset' | 'width' | 'height' | 'tint'>;
export type GroupLayer = LayerBase & { type: 'group'; children: Layer[] };

export type Layer = ImageLayer | TextLayer | ShapeLayer | GroupLayer | ThreeLayer;

// The discriminated union is lazy so layers2d (which needs LayerSchema for group
// children) and this module can import each other without an initialisation cycle.
export const LayerSchema: z.ZodType<Layer, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.discriminatedUnion('type', [ImageLayerSchema, TextLayerSchema, ShapeLayerSchema, GroupLayerSchema, ThreeLayerSchema]),
);
