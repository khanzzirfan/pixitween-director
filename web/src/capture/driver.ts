import type { PlayerHandle } from '../player/Player';
import type { Storyboard } from '@shared/storyboard';
import { ASPECT_SIZES } from '@shared/composition';
import { CAPTURE_FPS, planFrames } from './plan';
import { captureFrames, type CaptureDriver, type CapturedFrame } from './stable';
import { measureTextBoxes, type PixiStageLike } from './measure';

export interface MeasuredText {
  frame: number;
  box: { left: number; top: number; right: number; bottom: number };
}
export interface ReviewCapture {
  frames: Array<{ sceneId: string; atSec: number; blob: Blob; unstable: boolean }>;
  textBoxes: Record<string, MeasuredText>;
}

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
  let start = 0;
  const scenes = storyboard.scenes.map((s) => {
    const out = { id: s.id, startSec: start, durationSec: s.durationSec, mode: s.mode };
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
    frames: results.map((r) => ({ sceneId: r.sceneId, atSec: r.atSec, blob: r.image, unstable: r.unstable })),
    textBoxes,
  };
}

/** Text layer ids a scene is built with, as the director names them: `<scene>:headline` and `<scene>:caption`. */
function textLayerIds(storyboard: Storyboard, sceneId: string): string[] {
  const scene = storyboard.scenes.find((s) => s.id === sceneId);
  if (!scene) return [];
  return (scene.layersWanted as string[]).filter((r) => r === 'headline' || r === 'caption').map((r) => `${sceneId}:${r}`);
}
