// Owned by S13a. The outline of a cut-out mask as a polygon, for an extruded 3D shape (design section 5.3). Pure.
import { alphaAt, type Rgba } from './pixels';

export type Point = [number, number];

const WORK_SIZE = 512;
const THRESHOLD = 127;
const EPSILON_PX = 1.5;
export const MAX_POINTS = 400;

/** Alpha above the threshold, downscaled so the long side is at most 512 pixels (a block counts as set when most of it is). */
function downscale(img: Rgba): { set: Uint8Array; w: number; h: number } {
  const scale = Math.max(1, Math.max(img.width, img.height) / WORK_SIZE);
  const w = Math.max(1, Math.round(img.width / scale));
  const h = Math.max(1, Math.round(img.height / scale));
  const set = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * img.width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / w));
      const y0 = Math.floor((y * img.height) / h);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / h));
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++, n++) sum += alphaAt(img, xx, yy);
      set[y * w + x] = sum / n > THRESHOLD ? 1 : 0;
    }
  }
  return { set, w, h };
}

/** The pixels of the biggest 8-connected shape. */
function largestShape(set: Uint8Array, w: number, h: number): Uint8Array {
  const label = new Int32Array(w * h);
  let best = { id: 0, size: 0 };
  let next = 0;
  for (let i = 0; i < set.length; i++) {
    if (!set[i] || label[i]) continue;
    const id = ++next;
    let size = 0;
    const stack = [i];
    label[i] = id;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const px = p % w;
      const py = (p - px) / w;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (set[q] && !label[q]) {
            label[q] = id;
            stack.push(q);
          }
        }
    }
    if (size > best.size) best = { id, size };
  }
  const out = new Uint8Array(w * h);
  if (best.size === 0) return out;
  for (let i = 0; i < out.length; i++) out[i] = label[i] === best.id ? 1 : 0;
  return out;
}

/** The outer boundary along pixel edges, clockwise on screen, keeping the shape on the right. */
function traceOuter(set: Uint8Array, w: number, h: number): Point[] {
  const F = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && set[y * w + x] === 1;
  const start = set.indexOf(1);
  if (start < 0) return [];
  const sx = start % w;
  const sy = (start - sx) / w;
  // an edge from (x, y) in direction d exists when the pixel on its right is set and the pixel on its left is not
  const has = (x: number, y: number, dx: number, dy: number): boolean => {
    if (dx === 1) return F(x, y) && !F(x, y - 1); // east: the top of pixel (x, y)
    if (dx === -1) return F(x - 1, y - 1) && !F(x - 1, y); // west: the bottom of pixel (x-1, y-1)
    if (dy === 1) return F(x - 1, y) && !F(x, y); // south: the right side of pixel (x-1, y)
    return F(x, y - 1) && !F(x - 1, y - 1); // north: the left side of pixel (x, y-1)
  };
  const dirs: Array<[number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  let x = sx;
  let y = sy;
  let d = 0;
  const pts: Point[] = [];
  const limit = (w + 1) * (h + 1) * 4 + 8;
  for (let n = 0; n < limit; n++) {
    pts.push([x, y]);
    // prefer a right turn, then straight, then a left turn: diagonal neighbours stay joined
    let moved = false;
    for (const turn of [1, 0, 3]) {
      const nd = (d + turn) % 4;
      const [dx, dy] = dirs[nd]!;
      if (has(x, y, dx, dy)) {
        x += dx;
        y += dy;
        d = nd;
        moved = true;
        break;
      }
    }
    if (!moved) break;
    if (x === sx && y === sy) break; // the top-left corner of the first pixel is met once on the outer ring
  }
  return pts;
}

const dist = (p: Point, a: Point, b: Point): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  return len === 0 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / len;
};

/** Douglas-Peucker on an open run of points. */
function simplifyRun(pts: Point[], eps: number): Point[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let max = eps;
    for (let i = a + 1; i < b; i++) {
      const d = dist(pts[i]!, pts[a]!, pts[b]!);
      if (d > max) {
        max = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Douglas-Peucker on a closed ring: it is split at the two points farthest apart so neither end is a corner by accident. */
export function simplifyRing(ring: Point[], eps: number): Point[] {
  if (ring.length < 4) return ring;
  let a = 0;
  let b = 0;
  let max = -1;
  const step = Math.max(1, Math.floor(ring.length / 64));
  for (let i = 0; i < ring.length; i += step) for (let j = i; j < ring.length; j += step) {
    const d = Math.hypot(ring[i]![0] - ring[j]![0], ring[i]![1] - ring[j]![1]);
    if (d > max) {
      max = d;
      a = i;
      b = j;
    }
  }
  const first = ring.slice(a, b + 1);
  const second = [...ring.slice(b), ...ring.slice(0, a + 1)];
  return [...simplifyRun(first, eps).slice(0, -1), ...simplifyRun(second, eps).slice(0, -1)];
}

/**
 * The polygon around the biggest shape of the mask, in the image's own pixels with y down, at most 400 points.
 * Works on a copy of at most 512 px, traces the pixel edges, then simplifies with Douglas-Peucker at 1.5 px (more if 400 points is not enough).
 * An empty mask gives [].
 */
export function maskContour(img: Rgba, maxPoints = MAX_POINTS): Point[] {
  const { set, w, h } = downscale(img);
  const shape = largestShape(set, w, h);
  const ring = traceOuter(shape, w, h);
  if (ring.length < 3) return [];
  let eps = EPSILON_PX;
  let out = simplifyRing(ring, eps);
  while (out.length > maxPoints && eps < 64) {
    eps *= 1.4;
    out = simplifyRing(ring, eps);
  }
  const sx = img.width / w;
  const sy = img.height / h;
  return out.map(([x, y]) => [Math.round(x * sx * 10) / 10, Math.round(y * sy * 10) / 10] as Point);
}

/** The area of a polygon (shoelace), always positive. */
export function polygonArea(poly: readonly Point[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j]![0] * poly[i]![1] - poly[i]![0] * poly[j]![1];
  return Math.abs(s) / 2;
}
