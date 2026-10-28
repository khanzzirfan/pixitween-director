import type { ClippyClient } from './mcp';

/** A safe, cached balance reader: never throws; an unavailable or odd value is `undefined`. */
export function createBalanceReader(client: ClippyClient | undefined, opts: { ttlMs?: number; now?: () => number } = {}): { read(): Promise<number | undefined> } {
  const ttl = opts.ttlMs ?? 30_000;
  const now = opts.now ?? Date.now;
  let cached: { value: number; at: number } | undefined;
  return {
    async read() {
      if (!client) return undefined;
      if (cached && now() - cached.at < ttl) return cached.value;
      try {
        const v = (await client.getCreditBalance()).currentBalance;
        if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
        cached = { value: v, at: now() };
        return v;
      } catch {
        return undefined;
      }
    },
  };
}
