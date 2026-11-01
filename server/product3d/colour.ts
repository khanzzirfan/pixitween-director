// Owned by S13a. The colour of the sides the camera never saw (design section 5.4), and the Lab helpers the 3D tests share.
import { alphaAt, type Rgba } from './pixels';
import type { BodyBand, Rgb } from './unwrap';

export type Lab = readonly [number, number, number];

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const unlin = (v: number) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const finv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

/** sRGB to CIE Lab (D65). */
export function rgbToLab(rgb: Rgb): Lab {
  const [r, g, b] = [lin(rgb[0]), lin(rgb[1]), lin(rgb[2])];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
export function labToRgb(lab: Lab): [number, number, number] {
  const fy = (lab[0] + 16) / 116;
  const x = finv(fy + lab[1] / 500) * 0.95047;
  const y = finv(fy);
  const z = finv(fy - lab[2] / 200) * 1.08883;
  const r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const g = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const b = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return [unlin(r), unlin(g), unlin(b)].map((c) => Math.max(0, Math.min(255, c))) as [number, number, number];
}
/** CIE76 colour difference: enough to tell "the same colour" from "another colour". */
export const deltaE = (a: Lab, b: Lab): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const hexOf = (rgb: Rgb): string => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const medianLab = (labs: Lab[]): Lab => [median(labs.map((l) => l[0])), median(labs.map((l) => l[1])), median(labs.map((l) => l[2]))];

/** The two sides of the body differ by more than this, so they are two colours rather than one. */
export const SIDES_DIFFER = 12;
const EDGE_SHARE = 0.08;

/** The median Lab colour of every opaque pixel of one body column. */
function columnLab(img: Rgba, band: BodyBand, x: number): Lab | undefined {
  const labs: Lab[] = [];
  for (let y = band.top; y <= band.bottom; y += 2) {
    if (alphaAt(img, x, y) <= 127) continue;
    const i = (y * img.width + x) * 4;
    labs.push(rgbToLab([img.data[i]!, img.data[i + 1]!, img.data[i + 2]!]));
  }
  return labs.length ? medianLab(labs) : undefined;
}

/**
 * The colour the unseen sides take: the median of the 8 % of body columns nearest each edge, in Lab.
 * When the two edges are different colours (by more than 12), the colour that spreads further in from its edge wins.
 */
export function sideColour(img: Rgba, band: BodyBand): [number, number, number] {
  const left = Math.max(0, Math.floor(band.cx - band.r));
  const right = Math.min(img.width - 1, Math.ceil(band.cx + band.r) - 1);
  const cols: Array<Lab | undefined> = [];
  for (let x = left; x <= right; x++) cols.push(columnLab(img, band, x));
  const n = cols.length;
  const strip = Math.max(1, Math.round(n * EDGE_SHARE));
  const present = (from: number, to: number) => cols.slice(from, to).filter((c): c is Lab => !!c);
  const l = present(0, strip);
  const r = present(n - strip, n);
  if (!l.length && !r.length) return [128, 128, 128];
  if (!l.length) return labToRgb(medianLab(r));
  if (!r.length) return labToRgb(medianLab(l));
  const a = medianLab(l);
  const b = medianLab(r);
  if (deltaE(a, b) <= SIDES_DIFFER) return labToRgb(medianLab([...l, ...r]));
  // how far in from each edge the colour holds
  const reach = (edge: Lab, fromLeft: boolean) => {
    let k = 0;
    for (let i = 0; i < n; i++) {
      const c = cols[fromLeft ? i : n - 1 - i];
      if (!c || deltaE(c, edge) > SIDES_DIFFER) break;
      k++;
    }
    return k;
  };
  return labToRgb(reach(a, true) >= reach(b, false) ? a : b);
}
