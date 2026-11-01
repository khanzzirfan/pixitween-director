// MotionStage: converts one AepCompositionJson with aepToMotion and plays it on the Motion engine
// (MotionPlayer -> MotionRuntime). The ref is the engine's MotionHandle, a superset of the director's
// seek/play/pause/getTime/getCanvas/whenReady surface, so the Player can switch to it.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import type { AepCompositionJson } from '@shared/aep/composition';
import { MotionPlayer, type MotionHandle } from '@engine/react/MotionPlayer';
import { aepToMotion, type AepToMotionResult } from './aep';
import { createAudioSync, type AudioSync } from './player/audio';

export type { MotionHandle } from '@engine/react/MotionPlayer';

export interface MotionStageProps {
  composition: AepCompositionJson;
  resolveUrl?(src: string): string;
  displayWidth?: number;
  controls?: boolean;
  autoplay?: boolean;
  loop?: boolean;
  onLayerError?(layerId: string, message: string): void;
  onTime?(sec: number): void;
  onWarnings?(warnings: string[]): void;
}

function convert(composition: AepCompositionJson, resolveUrl?: (src: string) => string): AepToMotionResult | { error: string } {
  try {
    return aepToMotion(composition, { resolveUrl });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export const MotionStage = forwardRef<MotionHandle, MotionStageProps>(function MotionStage(
  { composition, resolveUrl, onWarnings, controls = false, onTime, ...rest },
  ref,
) {
  const converted = useMemo(() => {
    const r = convert(composition, resolveUrl);
    if (!('error' in r)) onWarnings?.(r.warnings);
    return r;
  }, [composition]);

  const innerRef = useRef<MotionHandle | null>(null);
  const audioRef = useRef<AudioSync | null>(null);
  const cues = 'error' in converted ? null : converted.audio;

  useEffect(() => {
    if (!cues || cues.length === 0) return undefined;
    const audio = createAudioSync(cues);
    audioRef.current = audio;
    return () => {
      audio.dispose();
      audioRef.current = null;
    };
  }, [cues]);

  // Same surface as the engine handle; play/pause/seek also drive the audio cues.
  useImperativeHandle(
    ref,
    () => ({
      play: () => {
        const h = innerRef.current;
        h?.play();
        audioRef.current?.play(h?.getTime() ?? 0);
      },
      pause: () => {
        innerRef.current?.pause();
        audioRef.current?.pause();
      },
      seek: (sec: number) => {
        innerRef.current?.seek(sec);
        audioRef.current?.seek(sec);
      },
      getTime: () => innerRef.current?.getTime() ?? 0,
      getDuration: () => innerRef.current?.getDuration() ?? 0,
      getCanvas: () => innerRef.current?.getCanvas() ?? null,
      whenReady: (timeoutSec: number) => innerRef.current?.whenReady(timeoutSec) ?? Promise.resolve(false),
      renderFrame: (frame: number) => {
        if (!innerRef.current) throw new Error('MotionStage: no runtime');
        return innerRef.current.renderFrame(frame);
      },
      readPixel: (x: number, y: number) => innerRef.current?.readPixel(x, y) ?? [0, 0, 0, 0],
      pick: (x: number, y: number) => innerRef.current?.pick(x, y) ?? null,
    }),
    [],
  );

  const handleTime = (sec: number) => {
    const h = innerRef.current;
    if (h && sec >= h.getDuration() && !rest.loop) audioRef.current?.pause();
    else audioRef.current?.sync(sec);
    onTime?.(sec);
  };

  if ('error' in converted) {
    return (
      <pre role="alert" data-testid="motion-stage-error" style={{ color: 'crimson', padding: 16 }}>
        {converted.error}
      </pre>
    );
  }
  return <MotionPlayer ref={innerRef} doc={converted.doc} controls={controls} onTime={handleTime} {...rest} />;
});

export default MotionStage;
