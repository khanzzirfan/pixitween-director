import { expect, it } from 'vitest';
import { describe, estimateUsd, run } from './s22-ai-video';

it('estimates the most a clip can cost at each resolution', () => {
  expect(estimateUsd([])).toBe(0.75);
  expect(estimateUsd(['--res=768P'])).toBe(1.2);
  expect(() => estimateUsd(['--res=4K'])).toThrow('--res must be one of');
});

it('names Fal and the film it needs', () => {
  expect(describe()).toContain('--film=<film id>');
});

it('refuses to run without a Fal key in the shell, or without a film', async () => {
  const log = () => undefined;
  const saved = process.env.FAL_API_KEY;
  try {
    delete process.env.FAL_API_KEY;
    await expect(run({ env: {} as never, log, args: ['--film=film_0123456789ab'] })).rejects.toThrow('FAL_API_KEY is required');
    process.env.FAL_API_KEY = 'fal-key-1234567890';
    await expect(run({ env: {} as never, log, args: [] })).rejects.toThrow('Pass --film=');
    await expect(run({ env: {} as never, log, args: ['--film=nope'] })).rejects.toThrow('Pass --film=');
  } finally {
    if (saved === undefined) delete process.env.FAL_API_KEY;
    else process.env.FAL_API_KEY = saved;
  }
});
