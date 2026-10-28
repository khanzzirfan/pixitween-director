import { useEffect, useRef, useState } from 'react';
import type { FilmEvent } from '@shared/events';
import type { ReviewCapture } from '../capture/driver';
import type { FramesResponse } from '../api/client';

export type ReviewState = 'idle' | 'running' | 'done' | 'error';
export interface Geometry {
  maxRelError: number;
  layers: number;
}
export interface ReviewDeps {
  capture(): Promise<ReviewCapture>;
  postFrames(filmId: string, form: FormData): Promise<FramesResponse>;
}

/** Builds the multipart form the frames endpoint takes: one file per frame, with its scene and time. */
export function buildReviewForm(capture: ReviewCapture, phase: 'before' | 'after'): FormData {
  const form = new FormData();
  form.set('phase', phase);
  for (const [i, f] of capture.frames.entries()) form.append('frames', f.blob, `frame-${i + 1}.png`);
  form.set('meta', JSON.stringify(capture.frames.map((f) => ({ sceneId: f.sceneId, atSec: f.atSec }))));
  if (phase === 'before' && Object.keys(capture.textBoxes).length) form.set('textBoxes', JSON.stringify(capture.textBoxes));
  return form;
}

const REVIEW_KINDS = new Set(['review.finding', 'review.fix']);

/**
 * Reviews a film once it is ready: 'before' frames when it first becomes ready, 'after' frames when the review
 * has finished. A film that already has review events (a replayed session) is not reviewed again on its own.
 */
export function useAutoReview(o: { filmId?: string; events: FilmEvent[]; deps: ReviewDeps }): {
  state: ReviewState;
  geometry: Geometry | null;
  error?: string;
  rerun(): void;
} {
  const [state, setState] = useState<ReviewState>('idle');
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [error, setError] = useState<string>();
  const stage = useRef<'idle' | 'posting' | 'awaiting' | 'done' | 'error'>('idle');
  // status events can arrive while the 'before' request is still in flight, so they are tracked either way
  const sawReviewing = useRef(false);
  const readyAfterReview = useRef(false);
  const seen = useRef(0);
  const depsRef = useRef(o.deps);
  depsRef.current = o.deps;
  const filmRef = useRef(o.filmId);
  filmRef.current = o.filmId;
  const geometryRef = useRef<Geometry | null>(null);

  const post = async (phase: 'before' | 'after') => {
    const filmId = filmRef.current;
    if (!filmId) return;
    stage.current = 'posting';
    if (phase === 'before') {
      sawReviewing.current = false;
      readyAfterReview.current = false;
    }
    setState('running');
    try {
      const capture = await depsRef.current.capture();
      const res = await depsRef.current.postFrames(filmId, buildReviewForm(capture, phase));
      if (phase === 'before') {
        if (!geometryRef.current && res.geometry) {
          geometryRef.current = res.geometry;
          setGeometry(res.geometry);
        }
        stage.current = 'awaiting';
        if (readyAfterReview.current) void post('after');
      } else {
        stage.current = 'done';
        setState('done');
      }
    } catch (e) {
      stage.current = 'error';
      const message = e instanceof Error ? e.message : 'review failed';
      setError(message);
      setState('error');
    }
  };

  const rerun = () => {
    if (stage.current === 'posting') return;
    void post('before');
  };

  // a new film starts from idle, so the previous film's review state never leaks into it
  useEffect(() => {
    stage.current = 'idle';
    seen.current = 0;
    geometryRef.current = null;
    setGeometry(null);
    setState('idle');
    setError(undefined);
  }, [o.filmId]);

  useEffect(() => {
    const fresh = o.events.slice(seen.current);
    if (!fresh.length) return;
    if (seen.current === 0 && o.events.some((e) => REVIEW_KINDS.has(e.type) || (e.type === 'film.status' && e.status === 'reviewing'))) {
      stage.current = 'done';
    }
    seen.current = o.events.length;
    for (const e of fresh) {
      if (e.type !== 'film.status') continue;
      if (stage.current === 'idle' && e.status === 'ready') void post('before');
      else if (stage.current === 'awaiting' || stage.current === 'posting') {
        if (e.status === 'reviewing') sawReviewing.current = true;
        else if (e.status === 'ready' && sawReviewing.current) {
          readyAfterReview.current = true;
          if (stage.current === 'awaiting') void post('after');
        }
      }
    }
  }, [o.events]);

  return { state, geometry, error, rerun };
}
