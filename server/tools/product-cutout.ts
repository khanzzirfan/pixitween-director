// The product's cut-out in this film, if one has been made: a generated asset of the asset store that the film's composition holds.
import type { AssetRef } from '@shared/composition';
import type { ToolCtx } from '@shared/tools';

export async function filmCutout(ctx: ToolCtx): Promise<AssetRef | undefined> {
  const comp = (await ctx.films.get(ctx.filmId)).composition as { assets?: Record<string, unknown> } | undefined;
  const held = new Set(Object.keys(comp?.assets ?? {}));
  return (await ctx.assets.list()).find((a) => a.role === 'cutout' && held.has(a.id));
}
