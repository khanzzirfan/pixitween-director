/** Frames <-> seconds. Film fps is 30; the engine counts time in frames. */
export function secToFrames(sec: number, fps = 30): number {
  if (!Number.isFinite(sec) || sec < 0) throw new RangeError(`secToFrames: seconds must be a finite number >= 0, got ${sec}`);
  return Math.round(sec * fps);
}

export const framesToSec = (frames: number, fps = 30): number => frames / fps;
