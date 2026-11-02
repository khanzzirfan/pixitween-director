import { z } from 'zod';
import type { ToolCtx, ToolDef, ToolResult } from '@shared/tools';
import type { FilmState } from '@shared/composition';
import { layerIdsByRole, registerAsset, reorderLayer, setCamera } from '../authoring/api';
import { readDirector } from '../authoring/meta';
import { coverBox, productBox } from '../art/geometry';
import { ArtError, toolError } from '../art/errors';
import { cutout } from '../art/cutout';
import { extractBrandTerms, lintPrompt } from '../art/lint';
import { ensureInnerAsset, replaceRoleLayer, reapplyCamera, withMaskAsset, withProductNoun, ROLE_Z } from '../art/layers';
import { editProductImage, generatePlateImage, subjectPrompt } from '../art/stills';
import { charge } from '../art/events';
import { PRICE } from '../art/prices';

export interface ArtData {
  layerId: string;
  assetIds: string[];
  sizes: Array<{ id: string; width: number; height: number }>;
  costUsd: number;
  source?: 'photo' | 'scene-edit' | 'photo-fallback';
  confidence?: number;
  warning?: string;
}
const common = { sceneId: z.string() };
const plateParams = z.object({
  ...common,
  setting: z.string().min(3).max(300),
  mood: z.string().max(120).optional(),
  overscan: z.number().min(1).max(1.4).optional(),
});
const ctxFilm = (ctx: ToolCtx) => ctx.films.get(ctx.filmId);
const modeCheck = (film: FilmState, sceneId: string) => {
  const meta = (film.composition?.meta as { director?: { scenes?: Record<string, { mode: string }> } } | undefined)?.director?.scenes ?? {};
  const scene = meta[sceneId];
  if (!scene) throw new ArtError('unknown-scene', `unknown scene '${sceneId}'`);
  if (scene.mode === 'generate') throw new ArtError('generate-mode', `scene ${sceneId} is generate-mode`);
};
const commit = async (ctx: ToolCtx, comp: NonNullable<FilmState['composition']>, note: string) => {
  const r = await ctx.films.commit(ctx.filmId, comp, ctx.source ?? 'director', note);
  if (!r.ok) return { ok: false as const, error: 'invalid composition', zodIssues: r.issues };
  return { ok: true as const, version: r.version };
};
const fail = (e: unknown): ToolResult => toolError(e);

export const generatePlateTool: ToolDef = {
  name: 'generatePlate',
  description: 'Generate an empty background plate for a motion scene.',
  params: plateParams,
  async run(ctx, raw) {
    const a = plateParams.parse(raw);
    try {
      const film = await ctxFilm(ctx);
      if (!film.composition) throw new ArtError('unknown-scene', `unknown scene '${a.sceneId}'`);
      modeCheck(film, a.sceneId);
      const old = layerIdsByRole(film.composition, 'bg', a.sceneId)[0];
      if (old && film.assets.some((asset) => asset.role === 'plate' && asset.sceneId === a.sceneId))
        throw new ArtError('plate-exists', `scene ${a.sceneId} already has a plate; use replacePlate`);
      const before = ctx.ledger.total(ctx.filmId);
      const asset = await generatePlateImage(ctx, { ...a, aspect: film.aspect });
      const current = (await ctx.films.get(ctx.filmId)).composition ?? film.composition;
      let comp = registerAsset(current, { id: asset.id, kind: 'image', src: asset.url, width: asset.width, height: asset.height });
      const camera =
        readDirector(comp).scenes[a.sceneId]?.camera?.move ?? film.storyboard?.scenes.find((s) => s.id === a.sceneId)?.camera ?? 'static';
      comp = replaceRoleLayer(comp, a.sceneId, 'bg', {
        sceneId: a.sceneId,
        role: 'bg',
        kind: 'image',
        assetId: asset.id,
        box: coverBox(
          { w: asset.width!, h: asset.height! },
          { w: comp.width, h: comp.height },
          a.overscan ?? (camera === 'static' ? 1 : 1.15),
        ),
        z: ROLE_Z.bg,
      });
      comp = ensureInnerAsset(comp, a.sceneId, asset.id);
      comp = setCamera(comp, a.sceneId, camera);
      const result = await commit(ctx, comp, `generatePlate ${a.sceneId}`);
      return result.ok
        ? {
            ...result,
            data: {
              layerId: `${a.sceneId}:bg`,
              assetIds: [asset.id],
              sizes: [{ id: asset.id, width: asset.width!, height: asset.height! }],
              costUsd: ctx.ledger.total(ctx.filmId) - before,
            },
          }
        : result;
    } catch (e) {
      return fail(e);
    }
  },
};

const productParams = z.object({
  ...common,
  noun: z.string().min(1, "noun is required: the short noun phrase for the product, e.g. 'mug'").max(60),
  source: z.enum(['photo', 'scene-edit']).default('photo'),
  lighting: z.string().max(120).optional(),
  heightFrac: z.number().min(0.2).max(0.9).optional(),
  cx: z.number().min(0).max(1).optional(),
  baseline: z.number().min(0.3).max(0.98).optional(),
});
export const placeProductTool: ToolDef = {
  name: 'placeProduct',
  description: 'Cut out the real product from the photo; needs the short product noun.',
  params: productParams,
  async run(ctx, raw) {
    const a = productParams.parse(raw);
    try {
      const film = await ctxFilm(ctx);
      if (!film.composition) throw new ArtError('unknown-scene', `unknown scene '${a.sceneId}'`);
      modeCheck(film, a.sceneId);
      const brief = `${film.brief.text} ${film.brief.transcript ?? ''}`;
      const lint = lintPrompt(`${a.noun} ${a.lighting ?? ''}`, { brandTerms: extractBrandTerms(brief) });
      if (!lint.ok) throw new ArtError('lint', `prompt rejected: ${lint.violations.map((v) => `${v.rule} "${v.term}"`).join(', ')}`);
      const before = ctx.ledger.total(ctx.filmId);
      const photo = await ctx.assets.read(film.brief.productAssetId);
      const photoCut = await cutout(ctx, {
        source: photo,
        noun: a.noun,
        sceneId: a.sceneId,
        cacheKey: `${ctx.filmId}:${film.brief.productAssetId}:${a.noun.toLowerCase()}`,
      });
      let selected = photoCut,
        source: ArtData['source'] = 'photo',
        warning: string | undefined;
      if (a.source === 'scene-edit') {
        try {
          const edited = await editProductImage(ctx, { photo, noun: a.noun, lighting: a.lighting, sceneId: a.sceneId });
          const editedCut = await cutout(ctx, {
            source: edited.bytes,
            noun: a.noun,
            sceneId: a.sceneId,
            cacheKey: `${ctx.filmId}:edit:${a.sceneId}:${a.noun.toLowerCase()}`,
          });
          const arPhoto = (photoCut.bounds.right - photoCut.bounds.left) / (photoCut.bounds.bottom - photoCut.bounds.top);
          const arEdited = (editedCut.bounds.right - editedCut.bounds.left) / (editedCut.bounds.bottom - editedCut.bounds.top);
          if (Math.abs(arEdited / arPhoto - 1) > 0.25)
            throw new Error(`edited product aspect ratio changed too much (${arPhoto.toFixed(3)} to ${arEdited.toFixed(3)})`);
          selected = editedCut;
          source = 'scene-edit';
        } catch (e) {
          selected = photoCut;
          source = 'photo-fallback';
          warning = e instanceof Error ? `scene edit aspect check failed: ${e.message}` : 'scene edit unavailable';
        }
      }
      const currentComposition = await ctx.films.get(ctx.filmId).then((fresh) => fresh.composition ?? film.composition!);
      let comp = registerAsset(currentComposition, {
        id: selected.cutout.id,
        kind: 'image',
        src: selected.cutout.url,
        width: selected.cutout.width,
        height: selected.cutout.height,
      });
      comp = registerAsset(comp, {
        id: selected.mask.id,
        kind: 'image',
        src: selected.mask.url,
        width: selected.mask.width,
        height: selected.mask.height,
      });
      const box = productBox(
        { w: selected.cutout.width!, h: selected.cutout.height! },
        { w: comp.width, h: comp.height },
        { heightFrac: a.heightFrac, cx: a.cx, baseline: a.baseline },
      );
      comp = replaceRoleLayer(comp, a.sceneId, 'product', {
        sceneId: a.sceneId,
        role: 'product',
        kind: 'image',
        assetId: selected.cutout.id,
        box,
        z: ROLE_Z.product,
      });
      const layerId = layerIdsByRole(comp, 'product', a.sceneId)[0]!;
      comp = ensureInnerAsset(comp, a.sceneId, selected.cutout.id);
      comp = withMaskAsset(comp, layerId, selected.mask.id);
      comp = withProductNoun(comp, a.noun);
      comp = reapplyCamera(comp, film, a.sceneId);
      const result = await commit(ctx, comp, `placeProduct ${a.sceneId}`);
      return result.ok
        ? {
            ...result,
            data: {
              layerId,
              assetIds: [selected.cutout.id, selected.mask.id],
              sizes: [
                { id: selected.cutout.id, width: selected.cutout.width!, height: selected.cutout.height! },
                { id: selected.mask.id, width: selected.mask.width!, height: selected.mask.height! },
              ],
              costUsd: ctx.ledger.total(ctx.filmId) - before,
              source,
              ...(selected.confidence !== undefined ? { confidence: selected.confidence } : {}),
              ...(warning ? { warning } : {}),
            },
          }
        : result;
    } catch (e) {
      return fail(e);
    }
  },
};

const subjectParams = z.object({
  ...common,
  description: z.string().min(3).max(300),
  noun: z.string().min(1).max(60).default('person'),
  heightFrac: z.number().min(0.2).max(0.9).default(0.75),
  cx: z.number().min(0).max(1).default(0.28),
});
export const addSubjectTool: ToolDef = {
  name: 'addSubject',
  description: 'Generate a generic hand or person and add it as a cut-out subject.',
  params: subjectParams,
  async run(ctx, raw) {
    const a = subjectParams.parse(raw);
    try {
      const film = await ctxFilm(ctx);
      if (!film.composition) throw new ArtError('unknown-scene', `unknown scene '${a.sceneId}'`);
      modeCheck(film, a.sceneId);
      const prompt = subjectPrompt(a.description);
      const lint = lintPrompt(prompt, {
        subject: true,
        brandTerms: extractBrandTerms(`${film.brief.text} ${film.brief.transcript ?? ''}`),
      });
      if (!lint.ok) throw new ArtError('lint', `prompt rejected: ${lint.violations.map((v) => `${v.rule} "${v.term}"`).join(', ')}`);
      const before = ctx.ledger.total(ctx.filmId);
      const rawImage = await ctx.meta.image.generate(prompt, '1536x1024');
      charge(ctx, 'muse-image-1.0', '1 image', PRICE.museImageUsd);
      const generatedSize = await import('../media/image').then(({ imageSize }) => imageSize(rawImage));
      const generated = await ctx.assets.put(rawImage, generatedSize.mime, {
        role: 'still',
        sceneId: a.sceneId,
        width: generatedSize.width,
        height: generatedSize.height,
      });
      const object = await cutout(ctx, {
        source: rawImage,
        noun: a.noun,
        sceneId: a.sceneId,
        cacheKey: `${ctx.filmId}:subject:${generated.id}`,
      });
      const comp = (await ctx.films.get(ctx.filmId)).composition ?? film.composition;
      let next = registerAsset(comp, {
        id: object.cutout.id,
        kind: 'image',
        src: object.cutout.url,
        width: object.cutout.width,
        height: object.cutout.height,
      });
      const box = productBox(
        { w: object.cutout.width!, h: object.cutout.height! },
        { w: comp.width, h: comp.height },
        { heightFrac: a.heightFrac, cx: a.cx, baseline: 0.92 },
      );
      next = replaceRoleLayer(next, a.sceneId, 'subject', {
        sceneId: a.sceneId,
        role: 'subject',
        kind: 'image',
        assetId: object.cutout.id,
        box,
        z: ROLE_Z.subject,
      });
      next = ensureInnerAsset(next, a.sceneId, object.cutout.id);
      next = reapplyCamera(next, film, a.sceneId);
      const result = await commit(ctx, next, `addSubject ${a.sceneId}`);
      return result.ok
        ? {
            ...result,
            data: {
              layerId: `${a.sceneId}:subject`,
              assetIds: [generated.id, object.cutout.id, object.mask.id],
              sizes: [],
              costUsd: ctx.ledger.total(ctx.filmId) - before,
              confidence: object.confidence,
            },
          }
        : result;
    } catch (e) {
      return fail(e);
    }
  },
};

export const replacePlateTool: ToolDef = {
  name: 'replacePlate',
  description: 'Replace an existing generated background plate with a new setting.',
  params: plateParams,
  async run(ctx, raw) {
    const a = plateParams.parse(raw);
    try {
      const film = await ctxFilm(ctx);
      if (!film.composition) throw new ArtError('unknown-scene', `unknown scene '${a.sceneId}'`);
      modeCheck(film, a.sceneId);
      const id = layerIdsByRole(film.composition, 'bg', a.sceneId)[0];
      const layer = id ? film.composition.precomps?.[a.sceneId]?.layers.find((l) => l.id === id) : undefined;
      const oldAssetId = layer?.kind === 'image' ? layer.assetId : undefined;
      const oldAsset =
        oldAssetId && film.assets.find((asset) => asset.id === oldAssetId && asset.role === 'plate' && asset.sceneId === a.sceneId);
      if (!oldAssetId || !oldAsset) throw new ArtError('no-plate', `scene ${a.sceneId} has no plate; use generatePlate`);
      const before = ctx.ledger.total(ctx.filmId);
      const asset = await generatePlateImage(ctx, { ...a, aspect: film.aspect });
      const currentComposition = registerAsset((await ctx.films.get(ctx.filmId)).composition ?? film.composition, {
        id: asset.id,
        kind: 'image',
        src: asset.url,
        width: asset.width,
        height: asset.height,
      });
      let comp = replaceRoleLayer(
        currentComposition,
        a.sceneId,
        'bg',
        {
          sceneId: a.sceneId,
          role: 'bg',
          kind: 'image',
          assetId: asset.id,
          box: coverBox(
            { w: asset.width!, h: asset.height! },
            { w: currentComposition.width, h: currentComposition.height },
            a.overscan ?? 1,
          ),
        },
        { keepOpacity: true },
      );
      delete comp.assets[oldAssetId];
      if (comp.precomps?.[a.sceneId]?.assets[oldAssetId]) delete comp.precomps[a.sceneId]!.assets[oldAssetId];
      comp = reapplyCamera(comp, film, a.sceneId);
      const result = await commit(ctx, comp, `replacePlate ${a.sceneId}`);
      return result.ok
        ? {
            ...result,
            data: {
              layerId: `${a.sceneId}:bg`,
              assetIds: [asset.id],
              sizes: [{ id: asset.id, width: asset.width!, height: asset.height! }],
              costUsd: ctx.ledger.total(ctx.filmId) - before,
            },
          }
        : result;
    } catch (e) {
      return fail(e);
    }
  },
};

const behindParams = z.object({ ...common, behind: z.boolean().default(true) });
export const setHeadlineBehindProductTool: ToolDef = {
  name: 'setHeadlineBehindProduct',
  description: 'Place the headline behind the product cut-out, or bring it back to the front.',
  params: behindParams,
  async run(ctx, raw) {
    const a = behindParams.parse(raw);
    try {
      const film = await ctxFilm(ctx);
      if (!film.composition) throw new ArtError('unknown-scene', `unknown scene '${a.sceneId}'`);
      modeCheck(film, a.sceneId);
      const heads = layerIdsByRole(film.composition, 'headline', a.sceneId),
        products = layerIdsByRole(film.composition, 'product', a.sceneId),
        bgs = layerIdsByRole(film.composition, 'bg', a.sceneId);
      if (!heads.length || !products.length) throw new ArtError('order-invalid', 'scene needs both a headline and product layer');
      const ids = (film.composition.precomps![a.sceneId]!.layers as Array<{ id: string }>).map((l) => l.id);
      const already = a.behind ? ids.indexOf(heads[0]!) < ids.indexOf(products[0]!) : ids.indexOf(heads[0]!) > ids.indexOf(products[0]!);
      if (already && (!bgs.length || ids.indexOf(bgs[0]!) < ids.indexOf(heads[0]!)))
        return { ok: true, version: film.version, data: { layerId: heads[0], assetIds: [], sizes: [], costUsd: 0 } };
      const comp = reorderLayer(film.composition, heads[0]!, a.behind ? { below: products[0]! } : { above: products[0]! });
      const nextIds = (comp.precomps![a.sceneId]!.layers as Array<{ id: string }>).map((l) => l.id);
      if (bgs.length && nextIds.indexOf(bgs[0]!) > nextIds.indexOf(heads[0]!))
        throw new ArtError('order-invalid', 'background must be below the headline');
      const result = await commit(ctx, comp, `headline ${a.behind ? 'behind' : 'in front of'} product ${a.sceneId}`);
      return result.ok ? { ...result, data: { layerId: heads[0], assetIds: [], sizes: [], costUsd: 0 } } : result;
    } catch (e) {
      return fail(e);
    }
  },
};
export const tools: ToolDef[] = [generatePlateTool, replacePlateTool, placeProductTool, addSubjectTool, setHeadlineBehindProductTool];
