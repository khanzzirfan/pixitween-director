import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lineup, LineupItem } from '@shared/lineup';
import type { AppDeps } from '../http/deps';
import type { LineupStore } from './store';

const calls: Array<{ filmId: string; limits: unknown; startedAt: number }> = [];
let inFlight = 0;
let maxInFlight = 0;

vi.mock('../crew/run-crew', () => ({
  bindCrew: () => undefined,
  runCrew: async (filmId: string, limits: unknown) => {
    calls.push({ filmId, limits, startedAt: calls.length });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 20));
    inFlight--;
  },
}));
vi.mock('../agent/director', () => ({ bindDirector: () => undefined, runDirector: async () => undefined }));

const { runLineup } = await import('./runner');

const product = (id: string) => ({ id, title: id, price: 1, currency: 'USD', imageUrl: `${id}.jpg`, category: 'c' });

function memoryStore(items: LineupItem[]): LineupStore & { lineup: Lineup } {
  const lineup: Lineup = { id: 'lin_aaaaaaaaaaaa', aspect: '9:16', createdAt: '2026-11-02T00:00:00Z', brief: '', items };
  return {
    lineup,
    get: async () => lineup,
    setItem: async (_id: string, productId: string, patch: Partial<LineupItem>) => {
      const item = lineup.items.find((i) => i.product.id === productId)!;
      Object.assign(item, patch);
      return lineup;
    },
  } as unknown as LineupStore & { lineup: Lineup };
}

const deps = { films: { get: async () => ({ status: 'ready' }) } } as unknown as AppDeps;

describe('runLineup', () => {
  beforeEach(() => vi.stubEnv('CREW_ENABLED', 'true'));
  afterEach(() => {
    calls.length = 0;
    inFlight = maxInFlight = 0;
    vi.unstubAllEnvs();
  });

  it('runs LINEUP_CONCURRENCY films at once, in order, each on the line-up limits', async () => {
    vi.stubEnv('LINEUP_CONCURRENCY', '2');
    vi.stubEnv('LINEUP_FILM_DEADLINE_MS', '300000');
    const store = memoryStore(['a', 'b', 'c'].map((id) => ({ product: product(id), filmId: `film_${id}`, state: 'waiting' as const })));
    await runLineup(deps, 'lin_aaaaaaaaaaaa', store);
    expect(calls.map((c) => c.filmId)).toEqual(['film_a', 'film_b', 'film_c']);
    expect(maxInFlight).toBe(2);
    expect(calls[0]!.limits).toEqual({ deadlineMs: 300000, maxFixes: 1, maxCritiques: 1 });
    expect(store.lineup.items.map((i) => i.state)).toEqual(['done', 'done', 'done']);
  });

  it('skips products with no film or already done', async () => {
    const store = memoryStore([
      { product: product('a'), state: 'failed', error: 'no photo' },
      { product: product('b'), filmId: 'film_b', state: 'done' },
      { product: product('c'), filmId: 'film_c', state: 'waiting' },
    ]);
    await runLineup(deps, 'lin_aaaaaaaaaaaa', store);
    expect(calls.map((c) => c.filmId)).toEqual(['film_c']);
  });
});
