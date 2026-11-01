// Owned by Catalog Crew C1 (US-011). The two chips a catalog row wears: where the row is in its
// life, and what the placement verifier said about it. The chip never invents a finding: it shows
// the server's own words (the check the runner stored on the row).
import type { CatalogRow } from '@shared/catalog-run';

/** How a chip reads: green for checked, amber for fixed, red for flagged, quiet for nothing. */
export type ChipTone = 'ok' | 'fix' | 'flag' | 'none';

export interface Chip {
  tone: ChipTone;
  text: string;
}

/** The statuses that are still moving: their chip spins. */
const MOVING = new Set(['cutting', 'building', 'checking']);

/** The status chip: the status word, and whether the row is still on its way. */
export function statusChip(row: CatalogRow): { text: string; spinning: boolean } {
  return { text: row.status, spinning: MOVING.has(row.status) };
}

/**
 * The check chip: what the verifier said about the row.
 *
 * - a row that failed shows the reason it failed,
 * - a row with no check was never checked (a 3D hero row: the verifier only knows the 2D clip),
 * - a fixed row names the move the fixer made,
 * - a flagged row names the finding that still blocks it,
 * - a ready row counts the notes it has.
 */
export function checkChip(row: CatalogRow): Chip {
  if (row.status === 'failed') return { tone: 'flag', text: row.error ?? 'the row failed' };
  const check = row.check;
  if (!check) return { tone: 'none', text: 'not checked (3D)' };
  if (row.status === 'fixed') return { tone: 'fix', text: `⚑ fixed: ${check.applied[0] ?? 'the fixer moved it'}` };
  if (row.status === 'flagged') return { tone: 'flag', text: `⚑ ${check.blocking[0] ?? 'blocked'}` };
  const n = check.warnings.length;
  return { tone: 'ok', text: `✔ checked, ${n} ${n === 1 ? 'note' : 'notes'}` };
}
