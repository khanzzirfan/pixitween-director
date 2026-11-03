// Optional Revana client (api.revana.si). One bearer key covers Seedance 2.5 video and MiniMax M3 chat.
// The Muse crew does not call this. Import it only when REVANA_API_KEY is set.
import { randomUUID } from 'node:crypto';
import { RevanaApiError, RevanaGenerationFailedError, RevanaTimeoutError } from './errors';
import type { RevanaBalance, RevanaGeneration, RevanaQuote, RevanaSubmitOptions, RevanaUpload } from './types';

export const REVANA_BASE_URL = 'https://api.revana.si/v1';
const MAX_TRANSIENT = 3;

export interface RevanaClientConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface WaitOptions {
  /** Stop polling. The job may still finish and be charged. Default 40 minutes. */
  timeoutMs?: number;
  onPoll?: (generation: RevanaGeneration) => void;
  signal?: AbortSignal;
}

export interface GenerateOptions extends RevanaSubmitOptions, WaitOptions {
  /** Refuse before submit when the quote's reserved price is above this. */
  maxBudgetUsd?: number;
}

export interface RevanaClient {
  quote(model: string, input: Record<string, unknown>, opts?: Pick<RevanaSubmitOptions, 'maxCostUsd' | 'maxWaitS' | 'signal'>): Promise<RevanaQuote>;
  submit(model: string, input: Record<string, unknown>, opts?: RevanaSubmitOptions): Promise<RevanaGeneration>;
  get(id: string, opts?: { signal?: AbortSignal }): Promise<RevanaGeneration>;
  waitFor(id: string, opts?: WaitOptions): Promise<RevanaGeneration>;
  /** Quote, refuse an over-budget or unfunded job, submit, then wait. */
  generate(model: string, input: Record<string, unknown>, opts?: GenerateOptions): Promise<RevanaGeneration>;
  download(id: string, index?: number, opts?: { signal?: AbortSignal }): Promise<Buffer>;
  balance(opts?: { signal?: AbortSignal }): Promise<RevanaBalance>;
  /** PUT the bytes to Revana's upload slot and return the public reference URL. */
  upload(data: Buffer, contentType: string, filename?: string, opts?: { signal?: AbortSignal }): Promise<string>;
  chat(body: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<unknown>;
}

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const e = new Error('The request was aborted');
  e.name = 'AbortError';
  return e;
}

async function readError(res: Response): Promise<RevanaApiError> {
  let code = 'http_error';
  let message = `Revana ${res.status}`;
  let requestId = res.headers.get('x-request-id') ?? undefined;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; request_id?: string } };
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
    requestId = body.error?.request_id ?? requestId;
  } catch {
    /* a non-JSON body still becomes an error with the status */
  }
  const retryAfter = Number(res.headers.get('retry-after'));
  return new RevanaApiError(message, res.status, code, requestId, Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : undefined);
}

export function createRevanaClient(config: RevanaClientConfig): RevanaClient {
  const key = config.apiKey.trim();
  if (!key) throw new RevanaApiError('Revana apiKey is required', 401, 'unauthorized');
  const base = (config.baseUrl ?? REVANA_BASE_URL).replace(/\/$/, '');
  const doFetch = config.fetchImpl ?? fetch;
  const pollMs = config.pollIntervalMs ?? 4_000;
  const sleep = config.sleep ?? sleepDefault;

  async function call(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    let attempt = 0;
    for (;;) {
      if (signal?.aborted) throw abortError(signal);
      const res = await doFetch(`${base}${path}`, { ...init, ...(signal ? { signal } : {}) });
      if (res.ok) return res;
      const err = await readError(res);
      const transient = err.status === 429 || err.status === 503;
      if (transient && attempt < MAX_TRANSIENT) {
        attempt += 1;
        const wait = err.retryAfterS !== undefined ? Math.min(err.retryAfterS, 30) * 1000 : 500 * 2 ** (attempt - 1);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }

  async function json<T>(path: string, init: RequestInit | undefined, signal?: AbortSignal): Promise<T> {
    const res = await call(path, init ?? {}, signal);
    return (await res.json()) as T;
  }

  function generationBody(model: string, input: Record<string, unknown>, opts?: RevanaSubmitOptions): string {
    return JSON.stringify({
      model,
      input,
      ...(opts?.maxCostUsd !== undefined ? { max_cost_usd: opts.maxCostUsd } : {}),
      ...(opts?.maxWaitS !== undefined ? { max_wait_s: opts.maxWaitS } : {}),
    });
  }

  const client: RevanaClient = {
    quote: (model, input, opts) =>
      json('/generations/quote', { method: 'POST', headers: authJson(key), body: generationBody(model, input, opts) }, opts?.signal),

    submit: (model, input, opts) =>
      json(
        '/generations',
        {
          method: 'POST',
          headers: { ...authJson(key), 'Idempotency-Key': opts?.idempotencyKey ?? randomUUID() },
          body: generationBody(model, input, opts),
        },
        opts?.signal,
      ),

    get: (id, opts) => json(`/generations/${encodeURIComponent(id)}`, { headers: auth(key) }, opts?.signal),

    async waitFor(id, opts) {
      const timeoutMs = opts?.timeoutMs ?? 40 * 60_000;
      const started = Date.now();
      for (;;) {
        const generation = await client.get(id, { signal: opts?.signal });
        opts?.onPoll?.(generation);
        if (generation.status === 'succeeded') return generation;
        if (generation.status === 'failed') throw new RevanaGenerationFailedError(generation);
        if (Date.now() - started >= timeoutMs) throw new RevanaTimeoutError(id, Date.now() - started);
        await sleep(pollMs);
      }
    },

    async generate(model, input, opts) {
      const quote = await client.quote(model, input, opts);
      if (quote.enough_credit === false) throw new RevanaApiError('Not enough Revana credit for this movie', 402, 'insufficient_credits');
      if (opts?.maxBudgetUsd !== undefined && quote.reserved_usd > opts.maxBudgetUsd) {
        throw new RevanaApiError(`This movie reserves $${quote.reserved_usd}, above the $${opts.maxBudgetUsd} budget`, 422, 'max_cost_exceeded');
      }
      const submitted = await client.submit(model, input, { ...opts, maxCostUsd: opts?.maxCostUsd ?? opts?.maxBudgetUsd ?? quote.reserved_usd });
      return client.waitFor(submitted.id, opts);
    },

    async download(id, index = 1, opts) {
      const suffix = index > 1 ? `/${index}` : '';
      const res = await call(`/generations/${encodeURIComponent(id)}/content${suffix}`, { headers: auth(key) }, opts?.signal);
      return Buffer.from(await res.arrayBuffer());
    },

    balance: (opts) => json('/balance', { headers: auth(key) }, opts?.signal),

    async upload(data, contentType, filename, opts) {
      const slot = await json<RevanaUpload>(
        '/uploads',
        {
          method: 'POST',
          headers: authJson(key),
          body: JSON.stringify({ content_type: contentType, bytes: data.length, ...(filename ? { filename } : {}) }),
        },
        opts?.signal,
      );
      // The slot is a pre-signed URL. Authorization must not go with it.
      const put = await doFetch(slot.upload_url, {
        method: 'PUT',
        headers: slot.upload_headers,
        body: new Uint8Array(data),
        ...(opts?.signal ? { signal: opts.signal } : {}),
      });
      if (!put.ok) throw new RevanaApiError(`Upload failed (${put.status})`, put.status, 'upload_failed');
      return slot.url;
    },

    chat: (body, opts) => json('/chat/completions', { method: 'POST', headers: authJson(key), body: JSON.stringify(body) }, opts?.signal),
  };

  return client;
}

function auth(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

function authJson(apiKey: string): Record<string, string> {
  return { ...auth(apiKey), 'Content-Type': 'application/json' };
}
