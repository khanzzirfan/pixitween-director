import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import type { ChatResponse, MetaClients, SamObject } from '@shared/ports';
import { imageSize } from '../media/image';

export interface FakeMetaOptions {
  sparkScript?: ChatResponse[];
  reviewScript?: unknown[];
  samObjects?: SamObject[];
  transcript?: string;
}
export type FakeCall = { client: string; method: string; args: unknown };

const png64 = () => sharp({ create: { width: 64, height: 64, channels: 3, background: '#808080' } }).png().toBuffer();

/** Offline stand-in for the Meta clients. Records every call in `calls`. */
export function makeFakeMeta(o: FakeMetaOptions = {}): MetaClients & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const spark = [...(o.sparkScript ?? [])];
  const review = [...(o.reviewScript ?? [])];
  const rec = <A extends unknown[], R>(client: string, method: string, fn: (...a: A) => Promise<R>) => (...args: A): Promise<R> => {
    calls.push({ client, method, args });
    return fn(...args);
  };

  return {
    calls,
    spark: {
      chat: rec('spark', 'chat', async () => {
        const next = spark.shift();
        if (!next) throw new Error('FakeMeta: sparkScript exhausted');
        return next;
      }),
      reviewImages: rec('spark', 'reviewImages', async () => (review.length ? review.shift() : { pass: true, issues: [] })),
      video: rec('spark', 'video', async () => 'fake video summary'),
    },
    image: {
      edit: rec('image', 'edit', () => png64()),
      generate: rec('image', 'generate', () => png64()),
    },
    sam: {
      segmentImage: rec('sam', 'segmentImage', async (img: Buffer) => {
        if (o.samObjects) return o.samObjects;
        const { width, height } = await imageSize(img);
        const bounds = { left: Math.floor(width / 4), top: Math.floor(height / 4), right: Math.floor((width * 3) / 4), bottom: Math.floor((height * 3) / 4) };
        const alpha = Buffer.alloc(width * height);
        for (let y = bounds.top; y < bounds.bottom; y++) alpha.fill(255, y * width + bounds.left, y * width + bounds.right);
        return [{ objectId: '0', bounds, alpha, confidence: 0.95 }];
      }),
      trackVideo: rec('sam', 'trackVideo', async () => ({ frames: 30, framesWithObject: Array.from({ length: 30 }, (_, i) => i), objectIds: ['0'] })),
    },
    transcribe: {
      file: rec('transcribe', 'file', async () => ({ transcript: o.transcript ?? 'a fixed fake transcript', turns: [], audioDurationMs: 1000 })),
    },
  };
}
