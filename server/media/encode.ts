// Owned by E1. Numbered frames in a folder -> one web-safe H.264 MP4. The server export route and the tests both go through here.
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { runFfmpeg } from './ffmpeg';

export type FrameExt = 'jpg' | 'png';

export const frameName = (i: number, ext: FrameExt = 'jpg'): string => `f${String(i).padStart(5, '0')}.${ext}`;

export interface EncodeOptions {
  framesDir: string;
  fps: number;
  out: string;
  ext?: FrameExt;
  crf?: number;
}

export function buildEncodeArgs({ framesDir, fps, out, ext = 'jpg', crf = 18 }: EncodeOptions): string[] {
  return [
    '-y', '-framerate', String(fps), '-i', `${framesDir}/f%05d.${ext}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(crf), '-preset', 'veryfast',
    // JPEG frames decode as full range (yuvj420p); convert to the limited range every player expects
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2:in_range=full:out_range=tv,format=yuv420p', '-movflags', '+faststart', out,
  ];
}

export async function encodeFrames(o: EncodeOptions, run: typeof runFfmpeg = runFfmpeg): Promise<void> {
  const first = join(o.framesDir, frameName(0, o.ext ?? 'jpg'));
  try {
    await access(first);
  } catch {
    throw new Error(`no frames in ${o.framesDir}`);
  }
  await run(buildEncodeArgs(o), { timeoutMs: 300000 });
}
