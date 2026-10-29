import { describe, expect, it, vi } from 'vitest';
import type { Hono } from 'hono';
import type { AppDeps } from './http/deps';

const resumeGenerations = vi.fn(async () => 0);
vi.mock('./tools/generate', () => ({ resumeGenerations }));

describe('bootHooks', () => {
  it('includes the generation resume hook, which gets the ctx factory', async () => {
    const { bootHooks } = await import('./boot');
    const deps = { makeToolCtx: vi.fn() } as unknown as AppDeps;
    for (const hook of bootHooks) await hook({ app: {} as Hono, deps });
    expect(resumeGenerations).toHaveBeenCalledWith(deps.makeToolCtx);
  });
});
