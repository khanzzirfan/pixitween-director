import { Application } from '@pixi/react';
import { AepComposition, GsapPixieContext, GsapPixieContextProvider, PixiSequenceWrapper, type AepCompositionJson } from 'reacthub-pixitweenjs';
import { forwardRef, useContext, useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { clampSeek, formatTime } from './format';
import { PlayerBridge, type PlayerHandle } from './PlayerBridge';
import { createReadiness, hasModel3D, supportsRenderReady } from './useCompositionReady';

export type { PlayerHandle } from './PlayerBridge';

export interface PlayerProps {
  composition: AepCompositionJson | null;
  assetMap?: Record<string, { src: string }>;
  backgroundColor?: string;
  /** Default true, so captureStream (export) and renderer.extract (review capture) never see blank frames. */
  preserveDrawingBuffer?: boolean;
  onError?(e: unknown): void;
  /** A 3D layer failed to draw (engine 0.3.0-alpha.4 and newer). */
  onLayerError?(layerId: string, error: unknown): void;
  /** The engine version, to feature-check `onRenderReady`; defaults to the installed one. */
  engineVersion?: string;
}

const LONGEST_SIDE = 960;

function stageSize(c: AepCompositionJson): { width: number; height: number } {
  const k = LONGEST_SIDE / Math.max(c.width, c.height);
  return { width: Math.round(c.width * k), height: Math.round(c.height * k) };
}

function Controls({ duration }: { duration: number }) {
  const gsap = useContext(GsapPixieContext);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  /** What this button last asked for; used when the engine does not report its play state. */
  const wanted = useRef(false);

  // The engine's play state is the truth: at the end of the film it rewinds to the start and pauses itself, and a handle's play()
  // starts it without this button. So the button follows the engine every frame instead of keeping its own state.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = gsap.playerTimeRef.current;
      let on = gsap.playStateRef ? gsap.playStateRef.current : wanted.current;
      if (on && t >= duration) {
        gsap.handlePause();
        on = false;
      }
      // while playing, and once on stopping (the engine may have rewound), the time shows where the engine is
      if (on || wanted.current) setTime(clampSeek(gsap.playerTimeRef.current, duration));
      wanted.current = on;
      setPlaying(on);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration, gsap]);

  const toggle = () => {
    if (playing) gsap.handlePause();
    else gsap.handlePlay();
    wanted.current = !playing;
    setPlaying(!playing);
  };
  const seek = (value: number) => {
    const t = clampSeek(value, duration);
    gsap.handleSeek(t);
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

const Player = forwardRef<PlayerHandle, PlayerProps>(function Player(props, ref) {
  if (!props.composition) return <div className="player-empty" data-testid="player-empty">No film yet</div>;
  return <LoadedPlayer {...props} composition={props.composition} handleRef={ref} />;
});

function LoadedPlayer({
  composition,
  assetMap,
  backgroundColor,
  preserveDrawingBuffer = true,
  onError,
  onLayerError,
  engineVersion,
  handleRef,
}: PlayerProps & { composition: AepCompositionJson; handleRef: Ref<PlayerHandle> }) {
  const duration = composition.durationInFrames / composition.fps;
  const { width, height } = stageSize(composition);
  const background = backgroundColor ?? composition.bgColor ?? '#000000';
  // a film remounts its player per version once it is ready, so each version gets a fresh readiness; a composition that changes under a mounted engine is not redrawn from scratch, so it keeps the one it has
  const needed = hasModel3D(composition as never) && supportsRenderReady(engineVersion);
  const readiness = useMemo(() => createReadiness({ needed }), [needed]);

  return (
    <GsapPixieContextProvider>
      <div className="player-stage" style={{ aspectRatio: `${width} / ${height}`, maxWidth: width }}>
        <Application key={`${width}x${height}`} width={width} height={height} backgroundColor={background} antialias preserveDrawingBuffer={preserveDrawingBuffer}>
          <PlayerBridge handleRef={handleRef} duration={duration} readiness={readiness} />
          <PixiSequenceWrapper startAt={0} endAt={duration}>
            <AepComposition
              src={composition}
              assetMap={assetMap}
              onError={onError}
              {...(needed
                ? {
                    onRenderReady: () => readiness.markReady(),
                    onLayerError: (layerId: string, error: unknown) => {
                      readiness.markError(layerId, error);
                      onLayerError?.(layerId, error);
                    },
                  }
                : {})}
            />
          </PixiSequenceWrapper>
        </Application>
      </div>
      <Controls duration={duration} />
    </GsapPixieContextProvider>
  );
}

export default Player;
