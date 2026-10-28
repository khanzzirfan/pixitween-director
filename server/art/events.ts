import type { AssetRef } from '@shared/composition';
import type { ToolCtx } from '@shared/tools';
export function emitAsset(ctx: ToolCtx, asset: AssetRef): void {
  ctx.emit({ type: 'art.asset', filmId: ctx.filmId, at: new Date().toISOString(), asset });
}
export function charge(ctx: ToolCtx, model: string, units: string, usd: number): void {
  ctx.ledger.add(ctx.filmId, model, units, usd);
}
