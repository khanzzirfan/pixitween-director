import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EmitInput, ToolCtx } from '@shared/tools';
import { createApprovalStore } from './approval';
import { offerRetry, shouldOfferRetry } from './retry';

const FILM = 'film_3fa9c2d41b7e';
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'retry-'));
  const approvals = createApprovalStore({ dir: () => dir });
  const events: EmitInput[] = [];
  const ctx = { filmId: FILM, emit: (e: EmitInput) => events.push(e) } as unknown as ToolCtx;
  // a first approval already consumed, so a proposal made now is attempt 2
  approvals.consume(approvals.propose(FILM, 's1', 25).token, FILM, 's1');
  return { approvals, ctx, events };
}

describe('offerRetry', () => {
  it('emits a finding and one proposal at attempt 1', () => {
    const { approvals, ctx, events } = setup();
    offerRetry(ctx, { sceneId: 's1', frac: 0.4, attempt: 1, approvals });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'review.finding', kind: 'product-missing-in-clip', evidence: 'product visible in 40% of frames', deterministic: true });
    expect(events[1]).toMatchObject({ type: 'generate.proposed', sceneId: 's1', estCredits: 25, reason: 'The product was visible in 40% of frames. Retry with a stricter prompt?' });
    const token = (events[1] as { token: string }).token;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(approvals.consume(token, FILM, 's1').attempt).toBe(2);
  });

  it('emits only the finding at attempt 2, and nothing when the product is visible enough', () => {
    const a = setup();
    offerRetry(a.ctx, { sceneId: 's1', frac: 0.4, attempt: 2, approvals: a.approvals });
    expect(a.events.map((e) => e.type)).toEqual(['review.finding']);
    const b = setup();
    offerRetry(b.ctx, { sceneId: 's1', frac: 0.6, attempt: 1, approvals: b.approvals });
    expect(b.events).toEqual([]);
    const c = setup();
    offerRetry(c.ctx, { sceneId: 's1', frac: 0.59, attempt: 2, approvals: c.approvals });
    expect(c.events).toHaveLength(1);
  });

  it('shouldOfferRetry', () => {
    expect(shouldOfferRetry(1, 0.5)).toBe(true);
    expect(shouldOfferRetry(2, 0.5)).toBe(false);
    expect(shouldOfferRetry(1, 0.7)).toBe(false);
  });
});
