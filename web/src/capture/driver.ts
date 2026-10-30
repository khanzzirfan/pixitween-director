import type { PlayerHandle } from '../player/Player';
import { compositionMode, type Storyboard } from '@shared/storyboard';
import { ASPECT_SIZES } from '@shared/composition';
import { CAPTURE_FPS, planFrames } from './plan';
import { captureFrames, isFlatSignature, type CaptureDriver, type CapturedFrame } from './stable';
import { measureTextBoxes, type PixiStageLike } from './measure';

export interface MeasuredText {
  frame: number;
  box: { left: number; top: number; right: number; bottom: number };
}
export interface ReviewCapture {
  frames: Array<{ sceneId: string; atSec: number; blob: Blob; unstable: boolean; blank: boolean }>;
  textBoxes: Record<string, MeasuredText>;
  /** The 3D product had not finished drawing when the wait ended, so its frames may be missing it. */
  notReady?: boolean;
}

/** How long a capture waits for the 3D product to draw before it goes on without it, in seconds. */
export const CAPTURE_READY_WAIT_SEC = 10;
const waitForRender = (player: PlayerHandle): Promise<boolean> => (player.whenReady ? player.whenReady(CAPTURE_READY_WAIT_SEC) : Promise.resolve(true));

const tick = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const SIG_W = 32;
const SIG_H = 18;

/** The player's canvas, read through a small 2D canvas: enough to tell whether the picture has changed. */
async function canvasSignature(canvas: HTMLCanvasElement): Promise<string> {
  const small = document.createElement('canvas');
  small.width = SIG_W;
  small.height = SIG_H;
  const ctx = small.getContext('2d');
  if (!ctx) return 'no-2d';
  ctx.drawImage(canvas, 0, 0, SIG_W, SIG_H);
  return Array.from(ctx.getImageData(0, 0, SIG_W, SIG_H).data).join(',');
}

function playerDriver(player: PlayerHandle): CaptureDriver<Blob> {
  return {
    async seek(rootSec) {
      player.seek(rootSec);
      await tick();
    },
    async nextFrames(n) {
      for (let i = 0; i < n; i++) await tick();
    },
    async signature() {
      const canvas = player.getCanvas();
      return canvas ? canvasSignature(canvas) : 'no-canvas';
    },
    async isBlank() {
      const canvas = player.getCanvas();
      return canvas ? isFlatSignature(await canvasSignature(canvas)) : false;
    },
    async extractFull() {
      const canvas = player.getCanvas();
      if (!canvas) throw new Error('the player has no canvas');
      return new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the frame could not be read'))), 'image/png'),
      );
    },
  };
}

/** Waits for the Player to mount its canvas: a film can be ready before the page has finished drawing the player. */
export async function waitForPlayer(get: () => PlayerHandle | null, timeoutMs = 15000): Promise<PlayerHandle> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const player = get();
    if (player?.getCanvas()) return player;
    if (Date.now() > deadline) throw new Error('The player did not load in time.');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** Captures the review frames of every motion scene and measures its text layers in composition pixels. */
export async function captureReview(
  player: PlayerHandle,
  storyboard: Storyboard,
  o: { onProgress?: (done: number, total: number) => void } = {},
): Promise<ReviewCapture> {
  const ready = await waitForRender(player);
  let start = 0;
  const scenes = storyboard.scenes.map((s) => {
    const out = { id: s.id, startSec: start, durationSec: s.durationSec, mode: compositionMode(s.mode) };
    start += s.durationSec;
    return out;
  });
  const plan = planFrames(scenes);
  const results: Array<CapturedFrame<Blob>> = await captureFrames(plan, playerDriver(player), o);
  const textBoxes: Record<string, MeasuredText> = {};
  const app = player.getApp();
  const canvas = player.getCanvas();
  if (app && canvas) {
    // Pixi bounds are in logical stage pixels (app.screen); the film's frame size is the composition's.
    const dims = ASPECT_SIZES[storyboard.aspect];
    const comp = { w: dims.width, h: dims.height };
    const screen = { w: app.screen.width, h: app.screen.height };
    const stage = app.stage as unknown as PixiStageLike;
    for (const r of results) {
      const frame = Math.round(r.atSec * CAPTURE_FPS);
      const textIds = textLayerIds(storyboard, r.sceneId);
      const measured = measureTextBoxes(stage, screen, comp, textIds);
      for (const [id, box] of Object.entries(measured)) if (!textBoxes[id]) textBoxes[id] = { frame, box };
    }
  }
  return {
    frames: results.map((r) => ({ sceneId: r.sceneId, atSec: r.atSec, blob: r.image, unstable: r.unstable, blank: r.blank })),
    textBoxes,
    ...(ready ? {} : { notReady: true }),
  };
}

/** Text layer ids a scene is built with, as the director names them: `<scene>:headline` and `<scene>:caption`. */
function textLayerIds(storyboard: Storyboard, sceneId: string): string[] {
  const scene = storyboard.scenes.find((s) => s.id === sceneId);
  if (!scene) return [];
  return (scene.layersWanted as string[]).filter((r) => r === 'headline' || r === 'caption').map((r) => `${sceneId}:${r}`);
}

/** Captures the frames a crew critic asked for: times are seconds from the start of the scene, so the film time adds the scene's start. */
export async function captureScene(player: PlayerHandle, storyboard: Storyboard, sceneId: string, timesSec: number[]): Promise<ReviewCapture> {
  const ready = await waitForRender(player);
  let start = 0;
  let found = false;
  for (const s of storyboard.scenes) {
    if (s.id === sceneId) {
      found = true;
      break;
    }
    start += s.durationSec;
  }
  if (!found) throw new Error(`scene ${sceneId} is not in the storyboard`);
  const plan = timesSec.map((atSec) => ({ sceneId, atSec, rootSec: Math.round((start + atSec) * 10000) / 10000 }));
  const results = await captureFrames(plan, playerDriver(player));
  const textBoxes: Record<string, MeasuredText> = {};
  const app = player.getApp();
  if (app && player.getCanvas()) {
    const dims = ASPECT_SIZES[storyboard.aspect];
    const screen = { w: app.screen.width, h: app.screen.height };
    const stage = app.stage as unknown as PixiStageLike;
    for (const r of results) {
      const measured = measureTextBoxes(stage, screen, { w: dims.width, h: dims.height }, textLayerIds(storyboard, sceneId));
      for (const [id, box] of Object.entries(measured)) if (!textBoxes[id]) textBoxes[id] = { frame: Math.round(r.atSec * CAPTURE_FPS), box };
    }
  }
  return { frames: results.map((r) => ({ sceneId, atSec: r.atSec, blob: r.image, unstable: r.unstable, blank: r.blank })), textBoxes, ...(ready ? {} : { notReady: true }) };
}
