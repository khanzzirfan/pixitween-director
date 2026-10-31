import { z } from 'zod';
import type { ToolCtx, ToolDef, ToolResult } from '@shared/tools';
import { removeLayer } from '../authoring/api';
import { AuthoringError } from '../authoring/errors';
import { EditError, findLayer, mapAnimatable } from './edit-helpers';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';

async function apply(
  ctx: ToolCtx,
  layerId: string,
  note: string,
  fn: (comp: AepCompositionJson) => AepCompositionJson,
): Promise<ToolResult> {
  try {
    const film = await ctx.films.get(ctx.filmId);
    if (!film.composition) return { ok: false, error: 'film has no composition' };
    const comp = structuredClone(film.composition);
    const next = fn(comp);
    const r = await ctx.films.commit(ctx.filmId, next, 'chat', note);
    return r.ok ? { ok: true, version: r.version, data: { layerId } } : { ok: false, error: 'invalid composition', zodIssues: r.issues };
  } catch (e) {
    return { ok: false, error: e instanceof EditError ? e.message : e instanceof Error ? e.message : 'edit failed' };
  }
}
/** A stage actor or prop has no 2D transform: it is placed by its marks or position. */
function flat(layer: any, id: string): any {
  if (!layer.transform) throw new AuthoringError('bad_value', `layer '${id}' is a 3D stage member and has no 2D transform`, 'Use moveActor, or place the prop again');
  return layer;
}
export const scaleLayer: ToolDef<{ layerId: string; factor: number }> = {
  name: 'scaleLayer',
  description: 'Scale a layer; larger factor = bigger (1 = unchanged).',
  params: z.object({ layerId: z.string(), factor: z.number().min(0.1).max(5) }),
  run(ctx, a) {
    return apply(ctx, a.layerId, `scaleLayer ${a.layerId} x${a.factor}`, (comp) => {
      const layer = flat(findLayer(comp, a.layerId).layer, a.layerId);
      layer.transform.scale = mapAnimatable(layer.transform.scale as any, (v: any) => [v[0] * a.factor, v[1] * a.factor]) as any;
      return comp;
    });
  },
};
export const nudgeLayer: ToolDef<{ layerId: string; dxPct?: number; dyPct?: number }> = {
  name: 'nudgeLayer',
  description: 'Move a layer by percent of frame; positive dyPct moves down.',
  params: z
    .object({ layerId: z.string(), dxPct: z.number().min(-100).max(100).optional(), dyPct: z.number().min(-100).max(100).optional() })
    .refine((a) => a.dxPct !== undefined || a.dyPct !== undefined, 'give dxPct or dyPct'),
  run(ctx, a) {
    return apply(ctx, a.layerId, `nudgeLayer ${a.layerId}`, (comp) => {
      const layer = flat(findLayer(comp, a.layerId).layer, a.layerId);
      const position = layer.transform.position as any;
      layer.transform.position = mapAnimatable(position, (v: any) => [
        Math.max(-0.5 * comp.width, Math.min(1.5 * comp.width, v[0] + ((a.dxPct ?? 0) * comp.width) / 100)),
        Math.max(-0.5 * comp.height, Math.min(1.5 * comp.height, v[1] + ((a.dyPct ?? 0) * comp.height) / 100)),
      ]) as any;
      return comp;
    });
  },
};
const restyleParams = z
  .object({
    layerId: z.string(),
    font: z.string().optional(),
    size: z.number().positive().optional(),
    color: z
      .string()
      .regex(/^#[\da-f]{6}$/i)
      .optional(),
    weight: z.union([z.number(), z.string()]).optional(),
    italic: z.boolean().optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
  })
  .refine((a) => Object.keys(a).length > 1, 'give at least one style field');
export const restyleText: ToolDef = {
  name: 'restyleText',
  description: 'Change a text layer style without changing its words.',
  params: restyleParams,
  async run(ctx, raw) {
    const a = restyleParams.parse(raw);
    return apply(ctx, a.layerId, `restyleText ${a.layerId}`, (comp) => {
      const { layer } = findLayer(comp, a.layerId);
      if (layer.kind !== 'text') throw new Error('not a text layer');
      const style = (layer as any).style;
      for (const key of ['font', 'size', 'weight', 'italic', 'align'] as const) if (a[key] !== undefined) style[key] = a[key];
      if (a.color) style.fill = a.color;
      return comp;
    });
  },
};
export const deleteLayer: ToolDef<{ layerId: string }> = {
  name: 'deleteLayer',
  description: 'Delete a layer when its scene will still have other layers.',
  params: z.object({ layerId: z.string() }),
  run(ctx, a) {
    return apply(ctx, a.layerId, `deleteLayer ${a.layerId}`, (comp) => {
      const found = findLayer(comp, a.layerId);
      if (found.layer.kind === 'camera') throw new Error('cannot delete a camera layer');
      if (found.sceneId) {
        const scene = (comp.precomps as any)[found.sceneId];
        if (scene.layers.length <= 1) throw new Error('scene has only this layer; use removeScene');
      }
      return removeLayer(comp, a.layerId);
    });
  },
};
export const tools: ToolDef[] = [scaleLayer, nudgeLayer, restyleText, deleteLayer];
