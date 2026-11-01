// Owned by S9. One place for the Local-mode flag and Ollama's status, so the router and the UI agree.
import { loadEnv } from '../env';

export interface LocalModeStatus {
  reachable: boolean;
  modelPresent: boolean;
  /** null when Ollama could not say (the /api/ps call failed) */
  loaded: boolean | null;
  model: string;
  host: string;
  checkedAt: string;
  error?: string;
}

let local: boolean | undefined;

/** The flag starts from the validated LOCAL_MODE (read on first use) and then follows setLocalMode. */
export function getLocalMode(env?: { LOCAL_MODE: boolean }): boolean {
  local ??= (env ?? loadEnv()).LOCAL_MODE;
  return local;
}

export function setLocalMode(v: boolean): void {
  local = v;
}

export function resetLocalModeForTests(initial = false): void {
  local = initial;
  cache.clear();
}

const CACHE_MS = 60_000;
const PROBE_TIMEOUT_MS = 1500;
const cache = new Map<string, { at: number; value: LocalModeStatus }>();

export interface StatusOptions {
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  forceRefresh?: boolean;
}

async function getJson(fetchImpl: typeof fetch, url: string): Promise<{ models?: Array<{ name?: string }> }> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return (await res.json()) as { models?: Array<{ name?: string }> };
}

/** Is Ollama up, is the model pulled, is it loaded in memory? Cached for 60 s per (host, model); the answer is never an exception. */
export async function getGlimmerStatus(o: StatusOptions = {}): Promise<LocalModeStatus> {
  const env = o.baseUrl && o.model ? undefined : loadEnv();
  const baseUrl = (o.baseUrl ?? env!.GLIMMER_BASE_URL).replace(/\/+$/, '');
  const model = o.model ?? env!.GLIMMER_MODEL;
  const now = o.now ?? Date.now;
  const key = `${baseUrl}|${model}`;
  const hit = cache.get(key);
  if (hit && !o.forceRefresh && now() - hit.at < CACHE_MS) return hit.value;

  const fetchImpl = o.fetchImpl ?? fetch;
  let host = baseUrl;
  try {
    host = new URL(baseUrl).host;
  } catch {
    // keep the raw string
  }
  const base = { model, host, checkedAt: new Date(now()).toISOString() };
  let value: LocalModeStatus;
  try {
    const tags = await getJson(fetchImpl, `${baseUrl}/api/tags`);
    const modelPresent = (tags.models ?? []).some((m) => m.name === model);
    let loaded: boolean | null = null;
    try {
      loaded = ((await getJson(fetchImpl, `${baseUrl}/api/ps`)).models ?? []).some((m) => m.name === model);
    } catch {
      // loaded stays unknown
    }
    value = { reachable: true, modelPresent, loaded, ...base };
  } catch (e) {
    value = { reachable: false, modelPresent: false, loaded: null, ...base, error: e instanceof Error && e.message ? e.message : 'Ollama is not reachable' };
  }
  cache.set(key, { at: now(), value });
  return value;
}
