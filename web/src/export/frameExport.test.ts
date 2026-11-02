import { describe, expect, it, vi } from 'vitest';
import { captureFrames, exportMp4Exact, frameTimes } from './frameExport';
import { ExportError } from './types';

const fakeDriver = () => {
  const calls: string[] = [];
  return { calls, play: vi.fn(() => calls.push('play')), pause: vi.fn(() => calls.push('pause')), seek: vi.fn((t: number) => calls.push(`seek ${t}`)), getTime: vi.fn(() => 0) };
};

describe('frameTimes', () => {
  it('gives 240 times for 8 s at 30 fps, the last just below 8', () => {
    const t = frameTimes(8, 30);
    expect(t).toHaveLength(240);
    expect(t[0]).toBe(0);
    expect(t.at(-1)).toBe(7.9667);
    expect(frameTimes(1, 24)).toHaveLength(24);
  });
});

describe('captureFrames', () => {
  it('seeks 24 times in order, settles before each frame and never plays', async () => {
    const d = fakeDriver();
    const log: string[] = [];
    const n = await captureFrames(
      { driver: d, durationSec: 1, fps: 24, onFrame: async (i) => void log.push(`frame ${i}`) },
      { settle: async () => void log.push('settle') },
    );
    expect(n).toBe(24);
    expect(d.seek).toHaveBeenCalledTimes(24);
    expect(d.play).not.toHaveBeenCalled();
    expect(log.slice(0, 4)).toEqual(['settle', 'frame 0', 'settle', 'frame 1']);
    const times = d.seek.mock.calls.map((c) => c[0]);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('stops with an aborted error when the signal fires', async () => {
    const ctl = new AbortController();
    const onFrame = vi.fn(async (i: number) => void (i === 5 && ctl.abort()));
    await expect(captureFrames({ driver: fakeDriver(), durationSec: 1, fps: 24, signal: ctl.signal, onFrame }, { settle: async () => undefined })).rejects.toMatchObject({ code: 'aborted' });
    expect(onFrame.mock.calls.length).toBeLessThanOrEqual(6);
    expect(new ExportError('aborted').code).toBe('aborted');
  });
});

function fakeMediabunny() {
  const added: Array<[number, number]> = [];
  const ctor: Record<string, unknown[]> = {};
  class Output { target = { buffer: new ArrayBuffer(99) }; constructor(o: { target: { buffer: ArrayBuffer } }) { ctor.Output = [o]; this.target = o.target; this.target.buffer = new ArrayBuffer(99); } addVideoTrack() {} addAudioTrack() {} async start() {} async finalize() {} }
  class Mp4OutputFormat {}
  class BufferTarget { buffer: ArrayBuffer | null = null; }
  class CanvasSource { constructor(...a: unknown[]) { ctor.CanvasSource = a; } async add(t: number, d: number) { added.push([t, d]); } }
  class AudioBufferSource { constructor(...a: unknown[]) { ctor.AudioBufferSource = a; } async add() {} }
  class Quality { constructor(public level: string) {} }
  return { mb: { Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource, Quality } as never, added, ctor };
}

describe('exportMp4Exact', () => {
  const base = { canvas: {} as HTMLCanvasElement, durationSec: 8, fps: 30 };
  it('adds 240 frames at i/30 with duration 1/30 and returns a video/mp4 blob', async () => {
    const f = fakeMediabunny();
    const blob = await exportMp4Exact({ ...base, driver: fakeDriver() }, { mediabunny: f.mb, settle: async () => undefined });
    expect(f.added).toHaveLength(240);
    expect(f.added[1]).toEqual([0.0333, 1 / 30]);
    expect(f.ctor.AudioBufferSource).toBeUndefined();
    expect((f.ctor.CanvasSource![1] as { codec: string }).codec).toBe('avc');
    expect(blob.type).toBe('video/mp4');
    expect(blob.size).toBe(99);
  });
  it('adds the audio source only when audio is passed', async () => {
    const f = fakeMediabunny();
    await exportMp4Exact({ ...base, durationSec: 1, driver: fakeDriver(), audio: {} as AudioBuffer }, { mediabunny: f.mb, settle: async () => undefined });
    expect((f.ctor.AudioBufferSource![0] as { codec: string }).codec).toBe('aac');
  });
});
