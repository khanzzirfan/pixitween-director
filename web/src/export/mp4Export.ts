// Owned by S8a. Experimental MP4 (H.264 + AAC) through WebCodecs and Mediabunny.
import type { RecordOptions } from './recordCanvas';
import type { ExportDriver } from './types';

import type * as Mediabunny from 'mediabunny';


export async function mp4Supported(deps: { VideoEncoder?: typeof VideoEncoder } = {}): Promise<boolean> {
  const Encoder = 'VideoEncoder' in deps ? deps.VideoEncoder : typeof VideoEncoder !== 'undefined' ? VideoEncoder : undefined;
  if (!Encoder) return false;
  try {
    return (await Encoder.isConfigSupported({ codec: 'avc1.640028', width: 1280, height: 720 })).supported === true;
  } catch {
    return false;
  }
}

export async function exportMp4(
  opts: { canvas: HTMLCanvasElement; driver: ExportDriver; durationSec: number; fps?: number; audio?: AudioBuffer | null; onProgress?: RecordOptions['onProgress']; signal?: AbortSignal },
  deps: { mediabunny?: typeof Mediabunny; raf?: typeof requestAnimationFrame } = {},
): Promise<Blob> {
  const mb = deps.mediabunny ?? (await import('mediabunny'));
  const raf = deps.raf ?? requestAnimationFrame.bind(window);
  const fps = opts.fps ?? 30;
  const { driver, durationSec } = opts;

  const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });
  const videoSource = new mb.CanvasSource(opts.canvas, { codec: 'avc', quality: new mb.Quality('high') } as never);
  output.addVideoTrack(videoSource);
  const audioSource = opts.audio ? new mb.AudioBufferSource({ codec: 'aac', quality: new mb.Quality('high') } as never) : undefined;
  if (audioSource) output.addAudioTrack(audioSource);

  await output.start();
  driver.seek(0);
  driver.play();

  await new Promise<void>((resolve, reject) => {
    const tick = async () => {
      if (opts.signal?.aborted) {
        driver.pause();
        return reject(new Error('aborted'));
      }
      const timeSec = driver.getTime();
      try {
        await videoSource.add(timeSec, 1 / fps);
      } catch (e) {
        driver.pause();
        return reject(e);
      }
      opts.onProgress?.({ timeSec, fraction: Math.min(1, timeSec / durationSec) });
      if (timeSec >= durationSec - 1 / fps) {
        driver.pause();
        return resolve();
      }
      raf(() => void tick());
    };
    raf(() => void tick());
  });

  if (audioSource && opts.audio) await audioSource.add(opts.audio);
  await output.finalize();
  const buffer = (output.target as { buffer: ArrayBuffer | null }).buffer ?? new ArrayBuffer(0);
  return new Blob([buffer], { type: 'video/mp4' });
}
