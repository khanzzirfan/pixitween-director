import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { LlmBackend } from '@shared/ports';
import type { ToolDef } from '@shared/tools';
import { loadEnv } from '../env';
import { createMetaClients } from '../meta';
import { MetaApiError } from '../meta/http';
import { createRouter, shouldFallback, type RouterDeps } from './router';

const tool = (name: string): ToolDef => ({ name, description: name, params: z.object({}), run: async () => ({ ok: true }) });
const backend = (id: LlmBackend['id'], behaviour: () => unknown = () => ({ toolCalls: [], content: id, ms: 1 })) => {
  const chat = vi.fn(async (_m: unknown, _t: ToolDef[]) => behaviour() as Awaited<ReturnType<LlmBackend['chatWithTools']>>);
  return { id, chatWithTools: chat as unknown as LlmBackend['chatWithTools'], chat };
};

function setup(o: { local?: boolean; reachable?: boolean; spark?: ReturnType<typeof backend>; sparkReview?: () => Promise<unknown> } = {}) {
  const spark = o.spark ?? backend('spark');
  const glimmer = backend('glimmer');
  const glimmerReview = vi.fn(async () => ({ from: 'glimmer' }));
  const sparkReview = vi.fn(o.sparkReview ?? (async () => ({ from: 'spark' })));
  const deps: RouterDeps = {
    makeSpark: () => spark,
    makeGlimmer: () => glimmer,
    getStatus: async () => ({ reachable: o.reachable ?? true }),
    getLocal: () => o.local ?? false,
    sparkReviewer: () => sparkReview as never,
    glimmerReviewer: () => glimmerReview as never,
  };
  return { router: createRouter(deps), spark, glimmer, glimmerReview, sparkReview };
}

describe('routing table', () => {
  it('uses Spark when Local mode is off, Glimmer for edit and review when it is on', () => {
    expect(setup().router.pickBackend('edit').id).toBe('spark');
    const on = setup({ local: true }).router;
    expect(on.pickBackend('edit').id).toBe('glimmer');
    expect(on.pickReviewer().id).toBe('glimmer');
    expect(on.pickBackend('edit', { local: false }).id).toBe('spark');
    expect(on.pickBackend('storyboard').id).toBe('spark');
    expect(on.pickBackend('storyboard', { local: true }).id).toBe('glimmer');
  });
});

describe('fallback', () => {
  const failing = (err: unknown) => backend('spark', () => {
    throw err;
  });

  it.each([[402], [503]])('falls back on a Meta %i when Glimmer is reachable', async (status) => {
    const { router, glimmer } = setup({ spark: failing(new MetaApiError(status, 'x')) });
    const onFallback = vi.fn();
    const r = await router.pickBackend('edit', { onFallback }).chatWithTools([], []);
    expect(r.content).toBe('glimmer');
    expect(glimmer.chat).toHaveBeenCalledOnce();
    expect(onFallback).toHaveBeenCalledOnce();
    expect(onFallback).toHaveBeenCalledWith(expect.objectContaining({ from: 'spark', to: 'glimmer', reason: expect.stringContaining(String(status)) }));
  });

  it('rethrows a 400 without calling Glimmer', async () => {
    const { router, glimmer } = setup({ spark: failing(new MetaApiError(400, 'bad')) });
    await expect(router.pickBackend('edit').chatWithTools([], [])).rejects.toBeInstanceOf(MetaApiError);
    expect(glimmer.chat).not.toHaveBeenCalled();
  });

  it('falls back on a network failure, but rethrows the original error when Glimmer is down', async () => {
    const netErr = new TypeError('fetch failed');
    expect((await setup({ spark: failing(netErr) }).router.pickBackend('edit', { onFallback: () => undefined }).chatWithTools([], [])).content).toBe('glimmer');
    await expect(setup({ spark: failing(netErr), reachable: false }).router.pickBackend('edit').chatWithTools([], [])).rejects.toBe(netErr);
  });

  it('never falls back when local is false', async () => {
    const { router, glimmer } = setup({ spark: failing(new MetaApiError(503, 'down')) });
    await expect(router.pickBackend('edit', { local: false }).chatWithTools([], [])).rejects.toBeInstanceOf(MetaApiError);
    expect(glimmer.chat).not.toHaveBeenCalled();
  });

  it('shouldFallback only for credit, server and network errors', () => {
    expect(shouldFallback(new MetaApiError(402, ''))).toBe(true);
    expect(shouldFallback(new MetaApiError(404, ''))).toBe(false);
    expect(shouldFallback(Object.assign(new Error('t'), { name: 'TimeoutError' }))).toBe(true);
    expect(shouldFallback(new Error('other'))).toBe(false);
  });
});

describe('local edit tool denylist', () => {
  const all = ['generatePlate', 'setKeyframes', 'replacePlate'].map(tool);

  it('removes art tools for Glimmer but not for Spark', async () => {
    const { router, glimmer, spark } = setup({ local: true });
    await router.pickBackend('edit').chatWithTools([], all);
    expect(glimmer.chat.mock.calls[0]![1].map((t) => t.name)).toEqual(['setKeyframes']);
    await router.pickBackend('edit', { local: false }).chatWithTools([], all);
    expect(spark.chat.mock.calls[0]![1].map((t) => t.name)).toEqual(['generatePlate', 'setKeyframes', 'replacePlate']);
  });
});

describe('pickReviewer', () => {
  it('uses Glimmer in Local mode and never the Spark reviewer', async () => {
    const { router, glimmerReview, sparkReview } = setup({ local: true });
    const r = router.pickReviewer();
    expect(await r.reviewImages([], 'p')).toEqual({ from: 'glimmer' });
    expect(glimmerReview).toHaveBeenCalled();
    expect(sparkReview).not.toHaveBeenCalled();
  });

  it('uses Spark with the same arguments when Local mode is off', async () => {
    const { router, sparkReview } = setup();
    const imgs = [Buffer.from('a')];
    const r = router.pickReviewer();
    expect(r.id).toBe('spark');
    await r.reviewImages(imgs, 'p', { type: 'object' });
    expect(sparkReview).toHaveBeenCalledWith(imgs, 'p', { type: 'object' });
  });

  it('falls back on a 402 and rethrows a 400 or an explicit local false', async () => {
    const onFallback = vi.fn();
    const credit = setup({ sparkReview: async () => { throw new MetaApiError(402, 'x'); } });
    expect(await credit.router.pickReviewer({ onFallback }).reviewImages([], 'p')).toEqual({ from: 'glimmer' });
    expect(onFallback).toHaveBeenCalledOnce();
    await expect(setup({ sparkReview: async () => { throw new MetaApiError(400, 'x'); } }).router.pickReviewer().reviewImages([], 'p')).rejects.toBeInstanceOf(MetaApiError);
    const strict = setup({ sparkReview: async () => { throw new MetaApiError(503, 'x'); } });
    await expect(strict.router.pickReviewer({ local: false }).reviewImages([], 'p')).rejects.toBeInstanceOf(MetaApiError);
    expect(strict.glimmerReview).not.toHaveBeenCalled();
  });
});

it('createMetaClients builds the four clients', () => {
  const clients = createMetaClients(loadEnv({ META_API_KEY: 'k' }));
  expect(Object.keys(clients).sort()).toEqual(['image', 'sam', 'spark', 'transcribe']);
});

it('sends only chat edits to Spark Open when EDIT_BACKEND=spark-open, and needs the key', async () => {
  const saved = { ...process.env };
  try {
    process.env.EDIT_BACKEND = 'spark-open';
    process.env.META_API_KEY = 'm';
    process.env.BASETEN_API_KEY = 'b';
    vi.resetModules();
    const { pickBackend: pick } = await import('./router');
    expect(pick('edit').id).toBe('spark-open');
    expect(pick('edit')).toBe(pick('edit'));
    for (const task of ['storyboard', 'build', 'review'] as const) expect(pick(task).id).toBe('spark');

    delete process.env.BASETEN_API_KEY;
    vi.resetModules();
    const { pickBackend: pickNoKey } = await import('./router');
    expect(() => pickNoKey('edit')).toThrow(/BASETEN_API_KEY/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    vi.resetModules();
  }
});
