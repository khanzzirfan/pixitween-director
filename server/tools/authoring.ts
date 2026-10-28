// Owned by S3a. Thin tool wrappers over the pure authoring core: parse args with zod, apply, commit via FilmStore.mutate.
import { z } from 'zod';
import type { FilmVersion } from '@shared/composition';
import type { ToolCtx, ToolDef, ToolResult } from '@shared/tools';
import { AuthoringError, hintList } from '../authoring/errors';
import {
  addLayer, addScene, newFilmComposition, removeLayer, removeScene, reorderLayer, sceneInfo, setCamera, setKeyframes, setSceneDuration,
  setText, setTransform, swapScenes,
} from '../authoring/api';
import { readDirector } from '../authoring/meta';
import type { Comp } from '../authoring/types';

/**
 * Load, apply and commit as ONE call to films.mutate (contract D-15): never a separate get then commit, which loses an
 * update when two scene builders run at once.
 */
export async function runAuthoring<T>(ctx: ToolCtx, note: string, fn: (c: Comp) => { next: Comp; data: T }, o: { layerId?: string } = {}): Promise<ToolResult> {
  const source: FilmVersion['source'] = ctx.source ?? 'director';
  try {
    const r = await ctx.films.mutate(
      ctx.filmId,
      (film) => {
        const comp = film.composition ?? newFilmComposition({ aspect: film.aspect, title: film.storyboard?.title, palette: film.storyboard?.palette });
        try {
          return fn(comp);
        } catch (e) {
          if (e instanceof AuthoringError && e.code === 'unknown_layer' && o.layerId && !o.layerId.includes(':')) {
            const ids = Object.keys(readDirector(comp).layers);
            const near = ids.filter((id) => id.endsWith(`:${o.layerId}`));
            if (near.length) throw new AuthoringError('unknown_layer', `no layer '${o.layerId}'`, `Did you mean ${near.join(' or ')}? ${hintList(ids)}`);
          }
          throw e;
        }
      },
      source,
      note,
    );
    if (r.ok) return { ok: true, version: r.version, data: r.data };
    const issues = r.issues as Array<{ message?: string }>;
    return { ok: false, error: `invalid composition: ${issues[0]?.message ?? 'unknown issue'}`, zodIssues: issues };
  } catch (e) {
    if (e instanceof AuthoringError) return { ok: false, error: e.message };
    throw e;
  }
}

function tool<A>(name: string, description: string, params: z.ZodType<A, z.ZodTypeDef, unknown>, run: (ctx: ToolCtx, args: A) => Promise<ToolResult>): ToolDef {
  if (description.length > 160) throw new Error(`tool description for ${name} is over 160 characters`);
  return { name, description, params, run } as unknown as ToolDef;
}

const role = z.enum(['bg', 'product', 'subject', 'headline', 'caption', 'clip']);
const style = z.object({
  color: z.string().optional(), font: z.string().optional(), size: z.number().positive().optional(),
  weight: z.number().optional(), align: z.enum(['left', 'center', 'right']).optional(), boxWidth: z.number().positive().optional(),
});
const prop = z.enum(['x', 'y', 'scale', 'rotation', 'opacity']);

export const tools: ToolDef[] = [
  tool(
    'addScene',
    'Add a scene at the end of the film. durationSec is 1 to 12 seconds. mode motion animates stills; generate leaves room for an AI clip.',
    z.object({ id: z.string(), durationSec: z.number().min(1).max(12), mode: z.enum(['motion', 'generate']).default('motion'), intent: z.string().max(300).optional() }),
    (ctx, a) =>
      runAuthoring(ctx, `addScene ${a.id}`, (c) => {
        const next = addScene(c, { id: a.id, durationSec: a.durationSec, mode: a.mode, intent: a.intent });
        return { next, data: { sceneId: a.id, startSec: sceneInfo(next).find((s) => s.id === a.id)!.startSec } };
      }),
  ),
  tool(
    'setSceneDuration',
    'Change a scene length in seconds (1 to 30). Later scenes shift; keyframes past the new end are clamped.',
    z.object({ sceneId: z.string(), durationSec: z.number() }),
    (ctx, a) => runAuthoring(ctx, `setSceneDuration ${a.sceneId}`, (c) => ({ next: setSceneDuration(c, a.sceneId, a.durationSec), data: { sceneId: a.sceneId } })),
  ),
  tool('removeScene', 'Delete a scene and all its layers.', z.object({ sceneId: z.string() }), (ctx, a) =>
    runAuthoring(ctx, `removeScene ${a.sceneId}`, (c) => ({ next: removeScene(c, a.sceneId), data: {} })),
  ),
  tool('swapScenes', 'Swap the timeline positions of two scenes.', z.object({ a: z.string(), b: z.string() }), (ctx, x) =>
    runAuthoring(ctx, `swapScenes ${x.a} ${x.b}`, (c) => ({ next: swapScenes(c, x.a, x.b), data: {} })),
  ),
  tool(
    'addLayer',
    'Add a layer to a scene. box is pixels from the top-left. z larger = farther from the camera. Text needs text; image and video need assetId.',
    z.object({
      sceneId: z.string(), role, kind: z.enum(['image', 'video', 'text', 'shape']), assetId: z.string().optional(), text: z.string().optional(),
      style: style.optional(), fill: z.string().optional(), box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(), z: z.number().optional(),
    }),
    (ctx, a) =>
      runAuthoring(ctx, `addLayer ${a.sceneId}:${a.role}`, (c) => {
        const before = new Set(Object.keys(readDirector(c).layers));
        const next = addLayer(c, a);
        const layerId = Object.keys(readDirector(next).layers).find((id) => !before.has(id))!;
        return { next, data: { layerId } };
      }),
  ),
  tool('removeLayer', 'Delete a layer by id, for example s1:headline.', z.object({ layerId: z.string() }), (ctx, a) =>
    runAuthoring(ctx, `removeLayer ${a.layerId}`, (c) => ({ next: removeLayer(c, a.layerId), data: {} }), { layerId: a.layerId }),
  ),
  tool(
    'reorderLayer',
    'Move a layer in depth: front, back, or {above: id} / {below: id} within the same scene.',
    z.object({ layerId: z.string(), to: z.union([z.enum(['front', 'back']), z.object({ above: z.string() }), z.object({ below: z.string() })]) }),
    (ctx, a) => runAuthoring(ctx, `reorderLayer ${a.layerId}`, (c) => ({ next: reorderLayer(c, a.layerId, a.to), data: { layerId: a.layerId } }), { layerId: a.layerId }),
  ),
  tool(
    'setTransform',
    'Set static values: x, y in pixels from the top-left, scale 1 = 100%, rotation in degrees, opacity 0 to 1. Pass at least one.',
    z
      .object({ layerId: z.string(), x: z.number().optional(), y: z.number().optional(), scale: z.number().optional(), rotation: z.number().optional(), opacity: z.number().optional() })
      .refine((v) => [v.x, v.y, v.scale, v.rotation, v.opacity].some((n) => n !== undefined), { message: 'pass at least one of x, y, scale, rotation, opacity' }),
    (ctx, { layerId, ...p }) => runAuthoring(ctx, `setTransform ${layerId}`, (c) => ({ next: setTransform(c, layerId, p), data: { layerId } }), { layerId }),
  ),
  tool(
    'setKeyframes',
    'Animate one property. keys are [seconds from the scene start, value] pairs, ascending. prop is x, y, scale, rotation or opacity.',
    z.object({ layerId: z.string(), prop, keys: z.array(z.tuple([z.number(), z.number()])).min(1).max(12), ease: z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut']).optional() }),
    (ctx, a) => runAuthoring(ctx, `setKeyframes ${a.layerId} ${a.prop}`, (c) => ({ next: setKeyframes(c, a.layerId, a.prop, a.keys, a.ease), data: { layerId: a.layerId } }), { layerId: a.layerId }),
  ),
  tool(
    'setText',
    'Change the words (1 to 120 characters) and optionally the style of a text layer.',
    z.object({ layerId: z.string(), text: z.string().min(1).max(120), style: style.optional() }),
    (ctx, a) => runAuthoring(ctx, `setText ${a.layerId}`, (c) => ({ next: setText(c, a.layerId, a.text, a.style), data: { layerId: a.layerId } }), { layerId: a.layerId }),
  ),
  tool(
    'setCamera',
    'Give a scene a camera move: static, dolly-in, pan, orbit or parallax. strength 0 to 1. Call it last in a scene; calling again replaces it.',
    z.object({ sceneId: z.string(), move: z.enum(['static', 'dolly-in', 'pan', 'orbit', 'parallax']), strength: z.number().min(0).max(1).optional() }),
    (ctx, a) => runAuthoring(ctx, `setCamera ${a.sceneId}`, (c) => ({ next: setCamera(c, a.sceneId, a.move, a.strength), data: { sceneId: a.sceneId } })),
  ),
];
