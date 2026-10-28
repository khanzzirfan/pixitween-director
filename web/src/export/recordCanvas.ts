// Owned by S8a. Plays the film once while MediaRecorder captures the canvas (and the mixed audio) into a WebM blob.
import { ExportError, type ExportDriver } from './types';

export interface RecordOptions {
  canvas: HTMLCanvasElement;
  driver: ExportDriver;
  durationSec: number;
  fps?: number;
  audio?: AudioBuffer | null;
  mimeType: string;
  videoBitsPerSecond?: number;
  onProgress?(p: { timeSec: number; fraction: number }): void;
  signal?: AbortSignal;
}

export interface RecordDeps {
  MediaRecorderCtor?: typeof MediaRecorder;
  AudioContextCtor?: typeof AudioContext;
  MediaStreamCtor?: typeof MediaStream;
  raf?: (cb: () => void) => unknown;
  /** Milliseconds, like performance.now(). */
  now?: () => number;
}

const TIMEOUT_MARGIN_SEC = 5;

export function recordCanvas(opts: RecordOptions, deps: RecordDeps = {}): Promise<Blob> {
  const MR = deps.MediaRecorderCtor ?? MediaRecorder;
  const ACtx = deps.AudioContextCtor ?? (typeof AudioContext !== 'undefined' ? AudioContext : undefined);
  const MStream = deps.MediaStreamCtor ?? MediaStream;
  const raf = deps.raf ?? ((cb: () => void) => requestAnimationFrame(cb));
  const now = deps.now ?? (() => performance.now());
  const fps = opts.fps ?? 30;
  const { driver, durationSec, canvas, signal } = opts;
  // The playhead is polled once per animation frame, so stop within two frames of the end (the timeline carries a 0.2 s buffer).
  const stopAt = durationSec - 2 / fps;
  const nextFrame = () => new Promise<void>((r) => raf(() => r()));

  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    let recorder: MediaRecorder | undefined;
    let stream: MediaStream | undefined;
    let audioSource: AudioBufferSourceNode | undefined;
    let audioCtx: AudioContext | undefined;
    let recorderStopped = false;
    let driverPaused = false;
    const chunks: Blob[] = [];

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') fail(new ExportError('tab-hidden', 'The tab was hidden while recording; keep it in the foreground'));
    };
    const onAbort = () => fail(new ExportError('aborted', 'Export cancelled'));

    const stopRecorder = () => {
      if (recorder && !recorderStopped) {
        recorderStopped = true;
        try {
          recorder.stop();
        } catch {
          // already inactive
        }
      }
    };
    const pauseDriver = () => {
      if (!driverPaused) {
        driverPaused = true;
        driver.pause();
      }
    };
    const stopAudio = () => {
      try {
        audioSource?.stop();
      } catch {
        // never started
      }
      void audioCtx?.close?.().catch?.(() => undefined);
    };
    /** Runs once, whichever way the export ends. */
    const cleanup = () => {
      document.removeEventListener('visibilitychange', onVisibility);
      signal?.removeEventListener('abort', onAbort);
      stream?.getTracks().forEach((t) => t.stop());
    };
    function fail(err: ExportError) {
      if (settled) return;
      settled = true;
      pauseDriver();
      stopAudio();
      stopRecorder();
      cleanup();
      reject(err);
    }

    if (signal?.aborted) return fail(new ExportError('aborted', 'Export cancelled'));

    void (async () => {
      try {
        driver.seek(0);
        await nextFrame();
        await nextFrame();
        if (settled) return;

        stream = new MStream(canvas.captureStream(fps).getVideoTracks());
        if (opts.audio && ACtx) {
          audioCtx = new ACtx();
          const dest = audioCtx.createMediaStreamDestination();
          audioSource = audioCtx.createBufferSource();
          audioSource.buffer = opts.audio;
          audioSource.connect(dest); // never to ctx.destination: the user must not hear the export
          dest.stream.getAudioTracks().forEach((t) => stream!.addTrack(t));
        }

        recorder = new MR(stream, {
          mimeType: opts.mimeType,
          videoBitsPerSecond: opts.videoBitsPerSecond ?? 8_000_000,
          ...(opts.audio ? { audioBitsPerSecond: 128_000 } : {}),
        });
        recorder.ondataavailable = (e: BlobEvent) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        recorder.onerror = (e: Event) => {
          const err = e as unknown as { error?: { message?: string }; message?: string };
          fail(new ExportError('recorder-error', `The recorder failed: ${err.error?.message ?? err.message ?? 'unknown error'}`));
        };
        recorder.onstop = () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(new Blob(chunks, { type: opts.mimeType }));
        };

        const startedAt = now();
        const tick = () => {
          if (settled) return;
          const timeSec = driver.getTime();
          opts.onProgress?.({ timeSec, fraction: Math.min(1, Math.max(0, timeSec / durationSec)) });
          if (timeSec >= stopAt) {
            pauseDriver();
            stopAudio();
            stopRecorder();
            return;
          }
          if ((now() - startedAt) / 1000 > durationSec + TIMEOUT_MARGIN_SEC) return fail(new ExportError('timeout', 'The film did not reach its end in time'));
          raf(tick);
        };
        recorder.onstart = () => {
          audioSource?.start();
          driver.play();
          raf(tick);
        };

        document.addEventListener('visibilitychange', onVisibility);
        signal?.addEventListener('abort', onAbort);
        recorder.start(250);
      } catch (e) {
        fail(e instanceof ExportError ? e : new ExportError('unsupported', e instanceof Error ? e.message : String(e)));
      }
    })();
  });
}
