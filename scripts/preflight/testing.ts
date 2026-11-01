// Owned by S10. An in-memory repository for the checks' tests.
import type { PreflightCtx } from './types';

export function makeCtx(files: Record<string, string>, o: { tracked?: string[]; firstCommitDate?: string; sizes?: Record<string, number> } = {}): PreflightCtx {
  return {
    root: '/repo',
    tracked: o.tracked ?? Object.keys(files),
    readText: (p) => files[p],
    sizeOf: (p) => o.sizes?.[p] ?? files[p]?.length ?? 0,
    json: <T,>(p: string) => {
      const t = files[p];
      if (t === undefined) return undefined;
      try {
        return JSON.parse(t) as T;
      } catch {
        return undefined;
      }
    },
    ...(o.firstCommitDate !== undefined ? { firstCommitDate: o.firstCommitDate } : {}),
  };
}
