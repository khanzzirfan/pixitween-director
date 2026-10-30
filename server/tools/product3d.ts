// Owned by S13a. placeProduct3D, turnProduct and lightProduct: the three tools that put the real product, turning in studio light, into a scene.
// Registered only when PRODUCT_3D is on (server/tools/registry.ts).
import { z } from 'zod';
import type { FilmState } from '@shared/composition';
import type { ToolCtx, ToolDef, ToolResult } from '@shared/tools';
import { AuthoringError } from '../authoring/errors';
import { readDirector } from '../authoring/meta';
import { productBox } from '../art/geometry';
import { lightProduct as light, placeProduct3D as place, turnProduct as turn } from '../product3d/authoring';
import { prepareProduct3D } from '../product3d/prepare';
import { PRESETS, SHAPES } from '../product3d/types';

export const STUB_OWNER = 'S13a' as const;

const sceneParam = z.string().min(1);
const layerOf = (sceneId: string) => `${sceneId}:product3d`;
/** Placing is a builder's work (the context's own source); turning and lighting are edits, recorded as chat like the other edit tools. */
const commit = async (ctx: ToolCtx, comp: NonNullable<FilmState['composition']>, note: string, source: 'chat' | undefined = undefined): Promise<ToolResult> => {
  const r = await ctx.films.commit(ctx.filmId, comp, source ?? ctx.source ?? 'director', note);
  return r.ok ? { ok: true, version: r.version } : { ok: false, error: 'invalid composition', zodIssues: r.issues };
};
const fail = (e: unknown): ToolResult => ({ ok: false, error: e instanceof AuthoringError || e instanceof Error ? e.message : 'internal error' });

/** Where the 2D product shows now: the layer's own box, from the camera base when a move has keyed it. */
function currentBox(film: FilmState, sceneId: string): { box: { x: number; y: number; w: number; h: number }; cutoutId: string } | undefined {
  const comp = film.composition;
  if (!comp) return undefined;
  const meta = readDirector(comp);
  const entry = Object.entries(meta.layers).find(([, m]) => m.sceneId === sceneId && m.role === 'product');
  if (!entry) return undefined;
  const [id, lm] = entry;
  const layer = (comp.precomps?.[sceneId]?.layers as Array<Record<string, any>> | undefined)?.find((l) => l.id === id);
  const asset = lm.assetId ? comp.assets[lm.assetId] : undefined;
  if (!layer || !lm.assetId || !asset) return undefined;
  const firstOf = <T>(v: T | Array<{ v: T }>): T => (Array.isArray(v) && v.length && typeof v[0] === 'object' && 'v' in (v[0] as object) ? (v[0] as { v: T }).v : (v as T));
  const pos = lm.base ? ([lm.base.x, lm.base.y] as [number, number]) : firstOf<[number, number]>(layer.transform.position);
  const scale = lm.base ? ([lm.base.scale, lm.base.scale] as [number, number]) : firstOf<[number, number]>(layer.transform.scale);
  const w = (asset.width ?? comp.width) * scale[0];
  const h = (asset.height ?? comp.height) * scale[1];
  return { box: { x: pos[0] - w / 2, y: pos[1] - h / 2, w, h }, cutoutId: lm.assetId };
}

const placeParams = z.object({
  sceneId: sceneParam,
  shape: z.enum([...SHAPES, 'other']).optional(),
  box: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }).optional(),
  preset: z.enum(PRESETS).optional(),
  sway: z.number().min(0).max(35).optional(),
});

export const placeProduct3DTool: ToolDef<z.infer<typeof placeParams>> = {
  name: 'placeProduct3D',
  description:
    "Show the real product as a turning 3D model in a scene, wearing its photo's label, in studio light with a soft shadow. Needs the product placed in the scene first (placeProduct). shape defaults to the film's product shape; sway is degrees either side of the front (default 18, most 35).",
  params: placeParams,
  async run(ctx, a) {
    try {
      const film = await ctx.films.get(ctx.filmId);
      const comp = film.composition;
      const sm = comp ? readDirector(comp).scenes[a.sceneId] : undefined;
      if (!comp || !sm) return { ok: false, error: `unknown scene '${a.sceneId}'` };
      if (sm.mode === 'generate') return { ok: false, error: `scene ${a.sceneId} is generate-mode` };
      const here = currentBox(film, a.sceneId);
      if (!here) return { ok: false, error: `scene ${a.sceneId} has no product cut-out yet: place the product first (placeProduct)` };
      const shape = a.shape ?? readDirector(comp).productShape ?? 'can';
      const prepared = await prepareProduct3D(ctx.assets, { cutoutAssetId: here.cutoutId, shape, filmId: ctx.filmId, sceneId: a.sceneId });
      const box = a.box ?? here.box ?? productBox({ w: 1, h: 1 }, { w: comp.width, h: comp.height });
      const next = place(comp, {
        sceneId: a.sceneId,
        box,
        shape: prepared.shape,
        texture: { id: prepared.texture.id, url: prepared.texture.url, width: prepared.texture.width ?? 0, height: prepared.texture.height ?? 0, kind: prepared.textureKind },
        side: prepared.side,
        aspect: prepared.aspect,
        ...(prepared.contour ? { contour: prepared.contour } : {}),
        ...(a.preset ? { preset: a.preset } : {}),
        ...(a.sway !== undefined ? { sway: a.sway } : {}),
      });
      const done = await commit(ctx, next, `placeProduct3D ${a.sceneId}`);
      if (!done.ok) return done;
      ctx.emit({ type: 'art.asset', asset: prepared.texture });
      return { ...done, data: { layerId: layerOf(a.sceneId), shape: prepared.shape, assetIds: [prepared.texture.id], ...(prepared.fallback ? { fallback: prepared.fallback } : {}) } };
    } catch (e) {
      return fail(e);
    }
  },
};

const turnParams = z.object({
  sceneId: sceneParam,
  from: z.number().optional(),
  to: z.number().optional(),
  tilt: z.number().min(-20).max(20).optional(),
  speed: z.number().min(0.1).max(8).optional(),
});

export const turnProductTool: ToolDef<z.infer<typeof turnParams>> = {
  name: 'turnProduct',
  description: "Change how the 3D product turns in a scene: from and to are degrees about the vertical axis (clamped to 35 either side of the front); speed 1 turns across the whole scene.",
  params: turnParams,
  async run(ctx, a) {
    try {
      const film = await ctx.films.get(ctx.filmId);
      if (!film.composition) return { ok: false, error: 'film has no composition yet' };
      const r = turn(film.composition, layerOf(a.sceneId), { ...(a.from !== undefined ? { from: a.from } : {}), ...(a.to !== undefined ? { to: a.to } : {}), ...(a.tilt !== undefined ? { tilt: a.tilt } : {}), ...(a.speed !== undefined ? { speed: a.speed } : {}) });
      const done = await commit(ctx, r.comp, `turnProduct ${a.sceneId}`, 'chat');
      return done.ok ? { ...done, data: { layerId: layerOf(a.sceneId), from: r.from, to: r.to, clamped: r.clamped, ...(r.clamped ? { note: 'angles are limited to 35 degrees either side of the front' } : {}) } } : done;
    } catch (e) {
      return fail(e);
    }
  },
};

const lightParams = z.object({
  sceneId: sceneParam,
  preset: z.enum(PRESETS).optional(),
  azimuth: z.number().min(-180).max(180).optional(),
  elevation: z.number().min(-90).max(90).optional(),
  intensity: z.number().min(0).max(10).optional(),
});

export const lightProductTool: ToolDef<z.infer<typeof lightParams>> = {
  name: 'lightProduct',
  description: 'Change the light on the 3D product: a preset (studio, window, golden, night) and/or the key light angle and strength.',
  params: lightParams,
  async run(ctx, a) {
    try {
      const film = await ctx.films.get(ctx.filmId);
      if (!film.composition) return { ok: false, error: 'film has no composition yet' };
      const { sceneId, ...opts } = a;
      const done = await commit(ctx, light(film.composition, layerOf(sceneId), opts), `lightProduct ${sceneId}`, 'chat');
      return done.ok ? { ...done, data: { layerId: layerOf(sceneId) } } : done;
    } catch (e) {
      return fail(e);
    }
  },
};

export const tools: ToolDef[] = [placeProduct3DTool as ToolDef, turnProductTool as ToolDef, lightProductTool as ToolDef];
