import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppDeps } from './http/deps';

const resumeGenerations = vi.fn(async () => 0);
vi.mock('./tools/generate', () => ({ resumeGenerations }));

describe('bootHooks', () => {
  it('includes the generation resume hook, which gets the ctx factory', async () => {
    const { bootHooks } = await import('./boot');
    const deps = { makeToolCtx: vi.fn(), films: { list: async () => [] } } as unknown as AppDeps;
    for (const hook of bootHooks) await hook({ app: new Hono(), deps });
    expect(resumeGenerations).toHaveBeenCalledWith(deps.makeToolCtx);
  });
});
