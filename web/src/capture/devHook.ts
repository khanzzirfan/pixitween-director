import type { PlayerHandle } from '../player/Player';
import type { Storyboard } from '@shared/storyboard';
import { captureReview } from './driver';

/**
 * Dev-only console hook: `await window.__directorCapture()` captures the current film's review frames and reports
 * each frame's width and mean brightness, so a blank or half-loaded picture is easy to spot.
 */
export function installCaptureHook(getPlayer: () => PlayerHandle | null, getStoryboard: () => Storyboard | undefined): void {
  if (!import.meta.env.DEV) return;
  (window as unknown as { __directorCapture: () => Promise<unknown> }).__directorCapture = async () => {
    const player = getPlayer();
    const storyboard = getStoryboard();
    if (!player || !storyboard) throw new Error('open a film with a storyboard first');
    const capture = await captureReview(player, storyboard);
    const frames = [];
    for (const f of capture.frames) {
      const bitmap = await createImageBitmap(f.blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
      frames.push({
        sceneId: f.sceneId,
        atSec: f.atSec,
        unstable: f.unstable,
        width: bitmap.width,
        mean: Math.round((sum / (data.length / 4)) * 10) / 10,
      });
    }
    return { frames, textBoxes: capture.textBoxes };
  };
}
