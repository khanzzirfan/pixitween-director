import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ffmpegPath = () => process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobePath = () => process.env.FFPROBE_PATH || 'ffprobe';

export class FfmpegMissingError extends Error {
  constructor(bin = 'ffmpeg') {
    super(`${bin} is not installed or not on PATH`);
    this.name = 'FfmpegMissingError';
  }
}

function run(bin: string, args: string[], o: { input?: Buffer; timeoutMs?: number } = {}): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${bin} timed out after ${o.timeoutMs ?? 60000} ms`));
    }, o.timeoutMs ?? 60000);
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject((e as NodeJS.ErrnoException).code === 'ENOENT' ? new FfmpegMissingError(bin) : e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err });
      else reject(new Error(`${bin} exited with ${code}: ${err.slice(-500)}`));
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input);
  });
}

const cache = new Map<string, Promise<boolean>>();
export function hasFfmpeg(): Promise<boolean> {
  const bin = ffmpegPath();
  let p = cache.get(bin);
  if (!p) {
    p = run(bin, ['-version'], { timeoutMs: 10000 }).then(
      () => true,
      () => false,
    );
    cache.set(bin, p);
  }
  return p;
}

export async function runFfmpeg(args: string[], o?: { input?: Buffer; timeoutMs?: number }) {
  if (!(await hasFfmpeg())) throw new FfmpegMissingError();
  return run(ffmpegPath(), args, o);
}

async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'ffmpeg-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Any audio/video -> 16 kHz mono PCM WAV (file output, so the header sizes are correct). */
export async function toWav16kMono(input: Buffer): Promise<Buffer> {
  if (!(await hasFfmpeg())) throw new FfmpegMissingError();
  return withTemp(async (dir) => {
    await writeFile(join(dir, 'in'), input);
    await runFfmpeg(['-y', '-i', join(dir, 'in'), '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', join(dir, 'out.wav')]);
    return readFile(join(dir, 'out.wav'));
  });
}

export async function extractFrames(video: Buffer, timesSec: number[], o: { width?: number } = {}): Promise<Buffer[]> {
  if (!(await hasFfmpeg())) throw new FfmpegMissingError();
  return withTemp(async (dir) => {
    await writeFile(join(dir, 'in'), video);
    const frames: Buffer[] = [];
    for (const [i, t] of timesSec.entries()) {
      const out = join(dir, `f${i}.png`);
      const vf = o.width ? ['-vf', `scale=${o.width}:-2`] : [];
      await runFfmpeg(['-y', '-ss', String(t), '-i', join(dir, 'in'), '-frames:v', '1', ...vf, out]);
      frames.push(await readFile(out));
    }
    return frames;
  });
}

export async function probeVideo(video: Buffer): Promise<{ durationSec: number; width: number; height: number; fps: number; frames: number }> {
  if (!(await hasFfmpeg())) throw new FfmpegMissingError();
  return withTemp(async (dir) => {
    const file = join(dir, 'in');
    await writeFile(file, video);
    const { stdout } = await run(ffprobePath(), [
      '-v', 'error', '-count_frames', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames:format=duration',
      '-of', 'json', file,
    ]);
    const j = JSON.parse(stdout.toString()) as {
      streams: Array<{ width: number; height: number; r_frame_rate: string; nb_read_frames: string }>;
      format: { duration: string };
    };
    const s = j.streams[0]!;
    const [n, d] = s.r_frame_rate.split('/').map(Number);
    return { durationSec: Number(j.format.duration), width: s.width, height: s.height, fps: n! / (d || 1), frames: Number(s.nb_read_frames) };
  });
}
