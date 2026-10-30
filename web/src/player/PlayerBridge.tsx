import { useApplication } from '@pixi/react';
import { GsapPixieContext } from 'reacthub-pixitweenjs';
import { useContext, useImperativeHandle, type Ref } from 'react';
import { clampSeek } from './format';
import type { Readiness } from './useCompositionReady';

/** The handle other panels get (contract D-7). Time is in seconds at this boundary. */
export interface PlayerHandle {
  getCanvas(): HTMLCanvasElement | null;
  getApp(): ReturnType<typeof useApplication>['app'] | null;
  play(): void;
  pause(): void;
  seek(sec: number): void;
  getTime(): number;
  /** Resolves true when every 3D layer has drawn (at once when there are none), false on a layer error or after `timeoutSec`. */
  whenReady(timeoutSec: number): Promise<boolean>;
}

/** Rendered inside <Application>: bridges the Pixi app and the master GSAP timeline to a PlayerHandle. */
export function PlayerBridge({ handleRef, duration, readiness }: { handleRef: Ref<PlayerHandle>; duration: number; readiness: Readiness }) {
  const { app } = useApplication();
  const gsap = useContext(GsapPixieContext);

  useImperativeHandle(
    handleRef,
    () => ({
      getCanvas: () => (app?.canvas as HTMLCanvasElement | undefined) ?? null,
      getApp: () => app ?? null,
      play: () => gsap.handlePlay(),
      pause: () => gsap.handlePause(),
      seek: (sec: number) => gsap.handleSeek(clampSeek(sec, duration)),
      getTime: () => gsap.playerTimeRef.current,
      whenReady: (timeoutSec) => readiness.whenReady(timeoutSec),
    }),
    [app, gsap, duration, readiness],
  );
  return null;
}
