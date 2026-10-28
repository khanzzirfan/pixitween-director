import { Application } from '@pixi/react';
import { AepComposition, GsapPixieContext, GsapPixieContextProvider, PixiSequenceWrapper, type AepCompositionJson } from 'reacthub-pixitweenjs';
import { forwardRef, useContext, useEffect, useRef, useState } from 'react';
import { clampSeek, formatTime } from './format';
import { PlayerBridge, type PlayerHandle } from './PlayerBridge';

export type { PlayerHandle } from './PlayerBridge';

export interface PlayerProps {
  composition: AepCompositionJson | null;
  assetMap?: Record<string, { src: string }>;
  backgroundColor?: string;
  /** Default true, so captureStream (export) and renderer.extract (review capture) never see blank frames. */
  preserveDrawingBuffer?: boolean;
  onError?(e: unknown): void;
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
  const raf = useRef(0);

  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const t = gsap.playerTimeRef.current;
      setTime(clampSeek(t, duration));
      if (t >= duration) {
        gsap.handlePause();
        setPlaying(false);
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, duration, gsap]);

  const toggle = () => {
    if (playing) gsap.handlePause();
    else gsap.handlePlay();
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

const Player = forwardRef<PlayerHandle, PlayerProps>(function Player(
  { composition, assetMap, backgroundColor, preserveDrawingBuffer = true, onError },
  ref,
) {
  if (!composition) return <div className="player-empty" data-testid="player-empty">No film yet</div>;

  const duration = composition.durationInFrames / composition.fps;
  const { width, height } = stageSize(composition);
  const background = backgroundColor ?? composition.bgColor ?? '#000000';

  return (
    <GsapPixieContextProvider>
      <div className="player-stage" style={{ aspectRatio: `${width} / ${height}`, maxWidth: width }}>
        <Application key={`${width}x${height}`} width={width} height={height} backgroundColor={background} antialias preserveDrawingBuffer={preserveDrawingBuffer}>
          <PlayerBridge handleRef={ref} duration={duration} />
          <PixiSequenceWrapper startAt={0} endAt={duration}>
            <AepComposition src={composition} assetMap={assetMap} onError={onError} />
          </PixiSequenceWrapper>
        </Application>
      </div>
      <Controls duration={duration} />
    </GsapPixieContextProvider>
  );
});

export default Player;
