import { type AepCompositionJson } from '@shared/aep';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { MotionStage, type MotionHandle } from '../motion/MotionStage';
import { clampSeek, formatTime } from './format';

/** The handle other panels get (contract D-7). Time is in seconds at this boundary. */
export interface PlayerHandle {
  getCanvas(): HTMLCanvasElement | null;
  play(): void;
  pause(): void;
  seek(sec: number): void;
  getTime(): number;
  /** Front-most layer id at a doc-space pixel (y down), or null. */
  pick?(x: number, y: number): string | null;
  /** The motion blur at `sec` for an exact export: the shutter (share of a frame, 0 to 1) and the pictures to average; null when sharp. */
  blurAt?(sec: number): { shutter: number; samples: number } | null;
  /** Resolves true when every 3D layer has drawn (at once when there are none), false on a layer error or after `timeoutSec`. */
  whenReady(timeoutSec: number): Promise<boolean>;
}

export interface PlayerProps {
  composition: AepCompositionJson | null;
  assetMap?: Record<string, { src: string }>;
  onError?(e: unknown): void;
  /** A layer failed to draw. */
  onLayerError?(layerId: string, error: unknown): void;
}

const LONGEST_SIDE = 960;

function stageSize(c: AepCompositionJson): { width: number; height: number } {
  const k = LONGEST_SIDE / Math.max(c.width, c.height);
  return { width: Math.round(c.width * k), height: Math.round(c.height * k) };
}

/** Play/pause + slider over any engine that exposes play/pause/seek/getTime. */
function MotionControls({ stageRef, duration }: { stageRef: { current: MotionHandle | null }; duration: number }) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const t = stageRef.current?.getTime() ?? 0;
      setTime(clampSeek(t, duration));
      if (t >= duration) {
        stageRef.current?.pause();
        setPlaying(false);
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, duration, stageRef]);

  const toggle = () => {
    if (playing) stageRef.current?.pause();
    else stageRef.current?.play();
    setPlaying(!playing);
  };
  const seek = (value: number) => {
    const t = clampSeek(value, duration);
    stageRef.current?.seek(t);
    setTime(t);
  };

  return (
    <div className="player-controls">
      <button type="button" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <input type="range" aria-label="Seek" min={0} max={duration} step={0.01} value={time} onChange={(e) => seek(Number(e.target.value))} />
      <span data-testid="player-time">{formatTime(time)}</span>
    </div>
  );
}

function MotionLoadedPlayer({ composition, assetMap, onError, onLayerError, handleRef }: PlayerProps & { composition: AepCompositionJson; handleRef: Ref<PlayerHandle> }) {
  const duration = composition.durationInFrames / composition.fps;
  const { width, height } = stageSize(composition);
  const stageRef = useRef<MotionHandle | null>(null);
  const resolveUrl = useMemo(() => (assetMap ? (src: string) => assetMap[src]?.src ?? src : undefined), [assetMap]);

  useImperativeHandle(
    handleRef,
    () => ({
      getCanvas: () => stageRef.current?.getCanvas() ?? null,
      pick: (x: number, y: number) => stageRef.current?.pick(x, y) ?? null,
      blurAt: (sec: number) => stageRef.current?.blurAt(sec) ?? null,
      play: () => stageRef.current?.play(),
      pause: () => stageRef.current?.pause(),
      seek: (sec: number) => stageRef.current?.seek(clampSeek(sec, duration)),
      getTime: () => stageRef.current?.getTime() ?? 0,
      whenReady: (timeoutSec) => stageRef.current?.whenReady(timeoutSec) ?? Promise.resolve(false),
    }),
    [duration],
  );

  return (
    <>
      <div className="player-stage" style={{ aspectRatio: `${width} / ${height}`, maxWidth: width }}>
        <MotionStage
          ref={stageRef}
          composition={composition}
          resolveUrl={resolveUrl}
          controls={false}
          onLayerError={(id, message) => {
            onError?.(new Error(message));
            onLayerError?.(id, new Error(message));
          }}
        />
      </div>
      <MotionControls stageRef={stageRef} duration={duration} />
    </>
  );
}

const Player = forwardRef<PlayerHandle, PlayerProps>(function Player(props, ref) {
  if (!props.composition) return <div className="player-empty" data-testid="player-empty">No film yet</div>;
  return <MotionLoadedPlayer {...props} composition={props.composition} handleRef={ref} />;
});

export default Player;
