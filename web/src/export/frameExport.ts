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
  /**
   * Motion blur: the player's canvas and a 2D canvas of the same size. A frame inside a blurred shot (the driver's `blurAt`) is drawn several times
   * across the shutter's open time and the pictures are averaged into `out`; every other frame is copied to `out` as it is. `onFrame` then reads `out`.
   */
  canvas?: HTMLCanvasElement;
  out?: HTMLCanvasElement;
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
    const blur = o.canvas && o.out ? o.driver.blurAt?.(t) : null;
    const ctx = o.canvas && o.out ? o.out.getContext('2d') : null;
    if (o.canvas && o.out && ctx && blur) {
      // the shutter is open for `shutter` of the frame's time, centred on the frame: an even spread of pictures, each averaged in with a weight of 1 / (k + 1)
      ctx.clearRect(0, 0, o.out.width, o.out.height);
      for (let k = 0; k < blur.samples; k++) {
        o.driver.seek(Math.min(Math.max(0, t + ((k + 0.5) / blur.samples - 0.5) * (blur.shutter / o.fps)), Math.max(0, o.durationSec - 1e-4)));
        await wait();
        ctx.globalAlpha = 1 / (k + 1);
        ctx.drawImage(o.canvas, 0, 0, o.out.width, o.out.height);
      }
      ctx.globalAlpha = 1;
    } else {
      o.driver.seek(t);
      await wait();
      if (o.canvas && o.out && ctx) ctx.drawImage(o.canvas, 0, 0, o.out.width, o.out.height);
    }
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
  // a film with motion blur is drawn into a 2D canvas, several pictures to a frame; one without is read from the player's canvas as before
  const out = o.driver.blurAt && typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: o.canvas.width, height: o.canvas.height }) : undefined;
  const video = new mb.CanvasSource(out ?? o.canvas, { codec: 'avc', quality: new mb.Quality('high') } as never);
  output.addVideoTrack(video);
  const audio = o.audio ? new mb.AudioBufferSource({ codec: 'aac', quality: new mb.Quality('high') } as never) : undefined;
  if (audio) output.addAudioTrack(audio);

  await output.start();
  await captureFrames({ ...o, fps, ...(out ? { canvas: o.canvas, out } : {}), onFrame: (_i, t) => video.add(t, 1 / fps) }, { settle: deps.settle });
  if (audio && o.audio) await audio.add(o.audio);
  await output.finalize();
  const buffer = (output.target as { buffer: ArrayBuffer | null }).buffer ?? new ArrayBuffer(0);
  return new Blob([buffer], { type: 'video/mp4' });
}
