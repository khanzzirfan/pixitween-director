import { GlimmerError } from './errors';

export interface OllamaConn {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const errorText = (body: string): string => {
  try {
    const j = JSON.parse(body) as { error?: unknown };
    return typeof j.error === 'string' ? j.error : body;
  } catch {
    return body;
  }
};

/** POST to Ollama's native /api/chat and return the parsed body, with every failure as a typed GlimmerError. */
export async function postChat(conn: OllamaConn, body: object): Promise<{ raw: unknown; wallMs: number }> {
  const doFetch = conn.fetchImpl ?? fetch;
  const started = Date.now();
  let res: Response;
  try {
    res = await doFetch(`${conn.baseUrl.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(conn.timeoutMs ?? 300000),
    });
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new GlimmerError('timeout', undefined, 'Ollama did not answer in time');
    throw new GlimmerError('unreachable', undefined, `Ollama is not reachable at ${conn.baseUrl}`);
  }
  const text = await res.text();
  if (!res.ok) {
    const msg = errorText(text);
    if (res.status === 404 || /not found/i.test(msg)) throw new GlimmerError('model-missing', res.status, msg);
    if (res.status === 500 && /parse/i.test(msg) && /call/i.test(msg)) throw new GlimmerError('tool-parse', res.status, msg);
    throw new GlimmerError('http', res.status, msg);
  }
  try {
    return { raw: JSON.parse(text), wallMs: Date.now() - started };
  } catch {
    throw new GlimmerError('http', res.status, 'Ollama answered with something that is not JSON');
  }
}
