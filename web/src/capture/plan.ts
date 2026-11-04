/** Frames are sampled at these fractions of each motion scene, so the first, middle and last moments are judged. */
export const FRAME_FRACTIONS = [0.2, 0.5, 0.8] as const;
export const CAPTURE_FPS = 30;

export interface PlanScene {
  id: string;
  startSec: number;
  durationSec: number;
  mode?: 'motion' | 'generate';
}
export interface PlanItem {
  sceneId: string;
  /** Seconds from the start of the scene, rounded to whole capture frames. */
  atSec: number;
  /** Seconds from the start of the film: where the player must seek. */
  rootSec: number;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Generate-mode scenes are not captured: their pictures come from a model, not the layout. */
export function planFrames(scenes: PlanScene[]): PlanItem[] {
  return scenes
    .filter((s) => (s.mode ?? 'motion') === 'motion')
    .flatMap((s) =>
      FRAME_FRACTIONS.map((f) => {
        const frame = Math.round(s.durationSec * CAPTURE_FPS * f);
        const atSec = round4(frame / CAPTURE_FPS);
        return { sceneId: s.id, atSec, rootSec: round4(s.startSec + atSec) };
      }),
    );
}
