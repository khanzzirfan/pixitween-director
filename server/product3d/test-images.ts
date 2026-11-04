// Owned by S13a. Synthetic RGBA products for the unwrap, band, colour and contour tests: shapes whose true geometry is known, so the tests can check numbers.
import { alphaAt, blank, put, type Rgba } from './pixels';

export { alphaAt, blank, put };
export type { Rgba };

export const RED = [200, 40, 40] as const;
export const WHITE = [240, 240, 240] as const;
export const NAVY = [20, 30, 90] as const;
export const SLATE = [0x1f, 0x29, 0x37] as const;

export interface CanSpec {
  width?: number;
  height?: number;
  bodyTop?: number;
  bodyBottom?: number;
  bodyW?: number;
  /** Angle of one stripe, degrees on the cylinder. */
  stripeDeg?: number;
}
/** What the drawing really is, so a test can compare. */
export interface CanTruth {
  bodyTop: number;
  bodyBottom: number;
  cx: number;
  r: number;
  stripeDeg: number;
}

/** A can seen from the front: a lid, a straight body striped evenly in angle (so a correct unwrap shows even stripes), and a base. */
export function stripedCan(spec: CanSpec = {}): { img: Rgba; truth: CanTruth } {
  const width = spec.width ?? 300;
  const height = spec.height ?? 500;
  const bodyTop = spec.bodyTop ?? 70;
  const bodyBottom = spec.bodyBottom ?? 440;
  const bodyW = spec.bodyW ?? 200;
  const stripeDeg = spec.stripeDeg ?? 30;
  const img = blank(width, height);
  const cx = width / 2;
  const r = bodyW / 2;
  for (let y = bodyTop - 14; y <= bodyBottom + 14; y++) {
    const inBody = y >= bodyTop && y <= bodyBottom;
    const half = inBody ? r : r * 0.86; // lid and base are narrower than the body by more than 4 %
    for (let x = Math.ceil(cx - half); x <= Math.floor(cx + half - 1); x++) {
      if (!inBody) {
        put(img, x, y, [180, 180, 190]);
        continue;
      }
      const theta = (Math.asin(Math.max(-1, Math.min(1, (x + 0.5 - cx) / r))) * 180) / Math.PI;
      put(img, x, y, Math.floor((theta + 90) / stripeDeg) % 2 === 0 ? RED : WHITE);
    }
  }
  return { img, truth: { bodyTop, bodyBottom, cx, r, stripeDeg } };
}

/** A bottle: a straight body, a curved shoulder and a narrow neck above it. */
export function bottle(): { img: Rgba; truth: { bodyTop: number; bodyBottom: number; neckBottom: number } } {
  const img = blank(300, 560);
  const cx = 150;
  const bodyTop = 220;
  const bodyBottom = 520;
  for (let y = 30; y <= bodyBottom; y++) {
    let half: number;
    if (y >= bodyTop) half = 90;
    else if (y >= 150) half = 35 + (55 * (y - 150)) / (bodyTop - 150); // the shoulder widens from the neck to the body
    else half = 35;
    for (let x = Math.ceil(cx - half); x < Math.floor(cx + half); x++) put(img, x, y, y < 150 ? [60, 120, 60] : NAVY);
  }
  return { img, truth: { bodyTop, bodyBottom, neckBottom: 150 } };
}

/** A perfume flacon: a wide ornate cap and neck over a straight body that is only about half the height (the Habik shape). */
export function flacon(): Rgba {
  const img = blank(300, 600);
  const cx = 150;
  for (let y = 20; y <= 580; y++) {
    let half: number;
    if (y < 90) half = 70 - (y % 20) * 0.6; // an ornate crown: the width wobbles
    else if (y < 160) half = 30; // neck
    else if (y < 280) half = 30 + (60 * (y - 160)) / 120; // shoulders
    else half = 90; // body
    for (let x = Math.ceil(cx - half); x < Math.floor(cx + half); x++) put(img, x, y, [180, 40, 110]);
  }
  return img;
}

/** A solid triangle: no straight body at all. */
export function triangle(): Rgba {
  const img = blank(300, 300);
  for (let y = 20; y < 280; y++) {
    const half = ((y - 20) / 260) * 130;
    for (let x = Math.ceil(150 - half); x < Math.floor(150 + half); x++) put(img, x, y, RED);
  }
  return img;
}

/** A flat-coloured body with different left and right edge strips, to test the side colour. */
export function edgeStrips(opts: { left: readonly [number, number, number]; right: readonly [number, number, number]; leftFrac: number; rightFrac: number; bodyW?: number }): { img: Rgba; band: { top: number; bottom: number; cx: number; r: number } } {
  const bodyW = opts.bodyW ?? 200;
  const img = blank(300, 300);
  const cx = 150;
  const r = bodyW / 2;
  for (let y = 40; y < 260; y++) {
    for (let x = cx - r; x < cx + r; x++) {
      const f = (x - (cx - r)) / bodyW;
      put(img, x, y, f < opts.leftFrac ? opts.left : f >= 1 - opts.rightFrac ? opts.right : [128, 128, 128]);
    }
  }
  return { img, band: { top: 40, bottom: 259, cx, r } };
}

/** A mug: a rounded body with a handle ring on the right. */
export function mug(): Rgba {
  const img = blank(400, 360);
  for (let y = 40; y < 320; y++) for (let x = 60; x < 260; x++) put(img, x, y, [230, 230, 230]);
  // handle: a ring, drawn with its hole left empty
  for (let y = 0; y < 360; y++)
    for (let x = 260; x < 400; x++) {
      const d = Math.hypot(x - 260, y - 180);
      if (d <= 90 && d >= 50) put(img, x, y, [230, 230, 230]);
    }
  return img;
}

/** A five-point star, outer radius 150. */
export function star(): Rgba {
  const img = blank(360, 360);
  const inStar = (px: number, py: number) => {
    // a point is in the star if it is inside the polygon of the 10 alternating vertices
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const rad = i % 2 === 0 ? 150 : 62;
      pts.push([180 + rad * Math.cos(a), 180 + rad * Math.sin(a)]);
    }
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]!;
      const [xj, yj] = pts[j]!;
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  for (let y = 0; y < 360; y++) for (let x = 0; x < 360; x++) if (inStar(x + 0.5, y + 0.5)) put(img, x, y, [250, 200, 40]);
  return img;
}

export const empty = (): Rgba => blank(100, 100);
