// Owned by S16b. The toy-studio stage tools: addStage, placeActor, cueClip, moveActor, placeProp, placeStageProduct and setLightCue.
// Registered only when CARTOON_MODE is on (server/tools/registry.ts). Times are in seconds at this boundary and become scene frames in server/cartoon/stage-api.ts.
import { z } from 'zod';
import type { ToolCtx, ToolDef, ToolResult } from '@shared/tools';
import { sceneMeta } from '../authoring/meta';
import { addStage, cueClip, moveActor, placeActor, placeProp, setLightCue, type Mark } from '../cartoon/stage-api';
import { runAuthoring } from './authoring';

const FPS = 30;
const sec = (s: number) => Math.round(s * FPS);
const scene = z.string().min(1);
const actor = z.string().min(1).describe('the actor id, local to the scene');
const mark = z.tuple([z.number(), z.number(), z.number()]).describe('[x, z, facingDeg]: metres from the centre of the stage, and the way it faces in degrees');

function tool<A>(name: string, description: string, params: z.ZodType<A, z.ZodTypeDef, unknown>, run: (ctx: ToolCtx, args: A) => Promise<ToolResult>): ToolDef {
  if (description.length > 200) throw new Error(`tool description for ${name} is over 200 characters`);
  return { name, description, params, run } as unknown as ToolDef;
}

export const tools: ToolDef[] = [
  tool(
    'addStage',
    'Give a scene a 3D world: a locked camera, a set, light, toon look and a shot size (wide, medium, close, low, high, over). Do this first. The camera cannot move.',
    z.object({ sceneId: scene, backdropAssetId: z.string().optional(), shot: z.enum(['wide', 'medium', 'close', 'low', 'high', 'over']).optional(), lightPreset: z.enum(['studio', 'window', 'golden', 'night']).optional(), shading: z.enum(['toon', 'pbr']).optional() }).strict(),
    async (ctx, a) => {
      const ground = a.backdropAssetId ? (await ctx.films.get(ctx.filmId)).cast?.find((m) => m.assetId === a.backdropAssetId)?.ground : undefined;
      return runAuthoring(ctx, `addStage ${a.sceneId}`, (c) => ({ next: addStage(c, a.sceneId, { ...(ground ? { ground } : {}), ...(a.backdropAssetId ? { backdropAssetId: a.backdropAssetId } : {}), ...(a.shot ? { shot: a.shot } : {}), ...(a.lightPreset ? { lightPreset: a.lightPreset } : {}), ...(a.shading ? { style: { shading: a.shading } } : {}) }), data: { sceneId: a.sceneId, layerId: `${a.sceneId}:world` } }));
    },
  ),
  tool(
    'placeActor',
    'Put a rigged character on the stage at a mark. At most 3 per stage. atSec is when it walks on (default 0).',
    z.object({ sceneId: scene, actorId: actor, assetId: z.string(), mark, atSec: z.number().min(0).optional(), height: z.number().positive().max(3).optional() }).strict(),
    (ctx, a) => runAuthoring(ctx, `placeActor ${a.sceneId}/${a.actorId}`, (c) => ({ next: placeActor(c, a.sceneId, a.actorId, a.assetId, a.mark as Mark, { inFrame: sec(a.atSec ?? 0), ...(a.height ? { height: a.height } : {}) }), data: { layerId: `${a.sceneId}:${a.actorId}` } })),
  ),
  tool(
    'cueClip',
    'Make an actor play a clip from atSec: a motion clip asset (clipAssetId) or the name of a clip inside the model. Keep cues at least 0.2 s apart.',
    z.object({ sceneId: scene, actorId: actor, clipAssetId: z.string().optional(), clip: z.string().optional(), atSec: z.number().min(0), loop: z.boolean().optional(), speed: z.number().positive().optional() }).strict(),
    (ctx, a) => runAuthoring(ctx, `cueClip ${a.sceneId}/${a.actorId}`, (c) => ({ next: cueClip(c, a.sceneId, a.actorId, { ...(a.clipAssetId ? { assetId: a.clipAssetId } : {}), ...(a.clip ? { name: a.clip } : {}) }, sec(a.atSec), { ...(a.loop ? { loop: true } : {}), ...(a.speed ? { speed: a.speed } : {}) }), data: { layerId: `${a.sceneId}:${a.actorId}` } })),
  ),
  tool(
    'moveActor',
    'Walk an actor to a mark: it stays put until atSec, then eases there over durationSec. Pair it with a walk clip.',
    z.object({ sceneId: scene, actorId: actor, toMark: mark, atSec: z.number().min(0), durationSec: z.number().positive().max(10) }).strict(),
    (ctx, a) => runAuthoring(ctx, `moveActor ${a.sceneId}/${a.actorId}`, (c) => ({ next: moveActor(c, a.sceneId, a.actorId, a.toMark as Mark, sec(a.atSec), sec(a.durationSec)), data: { layerId: `${a.sceneId}:${a.actorId}` } })),
  ),
  tool(
    'placeProp',
    'Put an object on the stage: a model (assetId) or a simple shape. size is its height in metres. attach holds it in a character hand, for example { actor, bone: "RightHand" }. At most 6.',
    z.object({
      sceneId: scene, propId: z.string().min(1), assetId: z.string().optional(), shape: z.enum(['can', 'bottle', 'box', 'jar', 'tube', 'pouch', 'sphere']).optional(),
      size: z.number().positive().max(1.2).optional(), position: z.tuple([z.number(), z.number(), z.number()]).optional(), attach: z.object({ actor, bone: z.string().min(1) }).optional(),
    }).strict(),
    (ctx, a) => runAuthoring(ctx, `placeProp ${a.sceneId}/${a.propId}`, (c) => ({ next: placeProp(c, a.sceneId, a.propId, { ...(a.assetId ? { assetId: a.assetId } : {}), ...(a.shape ? { shape: a.shape } : {}), ...(a.size ? { size: a.size } : {}), ...(a.position ? { position: a.position } : {}), ...(a.attach ? { attach: a.attach } : {}) }), data: { layerId: `${a.sceneId}:${a.propId}` } })),
  ),
  tool(
    'placeStageProduct',
    'Put the hero product on the stage (one per stage). Same arguments as placeProp. The critic checks that it is visible and that no caption crosses it.',
    z.object({
      sceneId: scene, propId: z.string().min(1).optional(), assetId: z.string().optional(), shape: z.enum(['can', 'bottle', 'box', 'jar', 'tube', 'pouch', 'sphere']).optional(),
      size: z.number().positive().max(1.2).optional(), position: z.tuple([z.number(), z.number(), z.number()]).optional(), attach: z.object({ actor, bone: z.string().min(1) }).optional(),
    }).strict(),
    (ctx, a) => runAuthoring(ctx, `placeStageProduct ${a.sceneId}`, (c) => ({ next: placeProp(c, a.sceneId, a.propId ?? 'product', { product: true, ...(a.assetId ? { assetId: a.assetId } : {}), ...(a.shape ? { shape: a.shape } : {}), ...(a.size ? { size: a.size } : {}), ...(a.position ? { position: a.position } : {}), ...(a.attach ? { attach: a.attach } : {}) }), data: { layerId: `${a.sceneId}:${a.propId ?? 'product'}` } })),
  ),
  tool(
    'setLightCue',
    'Set the mood of a scene: dawn (key rises from nothing, warm), studio, spotlight (dark around, bright in the middle) or night (dim, cool rim).',
    z.object({ sceneId: scene, cue: z.enum(['dawn', 'studio', 'spotlight', 'night']) }).strict(),
    (ctx, a) => runAuthoring(ctx, `setLightCue ${a.sceneId} ${a.cue}`, (c) => {
      sceneMeta(c, a.sceneId);
      return { next: setLightCue(c, a.sceneId, a.cue), data: { layerId: `${a.sceneId}:world` } };
    }),
  ),
];
