export function parseColor(c: string): { r: number; g: number; b: number } {
  if (/^#[\da-f]{3}$/i.test(c)) return { r: parseInt(c[1]! + c[1]!, 16), g: parseInt(c[2]! + c[2]!, 16), b: parseInt(c[3]! + c[3]!, 16) };
  if (/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(c))
    return { r: parseInt(c.slice(1, 3), 16), g: parseInt(c.slice(3, 5), 16), b: parseInt(c.slice(5, 7), 16) };
  throw new Error(`invalid color '${c}'`);
}
export function linearise(n: number): number {
  const c = n / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export function relLuminance(rgb: { r: number; g: number; b: number }): number {
  return 0.2126 * linearise(rgb.r) + 0.7152 * linearise(rgb.g) + 0.0722 * linearise(rgb.b);
}
export function ratioFromLuminance(a: number, b: number): number {
  const hi = Math.max(a, b),
    lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}
export function bestFlatTextColor(plateLuminance: number): { color: '#FFFFFF' | '#111111'; ratio: number; reaches: boolean } {
  const white = ratioFromLuminance(1, plateLuminance),
    black = ratioFromLuminance(relLuminance(parseColor('#111111')), plateLuminance);
  const color = white >= black ? '#FFFFFF' : '#111111',
    ratio = Math.max(white, black);
  return { color, ratio, reaches: ratio >= 4.5 };
}
