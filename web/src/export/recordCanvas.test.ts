import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordCanvas, type RecordDeps } from './recordCanvas';
import type { ExportError } from './types';

type Track = { kind: string; stop: ReturnType<typeof vi.fn> };
const track = (kind: string): Track => ({ kind, stop: vi.fn() });

function setup(o: { times?: number[]; audio?: boolean; fireError?: string; onGetTime?: (n: number) => void; clock?: () => number } = {}) {
  const events: string[] = [];
  const times = o.times ?? [0, 0.5, 1, 1.5, 1.94];
  let reads = 0;
  const driver = {
    seek: vi.fn((s: number) => events.push(`seek:${s}`)),
    play: vi.fn(() => events.push('play')),
    pause: vi.fn(),
    getTime: vi.fn(() => {
      o.onGetTime?.(reads);
      return times[Math.min(reads++, times.length - 1)]!;
    }),
  };
  const streams: Array<{ tracks: Track[] }> = [];
  class FakeStream {
    tracks: Track[];
    constructor(tracks: Track[] = []) {
      this.tracks = [...tracks];
      streams.push(this);
    }
    addTrack(t: Track) { this.tracks.push(t); }
    getTracks() { return this.tracks; }
  }
  const recorders: Array<Record<string, any>> = [];
  class FakeRecorder {
    ondataavailable?: (e: { data: Blob }) => void;
    onstart?: () => void;
    onstop?: () => void;
    onerror?: (e: unknown) => void;
    stop = vi.fn(() => queueMicrotask(() => this.onstop?.()));
    constructor(public stream: FakeStream, public options: Record<string, unknown>) {
      recorders.push(this);
    }
    start() {
      events.push('recorder.start');
      this.ondataavailable?.({ data: new Blob(['aaaa']) });
      this.ondataavailable?.({ data: new Blob(['bb']) });
      this.onstart?.();
      if (o.fireError) this.onerror?.({ error: { message: o.fireError } });
    }
  }
  const audioStop = vi.fn();
  class FakeAudioCtx {
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [track('audio')] } }; }
    createBufferSource() { return { buffer: null, connect: vi.fn(), start: () => events.push('audio.start'), stop: audioStop }; }
    close() { return Promise.resolve(); }
  }
  const canvas = { captureStream: vi.fn(() => ({ getVideoTracks: () => [track('video')] })) } as unknown as HTMLCanvasElement;
  const deps: RecordDeps = {
    MediaRecorderCtor: FakeRecorder as never,
    MediaStreamCtor: FakeStream as never,
    AudioContextCtor: FakeAudioCtx as never,
    raf: (cb) => void setTimeout(cb, 0),
    now: o.clock,
  };
  const opts = { canvas, driver, durationSec: 2, fps: 30, mimeType: 'video/webm;codecs=vp9,opus', audio: o.audio ? ({} as AudioBuffer) : null };
  return { events, driver, streams, recorders, deps, opts, audioStop };
}

afterEach(() => vi.restoreAllMocks());

describe('recording', () => {
  it('starts in order, stops after the last reading and returns the blob', async () => {
    const s = setup({ audio: true });
    const progress: number[] = [];
    const blob = await recordCanvas({ ...s.opts, onProgress: (p) => progress.push(p.fraction) }, s.deps);
    expect(s.events).toEqual(['seek:0', 'recorder.start', 'audio.start', 'play']);
    expect(s.driver.getTime).toHaveBeenCalledTimes(5);
    expect(s.driver.pause).toHaveBeenCalledTimes(1);
    expect(s.recorders[0]!.stop).toHaveBeenCalledTimes(1);
    expect(blob.type).toBe('video/webm;codecs=vp9,opus');
    expect(blob.size).toBe(6);
    expect(progress.every((f, i) => i === 0 || f >= progress[i - 1]!)).toBe(true);
    expect(progress.at(-1)!).toBeGreaterThanOrEqual(0.97);
  });
  it('records video only without audio', async () => {
    const s = setup();
    await recordCanvas(s.opts, s.deps);
    expect(s.streams[0]!.tracks.map((t) => t.kind)).toEqual(['video']);
    expect(s.recorders[0]!.options).toEqual({ mimeType: s.opts.mimeType, videoBitsPerSecond: 8_000_000 });
  });
  it('adds the audio track and bitrate with audio', async () => {
    const s = setup({ audio: true });
    await recordCanvas(s.opts, s.deps);
    expect(s.streams[0]!.tracks.map((t) => t.kind)).toEqual(['video', 'audio']);
    expect(s.recorders[0]!.options).toMatchObject({ audioBitsPerSecond: 128_000 });
  });
  it('aborts through the signal', async () => {
    const ctl = new AbortController();
    const s = setup({ times: [0, 0.2, 0.4, 0.6, 0.8, 1], onGetTime: (n) => n === 2 && ctl.abort() });
    const err = (await recordCanvas({ ...s.opts, signal: ctl.signal }, s.deps).catch((e) => e)) as ExportError;
    expect(err.code).toBe('aborted');
    expect(s.driver.pause).toHaveBeenCalledTimes(1);
    expect(s.recorders[0]!.stop).toHaveBeenCalledTimes(1);
  });
});

describe('guards', () => {
  it('rejects when the tab is hidden and removes the listener', async () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const s = setup({ times: [0, 0.2, 0.4, 0.6, 0.8, 1], onGetTime: (n) => {
      if (n === 2) {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      }
    } });
    const err = (await recordCanvas(s.opts, s.deps).catch((e) => e)) as ExportError;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    expect(err.code).toBe('tab-hidden');
    const fn = add.mock.calls.find((c) => c[0] === 'visibilitychange')![1];
    expect(remove).toHaveBeenCalledWith('visibilitychange', fn);
    expect(s.driver.pause).toHaveBeenCalledTimes(1);
    expect(s.recorders[0]!.stop).toHaveBeenCalledTimes(1);
    expect(s.streams[0]!.tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
  });
  it('times out when the driver is stuck', async () => {
    let t = 0;
    const s = setup({ times: [0], clock: () => (t += 1000) });
    const err = (await recordCanvas(s.opts, s.deps).catch((e) => e)) as ExportError;
    expect(err.code).toBe('timeout');
    expect(s.driver.pause).toHaveBeenCalledTimes(1);
    expect(s.recorders[0]!.stop).toHaveBeenCalledTimes(1);
  });
  it('rejects on a recorder error with its message', async () => {
    const s = setup({ fireError: 'boom' });
    const err = (await recordCanvas(s.opts, s.deps).catch((e) => e)) as ExportError;
    expect(err.code).toBe('recorder-error');
    expect(err.message).toContain('boom');
    expect(s.driver.pause.mock.calls.length).toBeLessThanOrEqual(1);
    expect(s.recorders[0]!.stop.mock.calls.length).toBeLessThanOrEqual(1);
    expect(s.streams[0]!.tracks.every((t) => t.stop.mock.calls.length >= 1)).toBe(true);
  });
});
