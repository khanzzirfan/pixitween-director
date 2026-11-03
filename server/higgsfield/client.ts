// Higgsfield client. A credential is `keyId:secret`, sent as `Authorization: Key keyId:secret`.
import { randomUUID } from 'node:crypto';
import { HiggsfieldApiError, HiggsfieldTimeoutError } from './errors';

export const HIGGSFIELD_ORIGIN = 'https://api.higgsfield.ai';
const ENDPOINT = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)+$/;
const MAX_TRANSIENT = 3;

export interface HiggsfieldCredential {
  id: string;
  secret: string;
}

/** Split `keyId:secret`. The secret may contain further colons. */
export function parseHiggsfieldKey(key: string): HiggsfieldCredential | undefined {
  const trimmed = key.trim();
  const cut = trimmed.indexOf(':');
  if (cut < 4 || cut > 128) return undefined;
  const id = trimmed.slice(0, cut);
  const secret = trimmed.slice(cut + 1);
  if (!id || /\s/.test(id) || secret.length < 8 || secret.length > 300 || /\s/.test(secret)) return undefined;
  return { id, secret };
}

export interface HiggsfieldClientConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface HiggsfieldHandle {
  requestId: string;
  statusUrl: string;
  cancelUrl?: string;
}

export interface HiggsfieldStatus {
  status: string;
  videoUrl?: string;
}

export interface HiggsfieldClient {
  submit(endpoint: string, input: Record<string, unknown>, opts?: { idempotencyKey?: string; signal?: AbortSignal }): Promise<HiggsfieldHandle>;
  status(handle: HiggsfieldHandle, opts?: { signal?: AbortSignal }): Promise<HiggsfieldStatus>;
  waitFor(handle: HiggsfieldHandle, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<HiggsfieldStatus>;
}

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function owned(url: string, origin: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HiggsfieldApiError('Higgsfield returned a status URL that is not a URL', 502, 'bad_url');
  }
  if (parsed.origin !== new URL(origin).origin) throw new HiggsfieldApiError('Refusing a Higgsfield URL on another host', 502, 'bad_url');
  return parsed;
}

async function readError(res: Response): Promise<HiggsfieldApiError> {
  let message = `Higgsfield ${res.status}`;
  try {
    const body = (await res.json()) as { detail?: unknown; message?: unknown };
    const detail = body.detail ?? body.message;
    if (typeof detail === 'string' && detail.trim()) message = detail.slice(0, 300);
  } catch {
    /* keep the status line */
  }
  return new HiggsfieldApiError(message, res.status, res.status === 401 ? 'unauthorized' : 'http_error');
}

function videoUrl(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const video = (body as { video?: { url?: string } }).video;
  return typeof video?.url === 'string' ? video.url : undefined;
}

export function createHiggsfieldClient(config: HiggsfieldClientConfig): HiggsfieldClient {
  const cred = parseHiggsfieldKey(config.apiKey);
  if (!cred) throw new HiggsfieldApiError('Higgsfield key must be keyId:secret', 401, 'unauthorized');
  const origin = (config.baseUrl ?? HIGGSFIELD_ORIGIN).replace(/\/$/, '');
  const doFetch = config.fetchImpl ?? fetch;
  const pollMs = config.pollIntervalMs ?? 4_000;
  const sleep = config.sleep ?? sleepDefault;
  const auth = { Authorization: `Key ${cred.id}:${cred.secret}` };

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

  const client: HiggsfieldClient = {
    async submit(endpoint, input, opts) {
      if (!ENDPOINT.test(endpoint)) throw new HiggsfieldApiError('Higgsfield endpoint is not a path like owner/model/task', 400, 'bad_model');
      const res = await call(
        `${origin}/${endpoint}`,
        { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': opts?.idempotencyKey ?? randomUUID() }, body: JSON.stringify(input) },
        opts?.signal,
      );
      const body = (await res.json()) as { request_id?: string; status_url?: string; cancel_url?: string };
      if (!body.request_id || !body.status_url) throw new HiggsfieldApiError('Higgsfield submit returned no request id', 502, 'bad_response');
      owned(body.status_url, origin);
      return { requestId: body.request_id, statusUrl: body.status_url, ...(body.cancel_url ? { cancelUrl: body.cancel_url } : {}) };
    },

    async status(handle, opts) {
      const res = await call(owned(handle.statusUrl, origin).toString(), { headers: auth }, opts?.signal);
      const raw = (await res.json()) as { status?: string };
      return { status: raw.status ?? 'unknown', videoUrl: videoUrl(raw) };
    },

    async waitFor(handle, opts) {
      const timeoutMs = opts?.timeoutMs ?? 40 * 60_000;
      const started = Date.now();
      for (;;) {
        const status = await client.status(handle, { signal: opts?.signal });
        if (status.status === 'completed') return status;
        if (status.status === 'failed' || status.status === 'nsfw' || status.status === 'canceled') {
          throw new HiggsfieldApiError(`Higgsfield request ${handle.requestId} ${status.status}`, 422, status.status);
        }
        if (Date.now() - started >= timeoutMs) throw new HiggsfieldTimeoutError(handle.requestId, Date.now() - started);
        await sleep(pollMs);
      }
    },
  };

  return client;
}

/** A 9:16 reel. A still goes to MiniMax H3. Text only goes to Wan 3.0, which takes an aspect ratio. */
export const HIGGSFIELD_REEL_IMAGE = 'minimax/h3/image-to-video';
export const HIGGSFIELD_REEL_TEXT = 'alibaba/wan-3.0/text-to-video';

export function higgsfieldReel(req: { prompt: string; imageUrl?: string; duration?: number }): { endpoint: string; input: Record<string, unknown> } {
  if (req.imageUrl) {
    const duration = Math.min(15, Math.max(5, req.duration ?? 6));
    return { endpoint: HIGGSFIELD_REEL_IMAGE, input: { prompt: req.prompt, image_url: req.imageUrl, aspect_ratio: '9:16', resolution: '2K', duration } };
  }
  const duration = Math.min(30, Math.max(2, req.duration ?? 5));
  return { endpoint: HIGGSFIELD_REEL_TEXT, input: { prompt: req.prompt, aspect_ratio: '9:16', resolution: '720p', duration } };
}
