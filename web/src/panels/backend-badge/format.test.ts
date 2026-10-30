import { describe, expect, it } from 'vitest';
import type { FilmEvent } from '@shared/events';
import { formatBadge } from './format';

const base = { filmId: 'film_3fa9c2d41b7e', at: '2026-10-29T00:00:00Z', seq: 1 };
const turn = (backend: 'spark' | 'glimmer' | 'spark-open', ms: number) => ({ ...base, type: 'agent.turn', backend, ms, calls: 1 }) as unknown as FilmEvent;

describe('formatBadge', () => {
  it('names the model and rounds the seconds', () => {
    expect(formatBadge([turn('glimmer', 24300)])?.text).toBe('edited by Muse Glimmer (local) · 24 s');
    expect(formatBadge([turn('glimmer', 24500)])?.text).toBe('edited by Muse Glimmer (local) · 25 s');
    expect(formatBadge([turn('spark', 14000)])?.text).toBe('edited by Muse Spark · 14 s');
    expect(formatBadge([turn('spark-open', 3000)])?.text).toBe('edited by Muse Spark Open · 3 s');
  });

  it('says so when the Meta API was skipped', () => {
    const fallback = { ...base, type: 'error', where: 'llm.fallback', status: 402, message: 'spark -> glimmer: Meta API 402' } as unknown as FilmEvent;
    const info = formatBadge([turn('spark', 1000), fallback, turn('glimmer', 31000)]);
    expect(info?.text).toBe('Meta API unavailable (402): used Muse Glimmer (local) · 31 s');
    expect(info?.fallbackFrom).toEqual({ status: 402 });
  });

  it('ignores a fallback that belongs to an earlier turn, and finds the status in the message', () => {
    const old = { ...base, type: 'error', where: 'llm.fallback', message: 'x' } as unknown as FilmEvent;
    expect(formatBadge([old, turn('glimmer', 1000), turn('spark', 2000)])?.text).toBe('edited by Muse Spark · 2 s');
    const noStatus = { ...base, type: 'error', where: 'llm.fallback', message: 'spark -> glimmer: Meta API 503' } as unknown as FilmEvent;
    expect(formatBadge([noStatus, turn('glimmer', 5000)])?.text).toContain('(503)');
  });

  it('returns null without an agent turn', () => {
    expect(formatBadge([])).toBeNull();
  });
});

it('never prints "undefined" for an unknown backend', async () => {
  const { formatBadge } = await import('./format');
  const b = formatBadge([{ type: 'agent.turn', backend: 'brand-new', ms: 2000 } as never]);
  expect(b?.text).toBe('edited by the director · 2 s');
});
