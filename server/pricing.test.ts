import { expect, it, vi } from 'vitest';
import { priceImage, priceSamImages, priceSamVideoFrames, priceSpark, priceTranscribeSeconds } from './pricing';

it('prices Spark per million tokens', () => {
  expect(priceSpark('muse-spark-1.3-contributor', 1_000_000, 1_000_000)).toBeCloseTo(0.3, 6);
  expect(priceSpark('muse-spark-1.3', 1000, 1000)).toBeCloseTo(0.0055, 6);
});
it('unknown models price at 0 with a warning', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  expect(priceSpark('mystery', 10, 10)).toBe(0);
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});
it('SAM video has a 50-frame minimum', () => {
  expect(priceSamVideoFrames(10)).toBe(priceSamVideoFrames(50));
  expect(priceSamVideoFrames(10)).toBeCloseTo(0.01, 9);
  expect(priceSamVideoFrames(240)).toBeCloseTo(0.048, 9);
});
it('other prices', () => {
  expect(priceTranscribeSeconds(3600)).toBeCloseTo(0.18, 9);
  expect(priceImage(3)).toBeCloseTo(0.03, 9);
  expect(priceSamImages(1000)).toBeCloseTo(2.5, 9);
});
