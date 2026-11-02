import { describe, expect, it, vi } from 'vitest';
import { checkExport, compareProbe, frozenPairs, type ExportExpect } from './export-check';
import { hasFfmpeg, runFfmpeg } from './ffmpeg';

const want: ExportExpect = { durationSec: 8, fps: 30, width: 1080, height: 1920 };
const probe = { durationSec: 8, width: 1080, height: 1920, frames: 240 };
const gray = (v: number) => ({ width: 2, height: 2, data: new Uint8Array(4).fill(v) });

describe('compareProbe', () => {
  it('reports a short film in the exact words', () => {
    expect(compareProbe({ ...probe, durationSec: 6, frames: 180 }, want)).toEqual(['duration 6.00 s, expected 8.00 s', 'frames 180, expected 240']);
  });
  it('accepts a probe within the tolerances', () => {
    expect(compareProbe({ durationSec: 8.1, width: 1079, height: 1920, frames: 242 }, want)).toEqual([]);
  });
  it('reports a wrong size', () => {
    expect(compareProbe({ ...probe, width: 540 }, want)).toEqual(['size 540x1920, expected 1080x1920']);
  });
});

describe('frozenPairs', () => {
  it('names the two times of an identical pair', () => {
    const out = frozenPairs([gray(0), gray(200), gray(200), gray(0)], [0, 1, 2, 3]);
    expect(out).toEqual(['frozen: frames at 1.00 s and 2.00 s are identical']);
  });
});

describe('checkExport', () => {
  it('turns an ffmpeg failure into one problem', async () => {
    const out = await checkExport(Buffer.alloc(0), want, { probeVideo: vi.fn().mockRejectedValue(new Error('boom')), extractFrames: vi.fn() });
    expect(out).toEqual(['check failed: boom']);
  });
});

describe.skipIf(!(await hasFfmpeg()))('with ffmpeg', () => {
  it('checks a moving testsrc clip clean and a still clip as frozen', async () => {
    const moving = (await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=108x192:rate=30', '-t', '2', '-pix_fmt', 'yuv420p', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov', '-'])).stdout;
    const ok = { durationSec: 2, fps: 30, width: 108, height: 192 };
    expect(await checkExport(moving, ok)).toEqual([]);
    const still = (await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=red:size=108x192:rate=30', '-t', '2', '-pix_fmt', 'yuv420p', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov', '-'])).stdout;
    expect((await checkExport(still, ok)).some((p) => p.startsWith('frozen:'))).toBe(true);
  });
});
