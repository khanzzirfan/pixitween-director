// Owned by S7a. Choose, crop and store the scene image Clippy will animate.
import sharp from 'sharp';
import type { AssetRef, FilmState } from '@shared/composition';
import type { ToolCtx } from '@shared/tools';
import { imageSize } from '../media/image';
import { flattenScene } from './flatten';

type Comp = NonNullable<FilmState['composition']>;
export type SourceKind = 'still' | 'flatten' | 'plate' | 'product-photo';
type Aspect = '16:9' | '9:16' | '1:1';

const SIZES: Record<Aspect, { width: number; height: number }> = { '16:9': { width: 1536, height: 864 }, '9:16': { width: 864, height: 1536 }, '1:1': { width: 1280, height: 1280 } };

type AssetLister = { list?: () => Promise<AssetRef[]> };
async function knownAssets(ctx: ToolCtx, film: FilmState): Promise<AssetRef[]> {
  const extra = (await (ctx.assets as unknown as AssetLister).list?.()) ?? [];
  const byId = new Map([...film.assets, ...extra].map((a) => [a.id, a]));
  return [...byId.values()];
}

export function selectSource(film: FilmState, comp: Comp, sceneId: string, assets: AssetRef[] = film.assets): { kind: SourceKind; asset?: AssetRef } {
  const still = assets.find((a) => a.role === 'still' && a.sceneId === sceneId);
  if (still) return { kind: 'still', asset: still };
  const layers = ((comp.precomps as Record<string, { layers: Array<Record<string, any>> }> | undefined)?.[sceneId]?.layers ?? []).filter((l) => l.assetId && !l.hidden);
  const roles = (comp.meta as { director?: { layers?: Record<string, { role: string }> } } | undefined)?.director?.layers ?? {};
  const roleOf = (l: Record<string, any>) => roles[l.id]?.role ?? String(l.id).split(':')[1]?.replace(/-\d+$/, '');
  const bg = layers.find((l) => roleOf(l) === 'bg');
  const hasProduct = layers.some((l) => roleOf(l) === 'product' || roleOf(l) === 'subject');
  if (hasProduct) return { kind: 'flatten' };
  if (bg) return { kind: 'plate', asset: assets.find((a) => a.id === bg.assetId) ?? { id: bg.assetId, url: '', mime: 'image/png' } };
  return { kind: 'product-photo', asset: assets.find((a) => a.id === film.brief.productAssetId) ?? { id: film.brief.productAssetId, url: '', mime: 'image/png' } };
}

export async function prepareSourceStill(
  ctx: ToolCtx,
  sceneId: string,
  aspect: Aspect,
  flatten: (ctx: ToolCtx, comp: Comp, sceneId: string, size: { width: number; height: number }) => Promise<Buffer> = flattenScene,
): Promise<{ asset: AssetRef; kind: string }> {
  const film = await ctx.films.get(ctx.filmId);
  const comp = film.composition as Comp;
  const want = SIZES[aspect];
  const assets = await knownAssets(ctx, film);

  // reuse a stored still that already has exactly the wanted size
  for (const a of assets.filter((x) => x.role === 'still' && x.sceneId === sceneId)) {
    const size = await imageSize(await ctx.assets.read(a.id)).catch(() => undefined);
    if (size && size.width === want.width && size.height === want.height) return { asset: a, kind: 'still' };
  }

  const sel = selectSource(film, comp, sceneId, assets);
  const bytes = sel.kind === 'flatten' ? await flatten(ctx, comp, sceneId, { width: comp.width, height: comp.height }) : await ctx.assets.read(sel.asset!.id);
  const jpeg = await sharp(bytes).resize({ width: want.width, height: want.height, fit: 'cover', position: 'centre' }).jpeg({ quality: 85 }).toBuffer();
  const asset = await ctx.assets.put(jpeg, 'image/jpeg', { role: 'still', sceneId, width: want.width, height: want.height });
  return { asset, kind: sel.kind };
}
