import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getGlimmerStatus, getLocalMode, resetLocalModeForTests, setLocalMode } from './local-mode';

const MODEL = 'muse-glimmer:30b-mlx';
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fakeFetch = (tags: unknown, ps: unknown | Error) =>
  vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.endsWith('/api/tags')) return json(tags);
    if (ps instanceof Error) throw ps;
    return json(ps);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const base = { baseUrl: 'http://localhost:11434', model: MODEL };

beforeEach(() => resetLocalModeForTests());

describe('getGlimmerStatus', () => {
  it('reports reachable and model presence', async () => {
    const present = await getGlimmerStatus({ ...base, fetchImpl: fakeFetch({ models: [{ name: MODEL }] }, { models: [] }), forceRefresh: true });
    expect(present).toMatchObject({ reachable: true, modelPresent: true, host: 'localhost:11434' });
    const other = await getGlimmerStatus({ ...base, fetchImpl: fakeFetch({ models: [{ name: 'other' }] }, { models: [] }), forceRefresh: true });
    expect(other.modelPresent).toBe(false);
  });

  it('reports loaded, not loaded, and unknown', async () => {
    const run = (ps: unknown | Error) => getGlimmerStatus({ ...base, fetchImpl: fakeFetch({ models: [{ name: MODEL }] }, ps), forceRefresh: true });
    expect((await run({ models: [{ name: MODEL }] })).loaded).toBe(true);
    expect((await run({ models: [] })).loaded).toBe(false);
    expect((await run(new Error('ps down'))).loaded).toBeNull();
  });

  it('caches for 60 s and honours forceRefresh', async () => {
    let t = 1_000_000;
    const f = fakeFetch({ models: [{ name: MODEL }] }, { models: [] });
    const opts = { ...base, fetchImpl: f, now: () => t };
    await getGlimmerStatus(opts);
    t += 30_000;
    await getGlimmerStatus(opts);
    expect(f).toHaveBeenCalledTimes(2); // tags and ps, once
    t += 31_000;
    await getGlimmerStatus(opts);
    expect(f).toHaveBeenCalledTimes(4);
    await getGlimmerStatus({ ...opts, forceRefresh: true });
    expect(f).toHaveBeenCalledTimes(6);
  });

  it('answers unreachable instead of throwing', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const s = await getGlimmerStatus({ ...base, fetchImpl: f, forceRefresh: true });
    expect(s).toMatchObject({ reachable: false, modelPresent: false, loaded: null });
    expect(s.error).toBeTruthy();
  });
});

describe('local mode flag', () => {
  it('starts from the env and follows setLocalMode', () => {
    resetLocalModeForTests(false);
    expect(getLocalMode({ LOCAL_MODE: false })).toBe(false);
    setLocalMode(true);
    expect(getLocalMode({ LOCAL_MODE: false })).toBe(true);
  });
});
