import type { FilmState, AssetRef } from '@shared/composition';
import type { Storyboard } from '@shared/storyboard';
import type { ToolCtx } from '@shared/tools';
import { addScene, newFilmComposition, registerAsset } from '../authoring/api';

export async function initFilmComposition(o: {
  ctx: ToolCtx;
  film: FilmState;
  storyboard: Storyboard;
}): Promise<{ version: number; product: AssetRef }> {
  const product = o.film.assets.find((asset) => asset.id === o.film.brief.productAssetId);
  if (!product) throw new Error('product asset missing');
  let comp = newFilmComposition({ aspect: o.film.aspect, title: o.storyboard.title, palette: o.storyboard.palette });
  comp = registerAsset(comp, { id: product.id, kind: 'image', src: product.url, width: product.width, height: product.height });
  for (const scene of o.storyboard.scenes)
    comp = addScene(comp, { id: scene.id, durationSec: scene.durationSec, mode: scene.mode, intent: scene.intent });
  const result = await o.ctx.films.commit(o.ctx.filmId, comp, 'director', 'storyboard skeleton');
  if (!result.ok) {
    const issues = result.issues as Array<{ message?: string }>;
    throw new Error(`invalid composition: ${issues[0]?.message ?? 'unknown issue'}`);
  }
  return { version: result.version, product };
}
