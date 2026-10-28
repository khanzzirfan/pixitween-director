import { useApplication } from '@pixi/react';
import { GsapPixieContext } from 'reacthub-pixitweenjs';
import { useContext, useImperativeHandle, type Ref } from 'react';
import { clampSeek } from './format';

/** The handle other panels get (contract D-7). Time is in seconds at this boundary. */
export interface PlayerHandle {
  getCanvas(): HTMLCanvasElement | null;
  getApp(): ReturnType<typeof useApplication>['app'] | null;
  play(): void;
  pause(): void;
  seek(sec: number): void;
  getTime(): number;
}

/** Rendered inside <Application>: bridges the Pixi app and the master GSAP timeline to a PlayerHandle. */
export function PlayerBridge({ handleRef, duration }: { handleRef: Ref<PlayerHandle>; duration: number }) {
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
    }),
    [app, gsap, duration],
  );
  return null;
}
