import { describe, expect, it, vi } from 'vitest';
import { createFilmQueue } from './film-queue';

function setup(o: { maxInFlight?: number; maxQueued?: number } = {}) {
  let t = 1_000_000;
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const log = vi.fn();
  const q = createFilmQueue({
    maxInFlight: o.maxInFlight ?? 2, maxQueued: o.maxQueued ?? 2, startsPerWindow: 3, windowMs: 300_000,
    now: () => t, log,
    setTimer: (fn, ms) => {
      const h = { fn, ms, cleared: false };
      timers.push(h);
      return h;
    },
    clearTimer: (h) => void ((h as { cleared: boolean }).cleared = true),
  });
  const runs = new Map<string, { started: boolean; finish(): void; fail(): void }>();
  const job = (id: string) => {
    let finish!: () => void;
    let fail!: () => void;
    const p = new Promise<void>((res, rej) => {
      finish = res;
      fail = () => rej(new Error('boom'));
    });
    const entry = { started: false, finish, fail };
    runs.set(id, entry);
    return () => {
      entry.started = true;
      return p;
    };
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { q, job, runs, log, timers, advance: (ms: number) => void (t += ms), settle };
}

describe('film queue', () => {
  it('runs two, queues two with their positions and estimates, and rejects the fifth', async () => {
    const s = setup();
    expect(s.q.submit('a', s.job('a'))).toEqual({ state: 'running' });
    expect(s.q.submit('b', s.job('b'))).toEqual({ state: 'running' });
    expect(s.q.submit('c', s.job('c'))).toEqual({ state: 'queued', position: 1, etaSec: 100 });
    expect(s.q.submit('d', s.job('d'))).toEqual({ state: 'queued', position: 2, etaSec: 200 });
    expect(s.q.submit('e', s.job('e'))).toEqual({ state: 'rejected', retryAfterSec: 100 });
    expect(s.q.canAccept()).toEqual({ ok: false, retryAfterSec: 100 });
    expect(s.q.stats()).toMatchObject({ inFlight: 2, queued: 2, maxInFlight: 2, maxQueued: 2, startsInWindow: 2, startsPerWindow: 3, windowSec: 300 });
    expect(s.q.position('c')).toEqual({ state: 'queued', position: 1, etaSec: 100 });
    expect(s.q.position('zzz')).toEqual({ state: 'unknown' });
  });

  it('starts waiting films in order, and holds the fourth start until the window frees', async () => {
    const s = setup();
    for (const id of ['a', 'b', 'c', 'd']) s.q.submit(id, s.job(id));
    await s.settle();
    s.runs.get('a')!.finish();
    await s.settle();
    expect(s.runs.get('c')!.started).toBe(true); // the third start in the window
    expect(s.q.position('d')).toEqual({ state: 'queued', position: 1, etaSec: 100 });

    s.runs.get('b')!.finish();
    await s.settle();
    expect(s.runs.get('d')!.started).toBe(false); // a fourth start in 300 s is not allowed
    const pending = s.timers.filter((t) => !t.cleared);
    expect(pending).toHaveLength(1);

    s.advance(300_001);
    pending[0]!.fn();
    await s.settle();
    expect(s.runs.get('d')!.started).toBe(true);
  });

  it('frees the slot of a run that rejects, and never throws', async () => {
    const s = setup({ maxInFlight: 1, maxQueued: 1 });
    expect(() => s.q.submit('a', s.job('a'))).not.toThrow();
    s.q.submit('b', s.job('b'));
    await s.settle();
    s.runs.get('a')!.fail();
    await s.settle();
    expect(s.runs.get('b')!.started).toBe(true);
    expect(s.log.mock.calls.some((c) => String(c[0]).includes('run failed: boom'))).toBe(true);
  });

  it('returns the current state for a film it already knows', async () => {
    const s = setup({ maxInFlight: 1 });
    s.q.submit('a', s.job('a'));
    s.q.submit('b', s.job('b'));
    expect(s.q.submit('a', s.job('a2'))).toEqual({ state: 'running' });
    expect(s.q.submit('b', s.job('b2'))).toEqual({ state: 'queued', position: 1, etaSec: 100 });
    await s.settle();
    expect(s.runs.get('a2')!.started).toBe(false);
  });

  it('canAccept is false exactly when submit would reject', () => {
    const s = setup({ maxInFlight: 1, maxQueued: 1 });
    expect(s.q.canAccept().ok).toBe(true);
    s.q.submit('a', s.job('a'));
    expect(s.q.canAccept().ok).toBe(true);
    s.q.submit('b', s.job('b'));
    expect(s.q.canAccept().ok).toBe(false);
    expect(s.q.submit('c', s.job('c')).state).toBe('rejected');
  });

  it('logs transitions with film ids only, and dispose clears the timer', async () => {
    const s = setup({ maxInFlight: 4, maxQueued: 2 });
    for (const id of ['a', 'b', 'c', 'd']) s.q.submit(id, s.job(id)); // the fourth start is over budget: queued with a timer
    await s.settle();
    expect(s.log.mock.calls[0]![0]).toMatch(/^\[queue\] film=a state=running inFlight=1\/4 queued=0\/2 starts=1\/3$/);
    const timer = s.timers.find((t) => !t.cleared);
    expect(timer).toBeDefined();
    s.q.dispose();
    expect(timer!.cleared).toBe(true);
  });
});
