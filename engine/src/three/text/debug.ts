import type { Text3DStats } from './build';

// Debug accessor for the lab page (engine/lab/text3d-lab.tsx): the stats of every text3d object built
// since the last reset, keyed by object id. Written by buildObject; nothing in the engine reads it.
const stats = new Map<string, Text3DStats>();

export function recordText3DStats(objectId: string, value: Text3DStats): void {
  stats.set(objectId, value);
}

/** Stats of the most recent build per object id. */
export function getText3DStats(): Record<string, Text3DStats> {
  return Object.fromEntries(stats);
}

export function clearText3DStats(): void {
  stats.clear();
}
