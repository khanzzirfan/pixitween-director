import { expect, it } from 'vitest';
import { maskContour, polygonArea, type Point } from './contour';
import { alphaAt, empty, mug, star, type Rgba } from './test-images';

/** Pixels inside the outer ring: everything the outside cannot reach, so a hole (the handle's) counts. */
function outerRingArea(img: Rgba): number {
  const seen = new Uint8Array(img.width * img.height);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const i = y * img.width + x;
    if (seen[i] || alphaAt(img, x, y) > 127) return;
    seen[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < img.width; x++) {
    push(x, 0);
    push(x, img.height - 1);
  }
  for (let y = 0; y < img.height; y++) {
    push(0, y);
    push(img.width - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % img.width;
    const y = (i - x) / img.width;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return img.width * img.height - seen.reduce((a, b) => a + b, 0);
}

it('outlines the mug within 1 % of its outer-ring area, with at most 400 points', () => {
  const img = mug();
  const c = maskContour(img);
  expect(c.length).toBeGreaterThanOrEqual(3);
  expect(c.length).toBeLessThanOrEqual(400);
  const want = outerRingArea(img);
  expect(Math.abs(polygonArea(c) - want) / want).toBeLessThan(0.01);
});

/** Distance from p to the nearest pixel that is set, and to the nearest that is not. */
const edgeDistance = (img: Rgba, p: Point): number => {
  let best = Infinity;
  const r = 5;
  const [cx, cy] = [Math.round(p[0]), Math.round(p[1])];
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < img.width && y < img.height && alphaAt(img, x, y) > 127;
  const here = on(Math.min(img.width - 1, Math.max(0, cx)), Math.min(img.height - 1, Math.max(0, cy)));
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (on(x, y) !== here) best = Math.min(best, Math.hypot(x - p[0], y - p[1]));
  return best;
};

it('outlines the star with at least 10 points, each within 2 px of the mask edge', () => {
  const img = star();
  const c = maskContour(img);
  expect(c.length).toBeGreaterThanOrEqual(10);
  for (const p of c) expect(edgeDistance(img, p)).toBeLessThanOrEqual(2);
});

it('returns [] for an empty mask', () => {
  expect(maskContour(empty())).toEqual([]);
});

it('works on a big image by taking its outline from a 512 px copy and scaling back', () => {
  const big: Rgba = { width: 2000, height: 1000, data: new Uint8ClampedArray(2000 * 1000 * 4) };
  for (let y = 200; y < 800; y++) for (let x = 400; x < 1600; x++) big.data[(y * 2000 + x) * 4 + 3] = 255;
  const c = maskContour(big);
  expect(c.length).toBeLessThanOrEqual(8);
  const xs = c.map((p) => p[0]);
  const ys = c.map((p) => p[1]);
  expect(Math.min(...xs)).toBeGreaterThan(395);
  expect(Math.max(...xs)).toBeLessThan(1605);
  expect(Math.min(...ys)).toBeGreaterThan(195);
  expect(Math.max(...ys)).toBeLessThan(805);
});

it('keeps only the biggest of two shapes', () => {
  const img: Rgba = { width: 300, height: 100, data: new Uint8ClampedArray(300 * 100 * 4) };
  for (let y = 10; y < 90; y++) for (let x = 10; x < 150; x++) img.data[(y * 300 + x) * 4 + 3] = 255;
  for (let y = 40; y < 50; y++) for (let x = 250; x < 260; x++) img.data[(y * 300 + x) * 4 + 3] = 255;
  expect(Math.max(...maskContour(img).map((p) => p[0]))).toBeLessThan(160);
});
