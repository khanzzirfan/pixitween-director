// Owned by S8a. A small adapter so recording code never depends on the Player's internals.
import { ExportError, type ExportDriver, type ExportPlayerHandle } from './types';

export function getExportCanvas(handle: ExportPlayerHandle | null): HTMLCanvasElement {
  const canvas = handle?.getCanvas() ?? null;
  if (!canvas) throw new ExportError('no-canvas', 'The player has no canvas yet');
  return canvas;
}

/** true / false when a WebGL context reports it; null when none is available. */
export function isDrawingBufferPreserved(canvas: HTMLCanvasElement): boolean | null {
  const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
  if (!gl) return null;
  return gl.getContextAttributes()?.preserveDrawingBuffer === true;
}

export const playerToDriver = (h: ExportPlayerHandle): ExportDriver => ({
  play: () => h.play(),
  pause: () => h.pause(),
  seek: (sec) => h.seek(sec),
  getTime: () => h.getTime(),
});
