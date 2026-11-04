import { expect, it } from 'vitest';
import { readSeedText } from '../test-utils/fixtures';
import { parseSamImageEvents, parseSamVideoEvents } from './sam';

it('parses the product image stream', async () => {
  const objs = await parseSamImageEvents(readSeedText('sam-image-product.sse.txt'));
  expect(objs).toHaveLength(1);
  const o = objs[0]!;
  expect(o.objectId).toBe('0');
  expect(o.bounds).toEqual({ left: 180, top: 705, right: 702, bottom: 1137 });
  expect(Math.abs(o.confidence! - 0.9649)).toBeLessThan(0.001);
  const W = 768;
  expect(o.alpha.length).toBe(W * 1344);
  let inside = 0;
  let outside = 0;
  for (let y = 0; y < 1344; y++) {
    for (let x = 0; x < W; x++) {
      if (!o.alpha[y * W + x]) continue;
      const inBox = x >= 180 && x < 702 && y >= 705 && y < 1137;
      if (inBox) inside++;
      else outside++;
    }
  }
  expect(outside).toBe(0);
  expect(inside / (522 * 432)).toBeGreaterThan(0.4);
});

it('parses the scene image stream', async () => {
  const [o] = await parseSamImageEvents(readSeedText('sam-image-scene.sse.txt'));
  expect(o!.bounds).toEqual({ left: 725, top: 599, right: 1338, bottom: 1101 });
  expect(o!.alpha.length).toBe(1920 * 1280);
});

it('parses the truncated video stream without throwing', async () => {
  const r = await parseSamVideoEvents(readSeedText('sam-video-truncated.sse.txt'));
  expect(r.objectIds).toEqual(expect.arrayContaining(['0', '1']));
  const max = r.framesWithObject.at(-1)!;
  expect(max).toBeGreaterThanOrEqual(180);
  expect([...r.framesWithObject].sort((a, b) => a - b)).toEqual(r.framesWithObject);
  expect(new Set(r.framesWithObject).size).toBe(r.framesWithObject.length);
  expect(r.frames).toBeGreaterThan(max);
});
