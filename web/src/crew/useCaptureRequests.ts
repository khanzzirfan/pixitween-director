// Owned by S12d. Answers the critic's capture requests with frames of the real canvas, one request at a time.
import { useEffect, useRef } from 'react';
import type { Storyboard } from '@shared/storyboard';
import { api } from '../api/client';
import { captureScene, waitForPlayer } from '../capture/driver';
import type { ReviewCapture } from '../capture/driver';
import type { PlayerHandle } from '../player/Player';
import type { CaptureRequest } from './crewReducer';

export interface CaptureDeps {
  capture(player: PlayerHandle, storyboard: Storyboard, req: CaptureRequest): Promise<ReviewCapture>;
  post(filmId: string, form: FormData): Promise<unknown>;
}
const defaultDeps: CaptureDeps = {
  capture: (player, storyboard, req) => captureScene(player, storyboard, req.sceneId, req.timesSec),
  post: (filmId, form) => api.postFrames(filmId, form),
};

export function buildCaptureForm(requestId: string, capture: ReviewCapture): FormData {
  const form = new FormData();
  const frames = capture.frames.filter((f) => !f.blank);
  form.set('phase', 'before');
  form.set('requestId', requestId);
  for (const [i, f] of frames.entries()) form.append('frames', f.blob, `frame-${i + 1}.png`);
  form.set('meta', JSON.stringify(frames.map((f) => ({ sceneId: f.sceneId, atSec: f.atSec }))));
  if (Object.keys(capture.textBoxes).length) form.set('textBoxes', JSON.stringify(capture.textBoxes));
  return form;
}

const nap = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Pauses the player, captures, then puts the time and the play state back. */
export async function answerCapture(o: { filmId: string; req: CaptureRequest; storyboard: Storyboard; getPlayer(): PlayerHandle | null; deps?: CaptureDeps; sampleMs?: number }): Promise<void> {
  const deps = o.deps ?? defaultDeps;
  const player = await waitForPlayer(o.getPlayer);
  const t1 = player.getTime();
  await nap(o.sampleMs ?? 60);
  const wasPlaying = player.getTime() !== t1;
  const returnTo = player.getTime();
  player.pause();
  try {
    const capture = await deps.capture(player, o.storyboard, o.req);
    await deps.post(o.filmId, buildCaptureForm(o.req.requestId, capture));
  } finally {
    player.seek(returnTo);
    if (wasPlaying) player.play();
  }
}

/** A request older than this is a replayed one: nobody is waiting for it any more. */
export const CAPTURE_MAX_AGE_MS = 120_000;

export function useCaptureRequests(o: {
  filmId: string | null | undefined;
  requests: CaptureRequest[];
  storyboard?: Storyboard;
  getPlayer(): PlayerHandle | null;
  deps?: CaptureDeps;
  maxAgeMs?: number;
  sampleMs?: number;
  onError?(e: unknown): void;
}): void {
  const handled = useRef(new Set<string>());
  const chain = useRef<Promise<void>>(Promise.resolve());
  const ref = useRef(o);
  ref.current = o;

  useEffect(() => {
    const { filmId, storyboard } = o;
    if (!filmId || !storyboard) return;
    for (const req of o.requests) {
      if (handled.current.has(req.requestId)) continue;
      handled.current.add(req.requestId);
      if (Date.now() - Date.parse(req.at) > (o.maxAgeMs ?? CAPTURE_MAX_AGE_MS)) continue;
      chain.current = chain.current.then(() =>
        answerCapture({ filmId, req, storyboard: ref.current.storyboard ?? storyboard, getPlayer: () => ref.current.getPlayer(), deps: o.deps, sampleMs: o.sampleMs }).catch((e: unknown) => ref.current.onError?.(e)),
      );
    }
  }, [o.requests, o.storyboard, o.filmId]);
}
