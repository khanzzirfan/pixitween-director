// The page's side of the AI movie: ask what it would cost, start it, poll until Fal is done. The video itself is served from this origin.
import type { AiVideoJob, AiVideoQuote, AiVideoResolution } from '@shared/api';
import { credentialHeaders } from '../settings/access';

export class AiVideoError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'AiVideoError';
    this.code = code;
  }
}

const REFUSALS: Record<string, string> = {
  video_key_missing: 'Add your Fal key in Settings first.',
  ip_locked: 'Your Fal key was saved on another network. Save it again in Settings.',
  no_frames: 'This film has no pictures to make an AI movie from yet.',
  nothing_to_make: 'Nothing to make a movie from yet.',
};

async function fail(res: Response): Promise<never> {
  const b = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  throw new AiVideoError(b.message ?? REFUSALS[b.error ?? ''] ?? `The AI movie failed (${res.status}).`, b.error);
}

export async function fetchAiVideoQuote(filmId: string, resolution: AiVideoResolution, f: typeof fetch = fetch): Promise<AiVideoQuote> {
  const res = await f(`/api/films/${filmId}/ai-video/quote?resolution=${resolution}`, { headers: credentialHeaders() });
  if (!res.ok) await fail(res);
  return (await res.json()) as AiVideoQuote;
}

export async function startAiVideo(filmId: string, resolution: AiVideoResolution, f: typeof fetch = fetch): Promise<AiVideoJob> {
  const res = await f(`/api/films/${filmId}/ai-video`, { method: 'POST', headers: { ...credentialHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ resolution }) });
  if (!res.ok) await fail(res);
  return (await res.json()) as AiVideoJob;
}

export async function getAiVideo(id: string, f: typeof fetch = fetch): Promise<AiVideoJob> {
  const res = await f(`/api/ai-videos/${id}`);
  if (!res.ok) await fail(res);
  return (await res.json()) as AiVideoJob;
}

/** Polls until the job succeeds or fails. A clip takes minutes, so it polls slowly and gives up on a lost server after a few misses in a row. */
export async function pollAiVideo(
  id: string,
  o: { onView(v: AiVideoJob): void; signal?: AbortSignal; intervalMs?: number; fetch?: typeof fetch },
): Promise<AiVideoJob> {
  const every = o.intervalMs ?? 4000;
  let misses = 0;
  for (;;) {
    if (o.signal?.aborted) throw new AiVideoError('Stopped waiting.', 'aborted');
    try {
      const v = await getAiVideo(id, o.fetch);
      misses = 0;
      o.onView(v);
      if (v.status === 'succeeded' || v.status === 'failed') return v;
    } catch (e) {
      // a refusal (a lost key, a locked network) will not get better by asking again
      if (e instanceof AiVideoError && e.code) throw e;
      if (++misses >= 5) throw e instanceof Error ? e : new AiVideoError('Lost contact with the server.');
    }
    await new Promise((r) => setTimeout(r, every));
  }
}
