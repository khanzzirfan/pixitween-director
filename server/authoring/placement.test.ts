import { expect, it } from 'vitest';
import { boxToImageTransform, boxToShape, boxToText, defaultBox, fitRect, textSize } from './placement';

const mug = { width: 384, height: 672 };
const W = 1920;
const H = 1080;
const near = (a: number, b: number, d = 0.01) => expect(Math.abs(a - b)).toBeLessThan(d);

it('default boxes', () => {
  expect(defaultBox('product', W, H)).toEqual({ x: 288, y: 226.8, w: 1344, h: 669.6 });
  expect(defaultBox('headline', W, H)).toEqual({ x: 192, y: 86.4, w: 1536, h: 172.8 });
});
it('contain fit of the mug in the product box', () => {
  const r = fitRect(mug, defaultBox('product', W, H), 'contain');
  near(r.h, 669.6);
  near(r.w, 382.63); // the story says 382.6 within 0.01, but 384*669.6/672 = 382.6286
  near(r.x, 768.69);
  const t = boxToImageTransform(mug, r);
  expect(t.position).toEqual([960, 561.6]);
  expect(t.anchor).toEqual([192, 336]);
  near(t.scale[0], 0.9964, 1e-4);
  near(t.scale[1], 0.9964, 1e-4);
});
it('an explicit rect is used exactly (top-left, non-uniform scale)', () => {
  const t = boxToImageTransform(mug, { x: 100, y: 100, w: 384, h: 336 });
  expect(t).toEqual({ position: [292, 268], anchor: [192, 336], scale: [1, 0.5] });
});
it('cover fit', () => {
  const box = defaultBox('bg', W, H);
  const r = fitRect(mug, box, 'cover');
  expect([r.w, r.h]).toEqual([1920, 3360]);
  near(r.x + r.w / 2, box.x + box.w / 2, 1e-9);
  near(r.y + r.h / 2, box.y + box.h / 2, 1e-9);
});
it('shape and text placement', () => {
  expect(boxToShape(defaultBox('bg', W, H))).toEqual({ position: [960, 540], anchor: [960, 540], size: [1920, 1080] });
  expect(boxToText(defaultBox('headline', W, H), W, H)).toEqual({ position: [960, 172.8], anchor: [960, 540], boxWidth: 1536 });
  expect(textSize('headline', H)).toBe(76);
  expect(textSize('caption', H)).toBe(43);
});
it('9:16 product centre', () => {
  const b = defaultBox('product', 1080, 1920);
  expect([b.x + b.w / 2, b.y + b.h / 2].map((n) => Math.round(n * 10) / 10)).toEqual([540, 998.4]);
});
