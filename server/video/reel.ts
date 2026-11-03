// Start and poll a 9:16 reel with the key that belongs to one session. Callers pass that key in. This module does not read the environment.
import type { VideoJobResponse, VideoProvider } from '@shared/api';
import { createFalClient, falReel, type FalHandle } from '../fal/client';
import { FalApiError } from '../fal/errors';
import { createHiggsfieldClient, higgsfieldReel, type HiggsfieldHandle } from '../higgsfield/client';
import { HiggsfieldApiError } from '../higgsfield/errors';
import { createRevanaClient } from '../revana/client';
import { RevanaApiError } from '../revana/errors';
import type { VideoSecrets } from './session';

export class VideoKeyMissingError extends Error {
  readonly provider: VideoProvider;
  constructor(provider: VideoProvider) {
    super(`${provider} key is not saved for this session`);
    this.name = 'VideoKeyMissingError';
    this.provider = provider;
  }
}

export interface ReelRequest {
  provider: VideoProvider;
  prompt: string;
  imageUrl?: string;
  duration?: number;
}

export interface StartedReel {
  fal?: FalHandle;
  higgsfield?: HiggsfieldHandle;
  revana?: { generationId: string };
}

export interface PollOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function keyFor(keys: VideoSecrets, provider: VideoProvider): string {
  const key = keys[provider];
  if (!key) throw new VideoKeyMissingError(provider);
  return key;
}

/** Submit a 9:16 reel. Revana uses the free MiniMax H3 model, which takes a still and not a movie. */
export async function startReel(keys: VideoSecrets, req: ReelRequest, opts: PollOptions = {}): Promise<StartedReel> {
  const key = keyFor(keys, req.provider);
  if (req.provider === 'fal') {
    const reel = falReel(req);
    const handle = await createFalClient({ apiKey: key, fetchImpl: opts.fetchImpl }).submit(reel.model, reel.input, { signal: opts.signal });
    return { fal: handle };
  }
  if (req.provider === 'higgsfield') {
    const reel = higgsfieldReel(req);
    const handle = await createHiggsfieldClient({ apiKey: key, fetchImpl: opts.fetchImpl }).submit(reel.endpoint, reel.input, { signal: opts.signal });
    return { higgsfield: handle };
  }
  const duration = clamp(req.duration ?? 6, 5, 15);
  const input: Record<string, unknown> = { prompt: req.prompt, duration, resolution: '768p', aspect_ratio: '9:16' };
  if (req.imageUrl) input.image_url = req.imageUrl;
  const client = createRevanaClient({ apiKey: key, fetchImpl: opts.fetchImpl });
  const quote = await client.quote('minimax-h3-free', input, { maxCostUsd: 0.01, signal: opts.signal });
  if (quote.enough_credit === false) throw new RevanaApiError('Not enough Revana credit for this reel', 402, 'insufficient_credits');
  const generation = await client.submit('minimax-h3-free', input, { maxCostUsd: 0.01, signal: opts.signal });
  return { revana: { generationId: generation.id } };
}

function falStatus(status: string): VideoJobResponse['status'] {
  if (status === 'COMPLETED') return 'succeeded';
  if (status === 'FAILED' || status === 'CANCELLED') return 'failed';
  if (status === 'IN_PROGRESS') return 'running';
  return 'queued';
}

function higgsfieldStatus(status: string): VideoJobResponse['status'] {
  if (status === 'completed') return 'succeeded';
  if (status === 'failed' || status === 'nsfw' || status === 'canceled') return 'failed';
  if (status === 'in_progress' || status === 'processing') return 'running';
  return 'queued';
}

function revanaStatus(status: string): VideoJobResponse['status'] {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed') return 'failed';
  if (status === 'running') return 'running';
  return 'queued';
}

/** One poll. The key is the session key, checked by the caller against the IP lock before this runs. */
export async function pollReel(keys: VideoSecrets, provider: VideoProvider, remote: StartedReel, opts: PollOptions = {}): Promise<Pick<VideoJobResponse, 'status' | 'videoUrl'>> {
  const key = keyFor(keys, provider);
  if (provider === 'fal' && remote.fal) {
    const client = createFalClient({ apiKey: key, fetchImpl: opts.fetchImpl });
    const status = await client.status(remote.fal, { signal: opts.signal });
    const mapped = falStatus(status.status);
    if (mapped !== 'succeeded') return { status: mapped };
    const result = await client.result(remote.fal, { signal: opts.signal });
    return { status: 'succeeded', ...(result.videoUrl ? { videoUrl: result.videoUrl } : {}) };
  }
  if (provider === 'higgsfield' && remote.higgsfield) {
    const status = await createHiggsfieldClient({ apiKey: key, fetchImpl: opts.fetchImpl }).status(remote.higgsfield, { signal: opts.signal });
    const mapped = higgsfieldStatus(status.status);
    return { status: mapped, ...(mapped === 'succeeded' && status.videoUrl ? { videoUrl: status.videoUrl } : {}) };
  }
  if (provider === 'revana' && remote.revana) {
    const generation = await createRevanaClient({ apiKey: key, fetchImpl: opts.fetchImpl }).get(remote.revana.generationId, { signal: opts.signal });
    const url = generation.output?.urls?.[0];
    return { status: revanaStatus(generation.status), ...(url ? { videoUrl: url } : {}) };
  }
  return { status: 'failed' };
}

export function providerFailure(error: unknown): { status: number; error: string; message?: string } {
  if (error instanceof VideoKeyMissingError) return { status: 409, error: 'video_key_missing' };
  if (error instanceof FalApiError || error instanceof HiggsfieldApiError || error instanceof RevanaApiError) {
    return { status: error.status >= 400 && error.status < 600 ? error.status : 502, error: error.code, message: error.message };
  }
  return { status: 502, error: 'video_failed' };
}
