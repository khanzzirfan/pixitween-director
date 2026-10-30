import { expect, it } from 'vitest';
import { deltaE, hexOf, labToRgb, rgbToLab, sideColour } from './colour';
import { edgeStrips, NAVY, RED, SLATE } from './test-images';

it('converts colours to Lab and back without drifting', () => {
  for (const c of [SLATE, RED, NAVY, [255, 255, 255], [0, 0, 0]] as const) {
    const back = labToRgb(rgbToLab(c));
    expect(Math.abs(back[0] - c[0]) + Math.abs(back[1] - c[1]) + Math.abs(back[2] - c[2])).toBeLessThanOrEqual(2);
  }
  expect(rgbToLab([255, 255, 255])[0]).toBeCloseTo(100, 0);
});

it('hexOf writes #rrggbb', () => expect(hexOf([0x1f, 0x29, 0x37])).toBe('#1f2937'));

it('returns the edge colour within Delta E 2 when both edges are #1f2937', () => {
  const { img, band } = edgeStrips({ left: SLATE, right: SLATE, leftFrac: 0.2, rightFrac: 0.2 });
  const got = sideColour(img, band);
  expect(deltaE(rgbToLab(got), rgbToLab(SLATE))).toBeLessThan(2);
});

it('picks navy when a 10 % red strip meets a 30 % navy strip (the wider one wins)', () => {
  const { img, band } = edgeStrips({ left: RED, right: NAVY, leftFrac: 0.1, rightFrac: 0.3 });
  const got = sideColour(img, band);
  expect(deltaE(rgbToLab(got), rgbToLab(NAVY))).toBeLessThan(2);
});

it('averages two edges of nearly the same colour', () => {
  const { img, band } = edgeStrips({ left: [100, 100, 100], right: [104, 100, 100], leftFrac: 0.2, rightFrac: 0.2 });
  expect(deltaE(rgbToLab(sideColour(img, band)), rgbToLab([102, 100, 100]))).toBeLessThan(2);
});
