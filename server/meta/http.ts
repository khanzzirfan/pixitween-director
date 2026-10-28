import { Agent, FormData as UndiciFormData, fetch } from 'undici';
import { ConfigError } from '../errors';
import { describeForm, readReplay, ReplayMissError, requestKey, writeReplay } from './replay';

export const META_TIMEOUT_MS = 15 * 60_000;

export class MetaApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body: string;
  constructor(status: number, body: string, code?: string) {
    super(`Meta API ${status}${code ? ` (${code})` : ''}: ${body.slice(0, 200)}`);
    this.name = 'MetaApiError';
    this.status = status;
    this.code = code;
    this.body = body.slice(0, 500);
  }
}
export class MetaConfigError extends Error {
  constructor(message = 'META_API_KEY (or MODEL_API_KEY) is not set') {
    super(message);
    this.name = 'MetaConfigError';
  }
}

export interface MetaHttpOptions {
  baseUrl: string;
  apiKey?: () => string | undefined;
  /** Env var named in the error when the key is missing. Default: META_API_KEY. */
  keyName?: string;
  retryDelayMs?: number;
  maxInflight?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  mode?: { replay?: { dir: string }; record?: { dir: string } };
}

export interface MetaHttp {
  json<T = unknown>(path: string, body: unknown): Promise<{ status: number; ms: number; body: T }>;
  form(path: string, form: FormData, headers?: Record<string, string>): Promise<{ status: number; ms: number; text: string }>;
  sse(path: string, body: unknown): Promise<{ status: number; ms: number; text: string }>;
}

interface Req {
  method: 'POST';
  path: string;
  json?: unknown;
  form?: FormData;
  accept?: string;
  headers?: Record<string, string>;
}
interface Res {
  status: number;
  ms: number;
  text: string;
  contentType: string;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createMetaHttp(opts: MetaHttpOptions): MetaHttp {
  if (opts.mode?.replay && opts.mode.record) throw new ConfigError('replay and record modes are mutually exclusive');
  const retryDelayMs = opts.retryDelayMs ?? 2000;
  const maxInflight = opts.maxInflight ?? 8;
  const sleep = opts.sleep ?? defaultSleep;
  const log = opts.log ?? (() => undefined);
  const agent = new Agent({ headersTimeout: META_TIMEOUT_MS, bodyTimeout: META_TIMEOUT_MS });

  // counting semaphore, shared by every method of this instance
  let inflight = 0;
  const waiters: Array<() => void> = [];
  const acquire = async () => {
    if (inflight >= maxInflight) await new Promise<void>((r) => waiters.push(r));
    else inflight++;
  };
  const release = () => {
    const next = waiters.shift();
    if (next) next(); // hand the slot over
    else inflight--;
  };

  const errorCode = (text: string): string | undefined => {
    try {
      const j = JSON.parse(text) as { error?: { code?: string } | string; code?: string };
      return (typeof j.error === 'object' ? j.error?.code : undefined) ?? j.code;
    } catch {
      return undefined;
    }
  };

  async function attempt(req: Req, key: string): Promise<Res & { retryAfter?: string }> {
    await acquire();
    const t0 = Date.now();
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${key}`, ...req.headers };
      let body: string | UndiciFormData | undefined;
      if (req.form) {
        // The installed undici only recognises its own FormData class, not Node's global one.
        body = new UndiciFormData();
        for (const [name, value] of req.form.entries()) {
          if (typeof value === 'string') body.append(name, value);
          else body.append(name, value, (value as File).name);
        }
      } else {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(req.json);
      }
      if (req.accept) headers.Accept = req.accept;
      const res = await fetch(opts.baseUrl.replace(/\/$/, '') + req.path, { method: req.method, headers, body, dispatcher: agent });
      const text = await res.text();
      return { status: res.status, ms: Date.now() - t0, text, contentType: res.headers.get('content-type') ?? '', retryAfter: res.headers.get('retry-after') ?? undefined };
    } finally {
      release();
    }
  }

  async function request(req: Req): Promise<Res> {
    const form = req.form ? await describeForm(req.form) : undefined;
    const key = requestKey({ method: req.method, path: req.path, json: req.json, form });

    if (opts.mode?.replay) {
      const rec = await readReplay(opts.mode.replay.dir, key);
      if (!rec) throw new ReplayMissError(req.method, req.path, key);
      return { status: rec.status, ms: 0, text: rec.bodyText, contentType: rec.contentType };
    }

    const apiKey = opts.apiKey?.();
    if (!apiKey) throw new MetaConfigError(opts.keyName ? `${opts.keyName} is not set` : undefined);

    let retried402 = false;
    let retries429 = 0;
    for (;;) {
      const res = await attempt(req, apiKey);
      log(`meta ${req.path} ${res.status} ${res.ms}ms`);
      if (res.status >= 200 && res.status < 300) {
        if (opts.mode?.record) await writeReplay(opts.mode.record.dir, key, { status: res.status, contentType: res.contentType, bodyText: res.text });
        return res;
      }
      const code = errorCode(res.text);
      if (res.status === 402 && code === 'billing_not_configured' && !retried402) {
        retried402 = true;
        log(`meta ${req.path} 402 billing_not_configured, retrying in ${retryDelayMs}ms`);
        await sleep(retryDelayMs);
        continue;
      }
      if (res.status === 429 && retries429 < 3) {
        const ra = res.retryAfter !== undefined ? Number(res.retryAfter) : NaN;
        const wait = Number.isFinite(ra)
          ? Math.min(ra, 30) * 1000
          : retryDelayMs * 2 ** retries429 * (1 + Math.random() * 0.25);
        retries429++;
        log(`meta ${req.path} 429, waiting ${Math.round(wait)}ms (retry ${retries429}/3)`);
        await sleep(wait);
        continue;
      }
      throw new MetaApiError(res.status, res.text, code);
    }
  }

  return {
    async json<T>(path: string, body: unknown) {
      const r = await request({ method: 'POST', path, json: body });
      return { status: r.status, ms: r.ms, body: JSON.parse(r.text) as T };
    },
    async form(path, form, headers) {
      const r = await request({ method: 'POST', path, form, headers });
      return { status: r.status, ms: r.ms, text: r.text };
    },
    async sse(path, body) {
      const r = await request({ method: 'POST', path, json: body, accept: 'text/event-stream' });
      return { status: r.status, ms: r.ms, text: r.text };
    },
  };
}
