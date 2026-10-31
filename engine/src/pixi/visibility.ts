/**
 * A layer is visible on the half-open window `[start, end)`, except that at the
 * doc's last frame (`t === docDuration`) a layer ending exactly there stays
 * visible so the final frame is not empty.
 */
export function isVisible(timeSec: number, start: number, end: number, docDuration: number): boolean {
  if (timeSec < start) return false;
  if (timeSec < end) return true;
  return timeSec === docDuration && end === docDuration;
}
