import { describe, expect, it, vi } from 'vitest';
import { exportMp4, mp4Supported } from './mp4Export';

describe('mp4Supported', () => {
  it('is false without VideoEncoder and follows isConfigSupported otherwise', async () => {
    expect(await mp4Supported({ VideoEncoder: undefined })).toBe(false);
    const enc = (supported: boolean) => ({ isConfigSupported: vi.fn(async () => ({ supported })) }) as unknown as typeof VideoEncoder;
    expect(await mp4Supported({ VideoEncoder: enc(true) })).toBe(true);
    expect(await mp4Supported({ VideoEncoder: enc(false) })).toBe(false);
  });
});

function fakeMediabunny() {
  const calls: string[] = [];
  const ctor: Record<string, unknown[]> = {};
  const record = (name: string, args: unknown[]) => (ctor[name] = args);
  const buffer = new ArrayBuffer(1234);
  const times: number[] = [];
  class Output {
    target: { buffer: ArrayBuffer };
    constructor(o: { format: unknown; target: { buffer: ArrayBuffer } }) { record('Output', [o]); this.target = o.target; this.target.buffer = buffer; }
    addVideoTrack() { calls.push('addVideoTrack'); }
    addAudioTrack() { calls.push('addAudioTrack'); }
    async start() { calls.push('output.start'); }
    async finalize() { calls.push('output.finalize'); }
  }
  class Mp4OutputFormat { constructor() { record('Mp4OutputFormat', []); } }
  class BufferTarget { buffer: ArrayBuffer | null = null; constructor() { record('BufferTarget', []); } }
  class CanvasSource { constructor(...a: unknown[]) { record('CanvasSource', a); } async add(t: number) { calls.push('video.add'); times.push(t); } }
  class AudioBufferSource { constructor(...a: unknown[]) { record('AudioBufferSource', a); } async add() { calls.push('audio.add'); } }
  class Quality { constructor(public level: string) {} }
  return { mb: { Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource, Quality } as never, calls, ctor, times };
}

function driver(times: number[]) {
  let i = 0;
  return { play: vi.fn(), pause: vi.fn(), seek: vi.fn(), getTime: vi.fn(() => times[Math.min(i++, times.length - 1)]!) };
}

describe('exportMp4', () => {
  const base = { canvas: {} as HTMLCanvasElement, durationSec: 2, fps: 30 };
  const raf = ((cb: () => void) => void setTimeout(cb, 0)) as unknown as typeof requestAnimationFrame;

  it('builds the output with audio and records in order', async () => {
    const f = fakeMediabunny();
    const blob = await exportMp4({ ...base, driver: driver([0, 0.5, 1, 1.5, 1.97]), audio: {} as AudioBuffer }, { mediabunny: f.mb, raf });
    expect(f.ctor.Mp4OutputFormat).toBeDefined();
    expect(f.ctor.BufferTarget).toBeDefined();
    expect((f.ctor.CanvasSource![1] as { codec: string }).codec).toBe('avc');
    expect((f.ctor.AudioBufferSource![0] as { codec: string }).codec).toBe('aac');
    expect(f.calls[0]).toBe('addVideoTrack');
    expect(f.calls.slice(f.calls.indexOf('output.start'))).toEqual(['output.start', 'video.add', 'video.add', 'video.add', 'video.add', 'video.add', 'audio.add', 'output.finalize']);
    expect(f.times).toEqual([...f.times].sort((a, b) => a - b));
    expect(blob.type).toBe('video/mp4');
    expect(blob.size).toBe(1234);
  });
  it('has no audio source without audio', async () => {
    const f = fakeMediabunny();
    await exportMp4({ ...base, driver: driver([1.99]) }, { mediabunny: f.mb, raf });
    expect(f.ctor.AudioBufferSource).toBeUndefined();
    expect(f.calls).not.toContain('audio.add');
  });
});
