import { expect, it } from 'vitest';
import { imageSize } from '../media/image';
import { readSeedBuffer } from '../test-utils/fixtures';
import { makeFakeMeta } from './fakes';

const resp = (content: string) => ({ content, toolCalls: [], ms: 1, model: 'fake' });

it('consumes the spark script in order, then throws', async () => {
  const m = makeFakeMeta({ sparkScript: [resp('a'), resp('b')] });
  expect((await m.spark.chat({ messages: [] })).content).toBe('a');
  expect((await m.spark.chat({ messages: [] })).content).toBe('b');
  await expect(m.spark.chat({ messages: [] })).rejects.toThrow('sparkScript exhausted');
});

it('segments the central half of the image by default', async () => {
  const m = makeFakeMeta();
  const [o] = await m.sam.segmentImage(readSeedBuffer('cafe-with-mug.jpg'), 'mug');
  expect(o!.bounds).toEqual({ left: 240, top: 160, right: 720, bottom: 480 });
  expect(o!.alpha.length).toBe(960 * 640);
  expect(o!.alpha[320 * 960 + 480]).toBe(255);
  expect(o!.alpha[0]).toBe(0);
});

it('has sensible defaults and records calls', async () => {
  const m = makeFakeMeta({ reviewScript: [{ pass: false }] });
  expect(await imageSize(await m.image.generate('x'))).toEqual({ width: 64, height: 64, mime: 'image/png' });
  expect(await m.spark.reviewImages([], 'p')).toEqual({ pass: false });
  expect(await m.spark.reviewImages([], 'p')).toEqual({ pass: true, issues: [] });
  expect((await m.sam.trackVideo(Buffer.alloc(1), 'x')).framesWithObject).toHaveLength(30);
  expect((await m.transcribe.file(Buffer.alloc(1), {})).transcript).toBeTruthy();
  expect(m.calls.map((c) => `${c.client}.${c.method}`)).toEqual(['image.generate', 'spark.reviewImages', 'spark.reviewImages', 'sam.trackVideo', 'transcribe.file']);
});
