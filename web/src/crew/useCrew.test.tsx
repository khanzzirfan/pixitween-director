import { renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { postStoryboard } from './api';
import { useCrew } from './useCrew';
import { FIXTURE } from './test-fixture';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('folds the fixture to 5 scenes with no network request', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() => useCrew('film_0123456789ab', FIXTURE));
  expect(result.current.crew.storyboard?.scenes).toHaveLength(5);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('posts the storyboard ops with the passcode header when one is stored', async () => {
  localStorage.setItem('director.passcode', 'sesame');
  const fetchMock = vi.fn(async () => new Response('{"rev":3}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const ops = [{ op: 'remove', sceneId: 's4' }] as const;
  await postStoryboard('f1', [...ops]);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/api/films/f1/storyboard');
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body as string)).toEqual({ ops });
  expect((init.headers as Record<string, string>)['x-director-passcode']).toBe('sesame');
});

it('gives actions bound to the film', async () => {
  const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() => useCrew('film_0123456789ab', []));
  await result.current.actions!.cancelJob('j3');
  expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/api/films/film_0123456789ab/jobs/j3/cancel');
  expect(renderHook(() => useCrew(null, [])).result.current.actions).toBeNull();
});
