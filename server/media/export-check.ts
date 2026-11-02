// Owned by E1. Is a finished MP4 the film it came from? Length, size, frame count and frozen stretches, reported as plain sentences.
import sharp from 'sharp';
import { changedShare, type Gray } from '../authoring/motion-check';
import { extractFrames, probeVideo } from './ffmpeg';

export interface ExportExpect {
  durationSec: number;
  fps: number;
  width: number;
  height: number;
}

type Probe = { durationSec: number; width: number; height: number; frames: number };

export function compareProbe(probe: Probe, expect: ExportExpect, tol = 0.15): string[] {
  const out: string[] = [];
  if (Math.abs(probe.durationSec - expect.durationSec) > tol) out.push(`duration ${probe.durationSec.toFixed(2)} s, expected ${expect.durationSec.toFixed(2)} s`);
  if (Math.abs(probe.width - expect.width) > 1 || Math.abs(probe.height - expect.height) > 1) out.push(`size ${probe.width}x${probe.height}, expected ${expect.width}x${expect.height}`);
  const frames = Math.round(expect.durationSec * expect.fps);
  if (Math.abs(probe.frames - frames) > 2) out.push(`frames ${probe.frames}, expected ${frames}`);
  return out;
}

export function frozenPairs(grays: Gray[], times: number[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < grays.length; i++) {
    if (changedShare(grays[i - 1]!, grays[i]!) === 0) out.push(`frozen: frames at ${times[i - 1]!.toFixed(2)} s and ${times[i]!.toFixed(2)} s are identical`);
  }
  return out;
}

async function toGray(png: Buffer): Promise<Gray> {
  const { data, info } = await sharp(png).resize(54, 96, { fit: 'fill' }).grayscale().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

export async function checkExport(
  video: Buffer,
  expect: ExportExpect,
  deps: { probeVideo: typeof probeVideo; extractFrames: typeof extractFrames } = { probeVideo, extractFrames },
): Promise<string[]> {
  try {
    const problems = compareProbe(await deps.probeVideo(video), expect);
    const times = Array.from({ length: 9 }, (_, i) => Number(((expect.durationSec * i) / 9).toFixed(2)));
    const frames = await deps.extractFrames(video, times);
    return [...problems, ...frozenPairs(await Promise.all(frames.map(toGray)), times)];
  } catch (e) {
    return [`check failed: ${e instanceof Error ? e.message : String(e)}`];
  }
}
