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
