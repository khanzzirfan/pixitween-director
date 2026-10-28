/** Remembers the fixes a review made, so a later "after" frame can be paired with its "before" frame. Process memory only. */
export interface FixRecord {
  sceneId: string;
  atSec?: number;
  note: string;
  beforeFrame?: string;
  /** Set once an 'after' frame has been paired with this fix, so it is announced once. */
  paired?: boolean;
}

export const MAX_RECORDS_PER_FILM = 100;

const log = new Map<string, FixRecord[]>();

export function recordFixes(filmId: string, records: FixRecord[]): void {
  log.set(filmId, [...(log.get(filmId) ?? []), ...records].slice(-MAX_RECORDS_PER_FILM));
}

/** The most recent unpaired fix for this scene at this time, marked as paired. Deterministic fixes have no time and never match. */
export function findFix(filmId: string, sceneId: string, atSec: number): FixRecord | undefined {
  const records = log.get(filmId) ?? [];
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i]!;
    if (!r.paired && r.sceneId === sceneId && r.atSec !== undefined && Math.abs(r.atSec - atSec) < 0.05) {
      r.paired = true;
      return r;
    }
  }
  return undefined;
}

export function clearFixes(filmId: string): void {
  log.delete(filmId);
}
