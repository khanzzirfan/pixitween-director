/** Seconds -> 'm:ss.s' (0 -> '0:00.0', 65.25 -> '1:05.3'). */
export function formatTime(sec: number): string {
  const total = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const tenths = Math.round(total * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** Clamp a seek time into [0, duration]; NaN becomes 0. */
export function clampSeek(t: number, duration: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.min(Math.max(t, 0), Math.max(duration, 0));
}
