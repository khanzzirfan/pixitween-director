import { expect, it } from 'vitest';
import { makeFakeClippy } from './fake';
import { ClippyError } from './mcp';

const args = { model: 'fast-h3', prompt: 'x', sourceImageUrl: 'https://a.example/i.jpg', durationSec: 5.2, aspect: '16:9', idempotencyKey: 'film1:s2:1' } as const;

it('is idempotent per key and rejects a reused key with different args', async () => {
  const c = makeFakeClippy();
  const a = await c.animateImage(args);
  const b = await c.animateImage(args);
  expect(a.jobId).toBe(b.jobId);
  expect(c.calls.filter((x) => x.tool === 'animate_image')).toHaveLength(2);
  await expect(c.animateImage({ ...args, prompt: 'different' })).rejects.toThrow('idempotency_key_reused');
});
it('walks the default status script', async () => {
  const c = makeFakeClippy();
  const { jobId } = await c.animateImage(args);
  const reads = [await c.getLiveAnimateStatus(jobId), await c.getLiveAnimateStatus(jobId), await c.getLiveAnimateStatus(jobId), await c.getLiveAnimateStatus(jobId)];
  expect(reads.map((r) => r.status)).toEqual(['queued', 'rendering', 'rendering', 'done']);
  expect(reads.map((r) => r.resultUrl !== null)).toEqual([false, false, false, true]);
});
it('cancels, fails on request, and reports the balance', async () => {
  const c = makeFakeClippy({ balance: 9 });
  const { jobId } = await c.animateImage(args);
  await c.cancelLiveAnimate(jobId);
  expect((await c.getLiveAnimateStatus(jobId)).status).toBe('cancelled');
  expect((await c.getCreditBalance()).currentBalance).toBe(9);
  const err = new ClippyError('pro_plan_required', { tool: 'animate_image', isToolError: true });
  await expect(makeFakeClippy({ failSubmit: err }).animateImage(args)).rejects.toBe(err);
});
