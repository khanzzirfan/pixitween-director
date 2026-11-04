import { expect, it } from 'vitest';
import { boxFaces } from './box';
import { rgbToLab } from './colour';
import { blank, put, SLATE } from './test-images';

function carton() {
  const img = blank(300, 400);
  for (let y = 0; y < 400; y++) for (let x = 0; x < 300; x++) put(img, x, y, x < 30 || x >= 270 ? SLATE : [220, 210, 180]);
  return img;
}

it('keeps the front at the image size', () => {
  const f = boxFaces(carton());
  expect(f.front).toHaveLength(300 * 400 * 4);
  expect(f.frontSize).toEqual({ width: 300, height: 400 });
});

it("makes the top 4.5 to 5.5 Lab lightness steps lighter than the side", () => {
  const f = boxFaces(carton());
  const d = rgbToLab(f.top)[0] - rgbToLab(f.side)[0];
  expect(d).toBeGreaterThanOrEqual(4.5);
  expect(d).toBeLessThanOrEqual(5.5);
});

it('does not change the input pixels', () => {
  const img = carton();
  const before = new Uint8ClampedArray(img.data);
  boxFaces(img);
  expect(img.data).toEqual(before);
});
