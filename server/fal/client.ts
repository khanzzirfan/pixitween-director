// Fal queue client. Auth is `Authorization: Key <fal key>`. Status and result URLs are followed only on the queue host.
import { FalApiError, FalTimeoutError } from './errors';

export const FAL_QUEUE_ORIGIN = 'https://queue.fal.run';
const MODEL_ID = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)+$/;
const MAX_TRANSIENT = 3;

export interface FalClientConfig {
  apiKey: string;
  /** Queue origin, including scheme. Tests point this at a local server. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface FalHandle {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
  cancelUrl?: string;
}

export interface FalStatus {
  status: string;
  queuePosition?: number;
}

export interface FalResult {
  videoUrl?: string;
  raw: unknown;
}

export interface FalClient {
  submit(model: string, input: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<FalHandle>;
  status(handle: FalHandle, opts?: { signal?: AbortSignal }): Promise<FalStatus>;
  result(handle: FalHandle, opts?: { signal?: AbortSignal }): Promise<FalResult>;
  waitFor(handle: FalHandle, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<FalResult>;
}

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function owned(url: string, origin: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new FalApiError('Fal returned a status URL that is not a URL', 502, 'bad_url');
  }
  if (parsed.origin !== new URL(origin).origin) throw new FalApiError('Refusing a Fal URL on another host', 502, 'bad_url');
  return parsed;
}

async function readError(res: Response): Promise<FalApiError> {
  let message = `Fal ${res.status}`;
  try {
    const body = (await res.json()) as { detail?: unknown; error?: unknown; message?: unknown };
    const detail = body.detail ?? body.error ?? body.message;
    if (typeof detail === 'string' && detail.trim()) message = detail.slice(0, 300);
  } catch {
    /* a non-JSON body still becomes an error with the status */
  }
  return new FalApiError(message, res.status, res.status === 401 ? 'unauthorized' : 'http_error');
}

function videoUrl(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const root = body as { video?: { url?: string }; data?: { video?: { url?: string } } };
  const url = root.video?.url ?? root.data?.video?.url;
  return typeof url === 'string' ? url : undefined;
}

export function createFalClient(config: FalClientConfig): FalClient {
  const key = config.apiKey.trim();
  if (!key) throw new FalApiError('Fal apiKey is required', 401, 'unauthorized');
  const origin = (config.baseUrl ?? FAL_QUEUE_ORIGIN).replace(/\/$/, '');
  const doFetch = config.fetchImpl ?? fetch;
  const pollMs = config.pollIntervalMs ?? 4_000;
  const sleep = config.sleep ?? sleepDefault;
  const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };

  async function call(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    let attempt = 0;
    for (;;) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('The request was aborted');
      const res = await doFetch(url, { ...init, ...(signal ? { signal } : {}) });
      if (res.ok) return res;
      const err = await readError(res);
      if (err.retryable && attempt < MAX_TRANSIENT) {
        attempt += 1;
        await sleep(500 * 2 ** (attempt - 1));
        continue;
      }
      throw err;
    }
  }

  const client: FalClient = {
    async submit(model, input, opts) {
      if (!MODEL_ID.test(model)) throw new FalApiError('Fal model id is not a path like owner/app/endpoint', 400, 'bad_model');
      const res = await call(`${origin}/${model}`, { method: 'POST', headers, body: JSON.stringify(input) }, opts?.signal);
      const body = (await res.json()) as { request_id?: string; status_url?: string; response_url?: string; cancel_url?: string };
      if (!body.request_id || !body.status_url || !body.response_url) throw new FalApiError('Fal submit returned no request id', 502, 'bad_response');
      owned(body.status_url, origin);
      owned(body.response_url, origin);
      return { requestId: body.request_id, statusUrl: body.status_url, responseUrl: body.response_url, ...(body.cancel_url ? { cancelUrl: body.cancel_url } : {}) };
    },

    async status(handle, opts) {
      const res = await call(owned(handle.statusUrl, origin).toString(), { headers: { Authorization: `Key ${key}` } }, opts?.signal);
      const body = (await res.json()) as { status?: string; queue_position?: number };
      return { status: body.status ?? 'UNKNOWN', ...(body.queue_position !== undefined ? { queuePosition: body.queue_position } : {}) };
    },

    async result(handle, opts) {
      const res = await call(owned(handle.responseUrl, origin).toString(), { headers: { Authorization: `Key ${key}` } }, opts?.signal);
      const raw = (await res.json()) as unknown;
      return { videoUrl: videoUrl(raw), raw };
    },

    async waitFor(handle, opts) {
      const timeoutMs = opts?.timeoutMs ?? 40 * 60_000;
      const started = Date.now();
      for (;;) {
        const status = await client.status(handle, { signal: opts?.signal });
        if (status.status === 'COMPLETED') return client.result(handle, { signal: opts?.signal });
        if (status.status === 'FAILED' || status.status === 'CANCELLED') throw new FalApiError(`Fal request ${handle.requestId} ${status.status}`, 422, status.status.toLowerCase());
        if (Date.now() - started >= timeoutMs) throw new FalTimeoutError(handle.requestId, Date.now() - started);
        await sleep(pollMs);
      }
    },
  };

  return client;
}

/** MiniMax H3 Max on Fal. A still is the opening frame. Text-only reels are 9:16. */
export const FAL_REEL_TEXT = 'minimax/h3-max/text-to-video';
export const FAL_REEL_IMAGE = 'minimax/h3-max/image-to-video';

export function falReel(req: { prompt: string; imageUrl?: string; duration?: number }): { model: string; input: Record<string, unknown> } {
  const duration = req.duration ?? 6;
  if (req.imageUrl) {
    return { model: FAL_REEL_IMAGE, input: { prompt: req.prompt, image_url: req.imageUrl, resolution: '768P', duration, prompt_expansion_mode: 'balanced' } };
  }
  return { model: FAL_REEL_TEXT, input: { prompt: req.prompt, aspect_ratio: '9:16', resolution: '768P', duration, prompt_expansion_mode: 'balanced' } };
}
