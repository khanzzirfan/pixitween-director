import { expect, it } from 'vitest';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import { collectAudioPlan } from './audioPlan';

const comp = (o: Record<string, unknown>) => ({ version: '1.9.0', id: 'c', width: 1, height: 1, fps: 30, durationInFrames: 900, assets: {}, layers: [], ...o }) as unknown as AepCompositionJson;
const audio = (id: string, o: Record<string, unknown> = {}) => ({ kind: 'audio', id, assetId: 'a1', inPoint: 0, outPoint: 30, transform: {}, ...o });
const assets = { a1: { type: 'audio', src: '/api/assets/a1' } };

it('places a root audio layer', () => {
  const [it1] = collectAudioPlan(comp({ assets, layers: [audio('x', { inPoint: 30, outPoint: 120 })] }));
  expect(it1).toMatchObject({ layerId: 'x', src: '/api/assets/a1', source: 'audio', startSec: 1, endSec: 4, gain: [[0, 1]] });
});
it('offsets by the precomp layer start', () => {
  const c = comp({ layers: [{ kind: 'precomp', id: 'p', compId: 's1', inPoint: 120, outPoint: 300, width: 1, height: 1 }], precomps: { s1: comp({ id: 's1', assets, layers: [audio('x', { inPoint: 15, outPoint: 75 })] }) } });
  expect(collectAudioPlan(c)[0]).toMatchObject({ startSec: 4.5, endSec: 6.5 });
});
it('adds both offsets for nested precomps, using the inner fps', () => {
  const inner = comp({ id: 'in', fps: 24, assets, layers: [audio('x', { inPoint: 24, outPoint: 48 })] });
  const mid = comp({ id: 'mid', fps: 24, layers: [{ kind: 'precomp', id: 'p2', compId: 'in', inPoint: 0, outPoint: 100, width: 1, height: 1 }], precomps: { in: inner } });
  const root = comp({ layers: [{ kind: 'precomp', id: 'p', compId: 'mid', inPoint: 60, outPoint: 300, width: 1, height: 1 }], precomps: { mid } });
  expect(collectAudioPlan(root)[0]!.startSec).toBe(3);
});
it('excludes hidden, muted, missing and empty-src layers, and keeps unmuted video', () => {
  const c = comp({
    assets: { ...assets, e: { type: 'audio', src: '' }, v: { type: 'video', src: '/v.mp4' } },
    layers: [
      audio('hidden', { hidden: true }), audio('missing', { assetId: 'nope' }), audio('empty', { assetId: 'e' }),
      { kind: 'video', id: 'muted', assetId: 'v', inPoint: 0, outPoint: 30, muted: true, transform: {} },
      { kind: 'video', id: 'vid', assetId: 'v', inPoint: 0, outPoint: 30, transform: {} },
    ],
  });
  expect(collectAudioPlan(c).map((i) => [i.layerId, i.source])).toEqual([['vid', 'video']]);
});
it('sorts by start time and reads pan', () => {
  const c = comp({ assets, layers: [audio('late', { inPoint: 60 }), audio('early', { inPoint: 0, pan: 0.5 })] });
  const plan = collectAudioPlan(c);
  expect(plan.map((i) => i.layerId)).toEqual(['early', 'late']);
  expect(plan[0]!.pan).toBe(0.5);
});
