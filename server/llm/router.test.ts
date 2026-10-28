import { expect, it, vi } from 'vitest';
import { NotImplementedError } from '../errors';
import { loadEnv } from '../env';
import { createMetaClients } from '../meta';
import { createGlimmerBackend } from './glimmer-backend';
import { pickBackend, pickReviewer } from './router';

it('always returns the Spark singleton in S2', () => {
  for (const task of ['storyboard', 'build', 'edit', 'review'] as const) {
    expect(pickBackend(task).id).toBe('spark');
    expect(pickBackend(task, { local: true }).id).toBe('spark');
  }
  expect(pickBackend('build')).toBe(pickBackend('edit'));
});

it('pickReviewer exposes reviewImages and never falls back', () => {
  const onFallback = vi.fn();
  void onFallback;
  expect(typeof pickReviewer().reviewImages).toBe('function');
  expect(typeof pickReviewer({ local: true }).reviewImages).toBe('function');
  pickBackend('review', { onFallback });
  expect(onFallback).not.toHaveBeenCalled();
});

it('the Glimmer stub is owned by S9', async () => {
  const e = await createGlimmerBackend().chatWithTools([], []).catch((err) => err);
  expect(e).toBeInstanceOf(NotImplementedError);
  expect(e.step).toBe('S9');
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
