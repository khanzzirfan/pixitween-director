import { afterEach, expect, it, vi } from 'vitest';
import { loadEnv } from '../../server/env';
import type { FilmEvent } from '../../shared/events';
import { runLive } from './run';
import * as live from './s13-3d';

afterEach(() => vi.unstubAllGlobals());

it('estimates $0.40', () => {
  expect(live.estimateUsd()).toBe(0.4);
  expect(live.describe()).toContain('3D');
});

it('exits non-zero naming PRODUCT_3D before any request when the switch is off', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const lines: string[] = [];
  await expect(live.run({ env: loadEnv({ META_API_KEY: 'k' }), log: (l) => lines.push(l) })).rejects.toThrow(/PRODUCT_3D/);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(lines).toEqual([]);
});

it('names the missing key when the switch is on and there is no key', async () => {
  await expect(live.run({ env: loadEnv({ PRODUCT_3D: 'true' }), log: () => undefined })).rejects.toThrow(/META_API_KEY/);
});

it('prints the estimate and does nothing without --yes', async () => {
  const lines: string[] = [];
  const code = await runLive(['s13-3d'], { log: (l) => lines.push(l) });
  expect(code).toBe(0);
  expect(lines.join('\n')).toContain('estimated cost: $0.4');
  expect(lines.join('\n')).toContain('Dry run');
});

const ev = (e: Record<string, unknown>) => ({ filmId: 'film_0123456789ab', at: '2026-10-30T14:00:00.000Z', ...e }) as FilmEvent;

it('summarises the hero mode, its reason, the cost and whether a 3D layer was built', () => {
  const board = (mode: string) => ({ title: 't', aspect: '16:9', durationSec: 8, palette: ['#111827'], scenes: [{ id: 's1', durationSec: 4, intent: 'i', shotType: 'hero', camera: 'static', layersWanted: ['bg'], mode, modeReason: 'the can turns' }, { id: 's2', durationSec: 4, intent: 'i', shotType: 'closer', camera: 'static', layersWanted: ['bg'], mode: 'motion', modeReason: 'still' }] });
  const events = [ev({ type: 'storyboard.revised', rev: 1, source: 'showrunner', ops: [], storyboard: board('3d') }), ev({ type: 'cost', usd: 0.25, model: 'm', units: 'u' }), ev({ type: 'cost', usd: 0.1, model: 'm', units: 'u', at: '2026-10-30T14:01:00.000Z' })];
  const s = live.summarise('f', events, { precomps: { s1: { layers: [{ kind: 'model3d' }] } } });
  expect(s).toMatchObject({ heroMode: '3d', heroReason: 'the can turns', has3DLayer: true, costUsd: 0.35, wallTimeSec: 60 });
  expect(live.summarise('f', [], null)).toMatchObject({ has3DLayer: false, heroMode: undefined });
});
