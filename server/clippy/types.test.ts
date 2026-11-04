import { describe, expect, it } from 'vitest';
import { fixturePath } from '../test-utils/fixtures';
import { readFileSync } from 'node:fs';
import { animateImageArgsSchema, balanceResultSchema, statusResultSchema, submitResultSchema } from './types';

const fast = { model: 'fast-h3', prompt: 'x', sourceImageUrl: 'https://a.example/i.jpg', durationSec: 5.2, aspect: '16:9' } as const;
const omni = { model: 'fast-h3-omni', prompt: 'x', imageUrls: ['https://a.example/i.jpg'], durationSec: 8, aspect: '9:16' } as const;
const ok = (v: unknown) => animateImageArgsSchema.safeParse(v).success;
const fx = (n: string) => JSON.parse(readFileSync(fixturePath('s07a', n), 'utf8'));

describe('animateImageArgsSchema', () => {
  it('fast-h3', () => {
    expect(ok(fast)).toBe(true);
    expect(ok({ ...fast, sourceImageUrl: 'http://a.example/i.jpg' })).toBe(false);
    expect(ok({ ...fast, prompt: 'x'.repeat(801) })).toBe(false);
    expect(ok({ ...fast, durationSec: 5.1 })).toBe(false);
    expect(ok({ ...fast, imageUrls: ['https://a.example/1.jpg', 'https://a.example/2.jpg'] })).toBe(false);
  });
  it('omni durations and image counts', () => {
    expect(ok({ ...omni, durationSec: 8 })).toBe(true);
    expect(ok({ ...omni, durationSec: 5.875 })).toBe(true);
    expect(ok({ ...omni, durationSec: 10 })).toBe(false);
    expect(ok({ ...omni, durationSec: 9.99 })).toBe(false);
    const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://a.example/${i}.jpg`);
    expect(ok({ ...omni, imageUrls: urls(9) })).toBe(true);
    expect(ok({ ...omni, imageUrls: urls(10) })).toBe(false);
    expect(ok({ ...omni, imageUrls: [] })).toBe(false);
    expect(ok({ ...omni, aspect: '4:3' })).toBe(true);
    expect(ok({ ...fast, aspect: '4:3' })).toBe(false);
  });
  it('idempotency keys', () => {
    expect(ok({ ...fast, idempotencyKey: 'film1:s2:1' })).toBe(true);
    expect(ok({ ...fast, idempotencyKey: 'short' })).toBe(false);
    expect(ok({ ...fast, idempotencyKey: 'has space in it' })).toBe(false);
  });
});

describe('fixtures', () => {
  it('parse with their schemas', () => {
    expect(submitResultSchema.parse(fx('submit-result.json')).jobId).toBe('job_test_1');
    expect(statusResultSchema.parse(fx('status-done.json')).resultUrl).toContain('https://');
    expect(statusResultSchema.parse(fx('status-rendering.json')).resultUrl).toBeNull();
    expect(balanceResultSchema.parse(fx('balance.json')).currentBalance).toBe(120);
  });
  it('rejects an unknown status', () => expect(statusResultSchema.safeParse({ jobId: 'j', status: 'unknown', resultUrl: null }).success).toBe(false));
});
