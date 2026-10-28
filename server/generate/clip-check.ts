// Owned by S7b. Prepares the finished clip for SAM and measures how much of it shows the product.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCtx } from '@shared/tools';
import { runFfmpeg } from '../media/ffmpeg';

export const MIN_VISIBLE_FRAC = 0.6;
const SAM_USD_PER_1000_FRAMES = 0.2;
const SAM_MIN_FRAMES = 50;

/** No audio, at most 640 px wide, small and seekable: what SAM video tracking takes. */
export async function prepareClipForSam(clip: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'clipsam-'));
  try {
    const input = join(dir, 'in.mp4');
    const output = join(dir, 'out.mp4');
    await writeFile(input, clip);
    await runFfmpeg(['-y', '-i', input, '-an', '-vf', "scale='min(640,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-movflags', '+faststart', output], { timeoutMs: 120000 });
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export type ClipCheckResult = { productVisibleFrac: number; frames: number; framesWithObject: number } | { error: string };

export async function checkClip(ctx: ToolCtx, o: { clip: Buffer; noun: string; sceneId: string }): Promise<ClipCheckResult> {
  try {
    const prepared = await prepareClipForSam(o.clip);
    const r = await ctx.meta.sam.trackVideo(prepared, o.noun);
    if (!r.frames) return { error: 'no frames' };
    const framesWithObject = r.framesWithObject.length;
    ctx.ledger.add(ctx.filmId, 'sam-3.1', `${r.frames} frames`, (Math.max(r.frames, SAM_MIN_FRAMES) * SAM_USD_PER_1000_FRAMES) / 1000);
    return { productVisibleFrac: framesWithObject / r.frames, frames: r.frames, framesWithObject };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
