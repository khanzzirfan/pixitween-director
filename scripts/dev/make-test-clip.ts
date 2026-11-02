// Writes web/public/dev/clip-testsrc.mp4 for the clip-alignment check page (/clip-check.html). Skips when it exists.
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFfmpeg } from '../../server/media/ffmpeg';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const TEST_CLIP = join(ROOT, 'web/public/dev/clip-testsrc.mp4');

/** 320x180, 6 s, 30 fps H.264. ffmpeg's testsrc burns a running timestamp into every frame. */
export async function makeTestClip(out = TEST_CLIP): Promise<boolean> {
  if (existsSync(out)) return false;
  mkdirSync(dirname(out), { recursive: true });
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=6', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  makeTestClip().then((made) => console.log(made ? `wrote ${TEST_CLIP}` : `${TEST_CLIP} already exists`));
}
