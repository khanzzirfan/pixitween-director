import { describe, expect, it, vi } from 'vitest';
import { makeFakeClippy } from '../clippy/fake';
import { ClippyError, type ClippyClient } from '../clippy/mcp';
import type { StatusResult } from '../clippy/types';
import { POLL_CEILING_MS, pollJob } from './poll';

function clock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
  };
}

describe('pollJob', () => {
  it('follows the delay table and reports each status change once', async () => {
    const c = clock();
    const seen: string[] = [];
    const out = await pollJob(makeFakeClippy({ script: ['queued', 'rendering', 'rendering', 'done'] }), 'job_1', { ...c, onStatus: (s) => seen.push(s.status) });
    expect(out.kind).toBe('done');
    // the delay table is [10, 10, 10, 15, ...], so the fourth read follows a 15 s wait
    expect(c.sleeps).toEqual([10000, 10000, 10000, 15000]);
    expect(seen).toEqual(['queued', 'rendering', 'done']);
  });

  it('times out after the ceiling and cancels exactly once', async () => {
    const c = clock();
    const client = makeFakeClippy({ script: ['rendering'] });
    const out = await pollJob(client, 'job_1', c);
    expect(out).toEqual({ kind: 'timed_out' });
    expect(c.sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(POLL_CEILING_MS);
    expect(c.sleeps.slice(0, 10)).toEqual([10000, 10000, 10000, 15000, 15000, 20000, 20000, 30000, 30000, 30000]);
    expect(client.calls.filter((x) => x.tool === 'cancel_live_animate')).toHaveLength(1);
  });

  const flaky = (failures: number): ClippyClient => {
    const base = makeFakeClippy({ script: ['done'] });
    let n = 0;
    return {
      ...base,
      getLiveAnimateStatus: (id) => (n++ < failures ? Promise.reject(new ClippyError('boom')) : base.getLiveAnimateStatus(id)),
    };
  };

  it('tolerates read failures but gives up after five in a row', async () => {
    expect((await pollJob(flaky(2), 'j', clock())).kind).toBe('done');
    expect(await pollJob(flaky(9), 'j', clock())).toEqual({ kind: 'failed', status: null, message: 'status unavailable' });
  });

  it('fails when done has no result URL and carries the error text on failure', async () => {
    const stub = (s: Partial<StatusResult>): ClippyClient => ({ ...makeFakeClippy(), getLiveAnimateStatus: async () => ({ jobId: 'j', status: 'done', resultUrl: null, ...s }) as StatusResult });
    const noUrl = await pollJob(stub({}), 'j', clock());
    expect(noUrl).toMatchObject({ kind: 'failed', message: 'done without a result URL' });
    const failed = await pollJob(stub({ status: 'failed', error: 'pro_plan_required' }), 'j', clock());
    expect(failed.kind === 'failed' && failed.message).toContain('pro_plan_required');
  });

  it('returns cancelled', async () => {
    const stub: ClippyClient = { ...makeFakeClippy(), getLiveAnimateStatus: vi.fn(async () => ({ jobId: 'j', status: 'cancelled', resultUrl: null }) as StatusResult) };
    expect((await pollJob(stub, 'j', clock())).kind).toBe('cancelled');
  });
});
