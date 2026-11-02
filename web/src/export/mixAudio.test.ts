import { describe, expect, it, vi } from 'vitest';
import type { AudioPlanItem } from './audioPlan';
import { mixAudio, type MixDeps } from './mixAudio';

class FakeContext {
  calls: Array<[string, ...unknown[]]> = [];
  sources: Array<{ start: number[]; stop: number[] }> = [];
  gains: Array<{ set: Array<[number, number]>; ramp: Array<[number, number]> }> = [];
  destination = {};
  constructor(public channels: number, public length: number, public sampleRate: number) {}
  createBufferSource() {
    const s = { start: [] as number[], stop: [] as number[] };
    this.sources.push(s);
    return { buffer: null, connect() {}, start: (t: number) => s.start.push(t), stop: (t: number) => s.stop.push(t) };
  }
  createGain() {
    const g = { set: [] as Array<[number, number]>, ramp: [] as Array<[number, number]> };
    this.gains.push(g);
    return { connect() {}, gain: { setValueAtTime: (v: number, t: number) => g.set.push([v, t]), linearRampToValueAtTime: (v: number, t: number) => g.ramp.push([v, t]) } };
  }
  createStereoPanner() {
    this.calls.push(['panner']);
    return { connect() {}, pan: { value: 0 } };
  }
  async startRendering() {
    return { rendered: true } as unknown as AudioBuffer;
  }
}

const item = (layerId: string, o: Partial<AudioPlanItem> = {}): AudioPlanItem => ({ layerId, assetId: 'a', src: `/${layerId}.mp3`, source: 'audio', startSec: 0, endSec: 1, gain: [[0, 1]], ...o });
function deps(load: MixDeps['loadBuffer'] = async () => ({}) as AudioBuffer) {
  const made: FakeContext[] = [];
  const d: MixDeps = { createOfflineContext: vi.fn((c: number, l: number, s: number) => (made.push(new FakeContext(c, l, s)), made[0] as unknown as OfflineAudioContext)), loadBuffer: load };
  return { d, made };
}

describe('mixAudio', () => {
  it('schedules every source at its start and end', async () => {
    const { d, made } = deps();
    const r = await mixAudio([item('a', { startSec: 1, endSec: 4 }), item('b', { startSec: 4.5, endSec: 6.5 })], 10, d);
    expect(r.buffer).toEqual({ rendered: true });
    expect(made[0]!.sources).toEqual([{ start: [1], stop: [4] }, { start: [4.5], stop: [6.5] }]);
    expect([made[0]!.channels, made[0]!.sampleRate, made[0]!.length]).toEqual([2, 44100, Math.ceil(10 * 44100)]);
  });
  it('automates the gain relative to the item start', async () => {
    const { d, made } = deps();
    await mixAudio([item('a', { startSec: 4.5, endSec: 8, gain: [[0, 0], [1, 0.8]] })], 10, d);
    expect(made[0]!.gains[0]).toEqual({ set: [[0, 4.5]], ramp: [[0.8, 5.5]] });
  });
  it('skips an item that fails to load and reports it', async () => {
    const { d, made } = deps(async (src) => { if (src === '/bad.mp3') throw new Error('404'); return {} as AudioBuffer; });
    const r = await mixAudio([item('bad'), item('good')], 5, d);
    expect(r.warnings).toEqual([{ layerId: 'bad', reason: '404' }]);
    expect(made[0]!.sources).toHaveLength(1);
    expect(r.buffer).not.toBeNull();
  });
  it('returns null for an empty plan without creating a context, and when everything fails', async () => {
    const empty = deps();
    expect(await mixAudio([], 5, empty.d)).toEqual({ buffer: null, warnings: [] });
    expect(empty.d.createOfflineContext).not.toHaveBeenCalled();
    const failing = deps(async () => { throw new Error('nope'); });
    const r = await mixAudio([item('a'), item('b')], 5, failing.d);
    expect(r.buffer).toBeNull();
    expect(r.warnings).toHaveLength(2);
  });
  it('pans only when asked', async () => {
    const { d, made } = deps();
    await mixAudio([item('a', { pan: -1 }), item('b')], 5, d);
    expect(made[0]!.calls.filter((c) => c[0] === 'panner')).toHaveLength(1);
  });
});
