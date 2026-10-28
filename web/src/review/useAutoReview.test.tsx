import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FilmEvent } from '@shared/events';
import type { ReviewCapture } from '../capture/driver';
import { buildReviewForm, useAutoReview, type ReviewDeps } from './useAutoReview';

const FILM = 'film_000000000001';
const at = new Date(0).toISOString();
const status = (s: 'building' | 'ready' | 'reviewing'): FilmEvent => ({ filmId: FILM, at, type: 'film.status', status: s });
const capture = (n: number): ReviewCapture => ({
  frames: Array.from({ length: n }, (_, i) => ({
    sceneId: i < 3 ? 's1' : 's2',
    atSec: 0.8 + i,
    blob: new Blob(['x'], { type: 'image/png' }),
    unstable: false,
  })),
  textBoxes: {},
});

function setup(initial: FilmEvent[] = [status('building')]) {
  const postFrames = vi.fn(async (_id: string, _form: FormData) => ({ geometry: { maxRelError: 0.01, layers: 1 } }));
  const deps: ReviewDeps = { capture: async () => capture(6), postFrames };
  const hook = renderHook(({ events }: { events: FilmEvent[] }) => useAutoReview({ filmId: FILM, events, deps }), {
    initialProps: { events: initial },
  });
  return { ...hook, postFrames };
}

describe('useAutoReview', () => {
  it('stays idle until the film is ready, then posts before frames once', async () => {
    const { result, rerender, postFrames } = setup();
    expect(result.current.state).toBe('idle');
    expect(postFrames).not.toHaveBeenCalled();
    rerender({ events: [status('building'), status('ready')] });
    await waitFor(() => expect(postFrames).toHaveBeenCalledTimes(1));
    const form = postFrames.mock.calls[0]![1] as FormData;
    expect(form.getAll('frames')).toHaveLength(6);
    expect(form.get('phase')).toBe('before');
    expect(result.current.geometry).toEqual({ maxRelError: 0.01, layers: 1 });
  });

  it('posts an after review once the reviewing film is ready again, then ignores later ready events', async () => {
    const { result, rerender, postFrames } = setup();
    rerender({ events: [status('building'), status('ready')] });
    await waitFor(() => expect(postFrames).toHaveBeenCalledTimes(1));
    rerender({ events: [status('building'), status('ready'), status('reviewing')] });
    rerender({ events: [status('building'), status('ready'), status('reviewing'), status('ready')] });
    await waitFor(() => expect(result.current.state).toBe('done'));
    expect(postFrames).toHaveBeenCalledTimes(2);
    expect((postFrames.mock.calls[1]![1] as FormData).get('phase')).toBe('after');
    rerender({ events: [status('building'), status('ready'), status('reviewing'), status('ready'), status('ready')] });
    expect(postFrames).toHaveBeenCalledTimes(2);
  });

  it('re-runs with a new before form even after a review finished', async () => {
    const { result, rerender, postFrames } = setup();
    rerender({ events: [status('building'), status('ready')] });
    await waitFor(() => expect(postFrames).toHaveBeenCalledTimes(1));
    rerender({ events: [status('building'), status('ready'), status('reviewing'), status('ready')] });
    await waitFor(() => expect(result.current.state).toBe('done'));
    await act(async () => result.current.rerun());
    await waitFor(() => expect(postFrames).toHaveBeenCalledTimes(3));
    expect((postFrames.mock.calls[2]![1] as FormData).get('phase')).toBe('before');
  });

  it('goes to error and starts nothing more when posting fails', async () => {
    const postFrames = vi.fn(async (_id: string, _form: FormData) => {
      throw new Error('nope');
    });
    const deps: ReviewDeps = { capture: async () => capture(6), postFrames };
    const { result, rerender } = renderHook(({ events }: { events: FilmEvent[] }) => useAutoReview({ filmId: FILM, events, deps }), {
      initialProps: { events: [status('building')] },
    });
    rerender({ events: [status('building'), status('ready')] });
    await waitFor(() => expect(result.current.state).toBe('error'));
    rerender({ events: [status('building'), status('ready'), status('reviewing'), status('ready')] });
    expect(postFrames).toHaveBeenCalledTimes(1);
  });

  it('does not review a film whose events already show an earlier review', async () => {
    const { result, postFrames } = setup([status('reviewing'), status('ready')]);
    expect(result.current.state).toBe('idle');
    expect(postFrames).not.toHaveBeenCalled();
  });
});

describe('buildReviewForm', () => {
  it('names each frame by its scene and time, and sends the text boxes only with a before batch', () => {
    const c = capture(2);
    c.textBoxes = { 's1:caption': { frame: 24, box: { left: 1, top: 2, right: 3, bottom: 4 } } };
    const before = buildReviewForm(c, 'before');
    expect(JSON.parse(String(before.get('meta')))).toEqual([
      { sceneId: 's1', atSec: 0.8 },
      { sceneId: 's1', atSec: 1.8 },
    ]);
    expect(before.get('textBoxes')).toBeTruthy();
    expect(buildReviewForm(c, 'after').get('textBoxes')).toBeNull();
  });
});
