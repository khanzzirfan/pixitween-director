import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { MotionDocError, MotionDocInput } from '../schema';
import { MotionRuntime } from '../runtime/MotionRuntime';

// <MotionPlayer> (engine/docs/06-runtime-player.md, "<MotionPlayer>"): a drop-in player whose handle
// mirrors the director's PlayerHandle (web/src/player/PlayerBridge.tsx) so a later swap is mechanical.

/** Mirrors the director's `PlayerHandle`, in Motion engine terms. */
export interface MotionHandle {
  play(): void;
  pause(): void;
  seek(sec: number): void;
  getTime(): number;
  getDuration(): number;
  getCanvas(): HTMLCanvasElement | null;
  whenReady(timeoutSec: number): Promise<boolean>;
  renderFrame(frame: number): Promise<HTMLCanvasElement>;
  readPixel(x: number, y: number): [number, number, number, number];
  /** Front-most layer id at a doc-space pixel (y down), or null. */
  pick(x: number, y: number): string | null;
  /** The runtime behind the player, for capture (engine/src/runtime/capture.ts). */
  getRuntime?(): MotionRuntime | null;
}

export interface MotionPlayerProps {
  doc: MotionDocInput;
  displayWidth?: number;
  /** Default true: renders play/pause, a seek range and frame step buttons under the canvas. */
  controls?: boolean;
  autoplay?: boolean;
  loop?: boolean;
  onDocErrors?(errors: MotionDocError[]): void;
  onLayerError?(layerId: string, message: string): void;
  /** Called once per animation frame while playing, with the current time in seconds. */
  onTime?(sec: number): void;
}

function formatTime(sec: number): string {
  const clamped = Math.max(0, sec);
  const minutes = Math.floor(clamped / 60);
  const seconds = (clamped % 60).toFixed(2).padStart(5, '0');
  return `${minutes}:${seconds}`;
}

export const MotionPlayer = forwardRef<MotionHandle, MotionPlayerProps>(function MotionPlayer(
  { doc, displayWidth, controls = true, autoplay = false, loop = false, onDocErrors, onLayerError, onTime },
  ref,
) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<MotionRuntime | null>(null);
  const seenLayerErrorsRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const fps = doc.fps ?? 30;

  // Created once per mount, destroyed on cleanup: StrictMode's mount→cleanup→mount still ends up
  // with exactly one live runtime, and destroys every runtime it ever created.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    seenLayerErrorsRef.current = 0;
    const runtime = MotionRuntime.create({
      mount,
      displayWidth,
      loop,
      onError: () => {
        const errors = runtime.layerErrors();
        for (let i = seenLayerErrorsRef.current; i < errors.length; i += 1) {
          onLayerError?.(errors[i].layerId, errors[i].message);
        }
        seenLayerErrorsRef.current = errors.length;
      },
    });
    runtimeRef.current = runtime;

    return () => {
      runtime.destroy();
      runtimeRef.current = null;
    };
  }, []);

  // Reloads whenever the doc prop changes (including the runtime's first load).
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return undefined;

    let cancelled = false;
    void runtime.load(doc).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        onDocErrors?.(result.errors);
        return;
      }
      setDuration(runtime.getDuration());
      setTime(runtime.getTime());
      if (autoplay) {
        runtime.play();
        setPlaying(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [doc]);

  // Advances the displayed time (and onTime) once per animation frame while playing.
  useEffect(() => {
    if (!playing) return undefined;

    let raf = requestAnimationFrame(tick);
    function tick() {
      const runtime = runtimeRef.current;
      if (runtime) {
        const t = runtime.getTime();
        setTime(t);
        onTime?.(t);
        if (!loop && t >= runtime.getDuration()) {
          runtime.pause();
          setPlaying(false);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    }

    return () => cancelAnimationFrame(raf);
  }, [playing, loop, onTime]);

  useImperativeHandle(
    ref,
    () => ({
      play: () => {
        runtimeRef.current?.play();
        setPlaying(true);
      },
      pause: () => {
        runtimeRef.current?.pause();
        setPlaying(false);
      },
      seek: (sec: number) => {
        runtimeRef.current?.seek(sec);
        setTime(sec);
      },
      getTime: () => runtimeRef.current?.getTime() ?? 0,
      getDuration: () => runtimeRef.current?.getDuration() ?? 0,
      getCanvas: () => runtimeRef.current?.getCanvas() ?? null,
      whenReady: (timeoutSec: number) => runtimeRef.current?.whenReady(timeoutSec) ?? Promise.resolve(false),
      renderFrame: (frame: number) => {
        const runtime = runtimeRef.current;
        if (!runtime) throw new Error('MotionPlayer: no runtime');
        return runtime.renderFrame(frame);
      },
      readPixel: (x: number, y: number) => runtimeRef.current?.readPixel(x, y) ?? [0, 0, 0, 0],
      pick: (x: number, y: number) => runtimeRef.current?.pick(x, y) ?? null,
      getRuntime: () => runtimeRef.current,
    }),
    [],
  );

  const toggle = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (playing) {
      runtime.pause();
      setPlaying(false);
    } else {
      runtime.play();
      setPlaying(true);
    }
  }, [playing]);

  const seekTo = useCallback(
    (sec: number) => {
      const clamped = Math.min(Math.max(sec, 0), duration);
      runtimeRef.current?.seek(clamped);
      setTime(clamped);
    },
    [duration],
  );

  const stepFrame = useCallback((direction: 1 | -1) => seekTo(time + direction * (1 / fps)), [seekTo, time, fps]);

  return (
    <div className="motion-player">
      <div ref={mountRef} className="motion-player-canvas" />
      {controls && (
        <div className="motion-player-controls">
          <button type="button" onClick={() => stepFrame(-1)} aria-label="Previous frame">
            ⏮
          </button>
          <button type="button" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" onClick={() => stepFrame(1)} aria-label="Next frame">
            ⏭
          </button>
          <input
            type="range"
            aria-label="Seek"
            min={0}
            max={duration}
            step={1 / fps}
            value={time}
            onChange={(event) => seekTo(Number(event.target.value))}
          />
          <span data-testid="motion-player-time">
            {formatTime(time)} / {formatTime(duration)}
          </span>
        </div>
      )}
    </div>
  );
});
