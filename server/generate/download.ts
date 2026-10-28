// Owned by S7b. Fetches the finished clip once, safely; the signed URL is never stored or logged.
import { assertPublicUrl, PublicUrlError } from './public-url';

export class DownloadError extends Error {
  status?: number;
  retryable: boolean;
  constructor(message: string, o: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = 'DownloadError';
    this.status = o.status;
    this.retryable = o.retryable ?? false;
  }
}

export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return 'an invalid URL';
  }
}

export interface DownloadDeps {
  fetchImpl?: typeof fetch;
  sleep?(ms: number): Promise<void>;
  maxBytes?: number;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

const MAX_REDIRECTS = 3;

function checkUrl(url: string): URL {
  let u: URL;
  try {
    u = assertPublicUrl(url);
  } catch (e) {
    const why = e instanceof PublicUrlError ? 'not a public https URL' : 'invalid URL';
    throw new DownloadError(`Refusing to download ${redactUrl(url)}: ${why}.`);
  }
  return u;
}

async function readCapped(res: Response, maxBytes: number, shown: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body?.getReader();
  if (!reader) throw new DownloadError(`Empty response from ${shown}.`);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new DownloadError(`Clip from ${shown} is larger than ${maxBytes} bytes.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function attempt(url: string, d: Required<DownloadDeps>): Promise<Buffer> {
  let current = url;
  for (let hop = 0; ; hop++) {
    const shown = redactUrl(current);
    checkUrl(current);
    let res: Response;
    try {
      res = await d.fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(d.timeoutMs) });
    } catch {
      throw new DownloadError(`Network error fetching ${shown}.`, { retryable: true });
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc || hop >= MAX_REDIRECTS) throw new DownloadError(`Too many or invalid redirects from ${shown}.`, { status: res.status });
      current = new URL(loc, current).toString();
      continue;
    }
    if (res.status >= 500) throw new DownloadError(`Server error ${res.status} from ${shown}.`, { status: res.status, retryable: true });
    if (!res.ok) throw new DownloadError(`Download failed with ${res.status} from ${shown}.`, { status: res.status });

    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('video/') && type !== 'application/octet-stream') {
      throw new DownloadError(`Unexpected content type "${type}" from ${shown}.`);
    }
    const length = Number(res.headers.get('content-length'));
    if (Number.isFinite(length) && length > d.maxBytes) throw new DownloadError(`Clip from ${shown} is larger than ${d.maxBytes} bytes.`);

    const bytes = await readCapped(res, d.maxBytes, shown);
    if (bytes.length < 8 || bytes.toString('latin1', 4, 8) !== 'ftyp') throw new DownloadError(`Download from ${shown} is not an MP4 file.`);
    return bytes;
  }
}

export async function downloadClip(url: string, deps: DownloadDeps = {}): Promise<Buffer> {
  const d: Required<DownloadDeps> = {
    fetchImpl: deps.fetchImpl ?? fetch,
    sleep: deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))),
    maxBytes: deps.maxBytes ?? 200 * 1024 * 1024,
    timeoutMs: deps.timeoutMs ?? 120000,
    retries: deps.retries ?? 3,
    retryDelayMs: deps.retryDelayMs ?? 5000,
  };
  for (let i = 0; ; i++) {
    try {
      return await attempt(url, d);
    } catch (e) {
      if (!(e instanceof DownloadError) || !e.retryable || i >= d.retries) throw e;
      await d.sleep(d.retryDelayMs);
    }
  }
}
