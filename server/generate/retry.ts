// Owned by S7b. After a failed product check, say so and offer exactly one more try.
import type { ToolCtx } from '@shared/tools';
import type { ApprovalStore } from './approval';
import { MIN_VISIBLE_FRAC } from './clip-check';

const RETRY_CREDITS = 25;
const MAX_ATTEMPTS = 2;

export const shouldOfferRetry = (attempt: number, frac: number): boolean => frac < MIN_VISIBLE_FRAC && attempt < MAX_ATTEMPTS;

export function offerRetry(ctx: ToolCtx, o: { sceneId: string; frac: number; attempt: number; approvals: ApprovalStore }): void {
  if (o.frac >= MIN_VISIBLE_FRAC) return;
  const pct = Math.round(o.frac * 100);
  ctx.emit({ type: 'review.finding', sceneId: o.sceneId, kind: 'product-missing-in-clip', evidence: `product visible in ${pct}% of frames`, deterministic: true });
  if (o.attempt >= MAX_ATTEMPTS) return;
  const { token } = o.approvals.propose(ctx.filmId, o.sceneId, RETRY_CREDITS);
  ctx.emit({ type: 'generate.proposed', sceneId: o.sceneId, reason: `The product was visible in ${pct}% of frames. Retry with a stricter prompt?`, estCredits: RETRY_CREDITS, token });
}
