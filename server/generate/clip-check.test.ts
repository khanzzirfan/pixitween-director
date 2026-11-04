import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@shared/tools';
import { hasFfmpeg, probeVideo, runFfmpeg } from '../media/ffmpeg';
import { makeFakeMeta } from '../meta/fakes';
import { checkClip, prepareClipForSam } from './clip-check';

const has = await hasFfmpeg();

function ctxWith(sam: { frames: number; framesWithObject: number[] } | Error) {
  const meta = makeFakeMeta();
  meta.sam.trackVideo = async () => {
    if (sam instanceof Error) throw sam;
    return { ...sam, objectIds: ['0'] };
  };
  const add = vi.fn();
  return { ctx: { filmId: 'film_3fa9c2d41b7e', meta, ledger: { add } } as unknown as ToolCtx, add };
}

async function testClip(): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'clipcheck-'));
  const out = join(dir, 'c.mp4');
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=1', '-f', 'lavfi', '-i', 'sine=duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out]);
  return (await import('node:fs/promises')).readFile(out);
}

describe('checkClip', () => {
  it('computes the visible fraction and charges SAM by frame with a 50-frame floor', async () => {
    // preparation needs ffmpeg, so these cases run only when it is installed
    if (!has) return;
    const clip = await testClip();
    const a = ctxWith({ frames: 240, framesWithObject: Array.from({ length: 216 }, (_, i) => i) });
    expect(await checkClip(a.ctx, { clip, noun: 'mug', sceneId: 's1' })).toEqual({ productVisibleFrac: 0.9, frames: 240, framesWithObject: 216 });
    expect(a.add).toHaveBeenCalledWith('film_3fa9c2d41b7e', 'sam-3.1', '240 frames', expect.closeTo(0.048, 6));
    const b = ctxWith({ frames: 30, framesWithObject: [0] });
    await checkClip(b.ctx, { clip, noun: 'mug', sceneId: 's1' });
    expect(b.add).toHaveBeenCalledWith('film_3fa9c2d41b7e', 'sam-3.1', '30 frames', expect.closeTo(0.01, 6));
  });

  it('returns an error instead of throwing', async () => {
    if (!has) return;
    const clip = await testClip();
    expect(await checkClip(ctxWith(new Error('sam down')).ctx, { clip, noun: 'mug', sceneId: 's1' })).toEqual({ error: 'sam down' });
    expect(await checkClip(ctxWith({ frames: 0, framesWithObject: [] }).ctx, { clip, noun: 'mug', sceneId: 's1' })).toEqual({ error: 'no frames' });
  });

  it('returns an error for bytes that are not a video', async () => {
    if (!has) return;
    const r = await checkClip(ctxWith({ frames: 10, framesWithObject: [] }).ctx, { clip: Buffer.from('not a video'), noun: 'mug', sceneId: 's1' });
    expect(r).toHaveProperty('error');
  });
});

describe.skipIf(!has)('prepareClipForSam', () => {
  it('scales to 640 px wide and drops audio', async () => {
    const out = await prepareClipForSam(await testClip());
    expect((await probeVideo(out)).width).toBe(640);
    const dir = mkdtempSync(join(tmpdir(), 'clipcheck-'));
    const f = join(dir, 'o.mp4');
    await (await import('node:fs/promises')).writeFile(f, out);
    const { stderr } = await runFfmpeg(['-i', f, '-f', 'null', '-']);
    expect(stderr).not.toMatch(/Audio:/);
  });
});
