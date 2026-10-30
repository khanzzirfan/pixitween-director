// Owned by S13a. The label of a round product, unwrapped from its photo (design section 5.2). Pure: pixels in, pixels out.
import { alphaAt, blank, put, type Rgba } from './pixels';

export interface BodyBand {
  /** First and last row of the straight body, inclusive. */
  top: number;
  bottom: number;
  /** Axis column (the middle of the body) and radius in pixels. */
  cx: number;
  r: number;
}

const OPAQUE = 127;
const BAND_TOLERANCE = 0.04;
/** A body shorter than this share of the product's rows is not a cylinder. */
const MIN_BODY_SHARE = 0.3;

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** The straight body of a round product: the longest run of rows whose width stays within ±4 % of the commonest width. Null when there is none (a cone, a pyramid). */
export function findBodyBand(img: Rgba): BodyBand | null {
  const rows: Array<{ y: number; left: number; right: number; w: number }> = [];
  for (let y = 0; y < img.height; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < img.width; x++) {
      if (alphaAt(img, x, y) > OPAQUE) {
        if (left < 0) left = x;
        right = x;
      }
    }
    if (left >= 0) rows.push({ y, left, right, w: right - left + 1 });
  }
  if (rows.length < 8) return null;

  // the width most rows share, within the tolerance
  let seed = rows[0]!.w;
  let best = 0;
  for (const a of rows) {
    const n = rows.reduce((c, b) => c + (Math.abs(b.w - a.w) <= a.w * BAND_TOLERANCE ? 1 : 0), 0);
    if (n > best) {
      best = n;
      seed = a.w;
    }
  }
  const typical = median(rows.filter((b) => Math.abs(b.w - seed) <= seed * BAND_TOLERANCE).map((b) => b.w));
  const inBand = (b: { w: number }) => Math.abs(b.w - typical) <= typical * BAND_TOLERANCE;

  let run: typeof rows = [];
  let longest: typeof rows = [];
  let prevY = -2;
  for (const b of rows) {
    if (inBand(b) && b.y === prevY + 1 && run.length) run.push(b);
    else run = inBand(b) ? [b] : [];
    prevY = b.y;
    if (run.length > longest.length) longest = [...run];
  }
  if (longest.length < rows.length * MIN_BODY_SHARE) return null;
  return {
    top: longest[0]!.y,
    bottom: longest[longest.length - 1]!.y,
    cx: median(longest.map((b) => (b.left + b.right + 1) / 2)),
    r: median(longest.map((b) => b.w)) / 2,
  };
}

export const LABEL_WIDTH = 2048;
export const LABEL_HEIGHT = 1024;
/** The photographed arc: beyond this angle a source pixel stretches more than 3 times, so the side colour takes over. */
export const THETA_MAX_DEG = 70;
export const FEATHER_DEG = 12;

export type Rgb = readonly [number, number, number];

const smooth = (t: number) => t * t * (3 - 2 * t);

function sample(img: Rgba, x: number, y: number): [number, number, number, number] {
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(y)));
  const x1 = Math.min(img.width - 1, x0 + 1);
  const y1 = Math.min(img.height - 1, y0 + 1);
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const at = (xx: number, yy: number) => img.data[(yy * img.width + xx) * 4 + c]!;
    out[c] = (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
  }
  return out;
}

/**
 * Unwraps the label of a cylinder into a 2048 x 1024 texture whose columns are angle.
 * Inside the photographed arc the source column is cx + r sin(theta); beyond it the side colour fills, with a 12 degree feather so there is no seam.
 * Column u maps to theta = (u - 0.5) * 360 degrees, so theta = 0 (the front) is the middle of the texture.
 */
export function unwrapCylinder(img: Rgba, band: BodyBand, side: Rgb): { data: Uint8ClampedArray; width: number; height: number } {
  const out = blank(LABEL_WIDTH, LABEL_HEIGHT);
  const bodyH = band.bottom - band.top + 1;
  for (let v = 0; v < LABEL_HEIGHT; v++) {
    const sy = band.top + ((v + 0.5) / LABEL_HEIGHT) * bodyH - 0.5;
    for (let u = 0; u < LABEL_WIDTH; u++) {
      const theta = ((u + 0.5) / LABEL_WIDTH - 0.5) * 360;
      const a = Math.abs(theta);
      if (a >= THETA_MAX_DEG + FEATHER_DEG) {
        put(out, u, v, side);
        continue;
      }
      const t = (Math.min(a, THETA_MAX_DEG + FEATHER_DEG) * Math.PI) / 180;
      const sx = band.cx + band.r * Math.sin(Math.sign(theta) * Math.min(t, (THETA_MAX_DEG * Math.PI) / 180));
      const [r, g, b, alpha] = sample(img, sx - 0.5, sy);
      // where the photo has no pixel (a transparent edge), the side colour shows through
      const k = alpha / 255;
      const px: [number, number, number] = [r * k + side[0] * (1 - k), g * k + side[1] * (1 - k), b * k + side[2] * (1 - k)];
      // the feather: from the arc's edge to 12 degrees beyond, blend toward the side colour
      const f = a <= THETA_MAX_DEG ? 0 : smooth((a - THETA_MAX_DEG) / FEATHER_DEG);
      put(out, u, v, [px[0] * (1 - f) + side[0] * f, px[1] * (1 - f) + side[1] * f, px[2] * (1 - f) + side[2] * f]);
    }
  }
  return out;
}
