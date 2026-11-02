import { expect, it } from 'vitest';
import { bottle, flacon, stripedCan, triangle, RED, SLATE, WHITE } from './test-images';
import { findBodyBand, LABEL_HEIGHT, LABEL_WIDTH, unwrapCylinder } from './unwrap';

it('finds the body of the test can: rows within 3 px and the radius within 1 px', () => {
  const { img, truth } = stripedCan();
  const band = findBodyBand(img)!;
  expect(band).not.toBeNull();
  expect(Math.abs(band.top - truth.bodyTop)).toBeLessThanOrEqual(3);
  expect(Math.abs(band.bottom - truth.bodyBottom)).toBeLessThanOrEqual(3);
  expect(Math.abs(band.r - truth.r)).toBeLessThanOrEqual(1);
  expect(Math.abs(band.cx - truth.cx)).toBeLessThanOrEqual(1);
});

it('leaves the neck and shoulder of the bottle out of the band', () => {
  const { img, truth } = bottle();
  const band = findBodyBand(img)!;
  expect(band).not.toBeNull();
  expect(band.top).toBeGreaterThanOrEqual(truth.neckBottom);
  expect(band.top).toBeGreaterThanOrEqual(truth.bodyTop - 10); // the shoulder rows narrow by more than 4 %
  expect(Math.abs(band.bottom - truth.bodyBottom)).toBeLessThanOrEqual(3);
});

it('returns null for a flacon whose cap, neck and shoulders are nearly half its height, so the outline keeps the cap', () => {
  expect(findBodyBand(flacon())).toBeNull();
});

it('returns null for a triangle, which has no straight body', () => {
  expect(findBodyBand(triangle())).toBeNull();
});

it('returns null for an image with nothing in it', () => {
  expect(findBodyBand({ width: 20, height: 20, data: new Uint8ClampedArray(20 * 20 * 4) })).toBeNull();
});

const pixel = (out: { data: Uint8ClampedArray }, u: number, v = LABEL_HEIGHT / 2) => {
  const i = (v * LABEL_WIDTH + u) * 4;
  return [out.data[i]!, out.data[i + 1]!, out.data[i + 2]!] as const;
};
const colAt = (deg: number) => Math.round((deg / 360 + 0.5) * LABEL_WIDTH);

function unwrapped() {
  const { img, truth } = stripedCan();
  const band = findBodyBand(img)!;
  return { out: unwrapCylinder(img, band, SLATE), truth };
}

it('writes a 2048 x 1024 RGBA buffer', () => {
  expect(unwrapped().out.data).toHaveLength(2048 * 1024 * 4);
});

it('puts the stripe boundaries evenly in u: within 2 % of the stripe period inside 60 degrees either side', () => {
  const { out, truth } = unwrapped();
  const period = (truth.stripeDeg / 360) * LABEL_WIDTH;
  const isRed = (u: number) => {
    const [r, g] = pixel(out, u);
    return r > 150 && g < 100;
  };
  const edges: number[] = [];
  for (let u = colAt(-58); u < colAt(58); u++) if (isRed(u) !== isRed(u + 1)) edges.push(u + 0.5);
  expect(edges.length).toBeGreaterThanOrEqual(3);
  for (let i = 1; i < edges.length; i++) expect(Math.abs(edges[i]! - edges[i - 1]! - period)).toBeLessThanOrEqual(period * 0.02);
});

it('is the side colour exactly at 120 degrees, and a blend of side and label at 76 degrees', () => {
  const { out } = unwrapped();
  expect(pixel(out, colAt(120))).toEqual(SLATE);
  expect(pixel(out, colAt(-120))).toEqual(SLATE);
  const blend = pixel(out, colAt(76));
  expect(blend).not.toEqual(SLATE);
  for (const label of [RED, WHITE]) expect(blend).not.toEqual(label);
  const between = (v: number, a: number, b: number) => v >= Math.min(a, b) - 1 && v <= Math.max(a, b) + 1;
  // each channel lies between the side colour and one of the two label colours
  expect([RED, WHITE].some((l) => blend.every((c, i) => between(c, SLATE[i]!, l[i]!)))).toBe(true);
});
