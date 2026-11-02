// Owned by E1. Frame-exact capture: seek to every frame time, wait for the draw, hand the canvas to an encoder. Nothing plays in real time,
// so a slow machine only makes the export slower, never choppier.
import type * as Mediabunny from 'mediabunny';
import type { RecordOptions } from './recordCanvas';
import { ExportError, type ExportDriver } from './types';

/** i / fps for every frame of a film, rounded so the last time is just below the duration. */
export function frameTimes(durationSec: number, fps: number): number[] {
  return Array.from({ length: Math.ceil(durationSec * fps) }, (_, i) => Number((i / fps).toFixed(4)));
}

/** Resolves after two animation frames: the seek has been drawn and the drawing buffer holds it. */
export function settle(raf: typeof requestAnimationFrame = requestAnimationFrame.bind(window)): Promise<void> {
  return new Promise((resolve) => raf(() => raf(() => resolve())));
}

export interface CaptureOptions {
  driver: ExportDriver;
  durationSec: number;
  fps: number;
  signal?: AbortSignal;
  onFrame(i: number, timeSec: number): Promise<void>;
  onProgress?: RecordOptions['onProgress'];
}

/** Seeks to each frame time in turn and calls onFrame once the frame is drawn. Returns the frame count. Never plays. */
export async function captureFrames(o: CaptureOptions, deps: { settle?: () => Promise<void> } = {}): Promise<number> {
  const wait = deps.settle ?? settle;
  const times = frameTimes(o.durationSec, o.fps);
  o.driver.pause();
  for (const [i, t] of times.entries()) {
    if (o.signal?.aborted) throw new ExportError('aborted');
    o.driver.seek(t);
    await wait();
    await o.onFrame(i, t);
    o.onProgress?.({ timeSec: t, fraction: (i + 1) / times.length });
  }
  return times.length;
}

export interface ExactMp4Options {
  canvas: HTMLCanvasElement;
  driver: ExportDriver;
  durationSec: number;
  fps?: number;
  audio?: AudioBuffer | null;
  onProgress?: RecordOptions['onProgress'];
  signal?: AbortSignal;
}

/** Frame-exact H.264 MP4 in the browser (WebCodecs through Mediabunny), with the composition's audio when there is any. */
export async function exportMp4Exact(o: ExactMp4Options, deps: { mediabunny?: typeof Mediabunny; settle?: () => Promise<void> } = {}): Promise<Blob> {
  const mb = deps.mediabunny ?? (await import('mediabunny'));
  const fps = o.fps ?? 30;
  const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });
  const video = new mb.CanvasSource(o.canvas, { codec: 'avc', quality: new mb.Quality('high') } as never);
  output.addVideoTrack(video);
  const audio = o.audio ? new mb.AudioBufferSource({ codec: 'aac', quality: new mb.Quality('high') } as never) : undefined;
  if (audio) output.addAudioTrack(audio);

  await output.start();
  await captureFrames({ ...o, fps, onFrame: (_i, t) => video.add(t, 1 / fps) }, { settle: deps.settle });
  if (audio && o.audio) await audio.add(o.audio);
  await output.finalize();
  const buffer = (output.target as { buffer: ArrayBuffer | null }).buffer ?? new ArrayBuffer(0);
  return new Blob([buffer], { type: 'video/mp4' });
}
