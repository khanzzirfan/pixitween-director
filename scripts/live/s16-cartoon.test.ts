import { afterEach, expect, it, vi } from 'vitest';
import { loadEnv } from '../../server/env';
import type { FilmEvent } from '../../shared/events';
import { runLive } from './run';
import * as live from './s16-cartoon';

afterEach(() => vi.unstubAllGlobals());

it('estimates $1 and says what it costs', () => {
  expect(live.estimateUsd()).toBe(1);
  expect(live.describe()).toContain('Estimate:');
  expect(live.describe()).toContain('GPU');
});

it('names CARTOON_MODE before any request when the switch is off', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await expect(live.run({ env: loadEnv({ META_API_KEY: 'k' }), log: () => undefined })).rejects.toThrow(/CARTOON_MODE/);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('names the missing key when the switch is on and there is no key', async () => {
  await expect(live.run({ env: loadEnv({ CARTOON_MODE: 'true' }), log: () => undefined })).rejects.toThrow(/META_API_KEY/);
});

it('prints the estimate and makes no network call without --yes', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const lines: string[] = [];
  expect(await runLive(['s16-cartoon'], { log: (l) => lines.push(l) })).toBe(0);
  expect(lines.join('\n')).toContain('Estimate:');
  expect(lines.join('\n')).toContain('estimated cost: $1');
  expect(lines.join('\n')).toContain('Dry run');
  expect(fetchMock).not.toHaveBeenCalled();
});

const ev = (e: Record<string, unknown>) => ({ filmId: 'film_0123456789ab', at: '2026-10-30T14:00:00.000Z', ...e }) as FilmEvent;
const job = (id: string, kind: string, status = 'done') => ev({ type: 'job.update', job: { id, kind, status, filmId: 'f', brief: '', reason: '', origin: 'showrunner', createdAt: '', costUsd: 0 } });

it('summarises blocked shots, cast, findings, fixes, the two costs and the stage layers', () => {
  const events = [
    ev({ type: 'storyboard.revised', rev: 1, source: 'showrunner', ops: [], storyboard: { title: 't', aspect: '16:9', durationSec: 8, palette: ['#111827'], scenes: [{ id: 's1' }, { id: 's2' }] } }),
    job('j1', 'block-shot'), job('j2', 'block-shot'), job('j3', 'block-shot', 'failed'), job('j4', 'fix'),
    ev({ type: 'review.finding', sceneId: 's1', kind: 'actor-off-frame', evidence: 'e', deterministic: true }),
    ev({ type: 'cost', usd: 0.25, model: 'muse-wonder-1.0', units: 'u' }),
    ev({ type: 'cost', usd: 0.5, model: 'forge-gpu', units: 'u', at: '2026-10-30T14:01:00.000Z' }),
  ];
  const s = live.summarise('f', events, { precomps: { s1: { layers: [{ kind: 'stage3d' }] }, s2: { layers: [{ kind: 'stage3d' }] } } }, [{ status: 'ready' }, { status: 'queued' }]);
  expect(s).toMatchObject({ scenes: ['s1', 's2'], blocked: 2, cast: 2, castReady: 1, findings: 1, fixes: 1, modelCostUsd: 0.25, gpuCostUsd: 0.5, wallTimeSec: 60, stageLayers: 2 });
});
