// Owned by S10. Sums a film's `cost` events into the table the README quotes. Pure.
export interface LedgerEntry {
  model: string;
  units: string;
  usd: number;
  /** Clippy credits, when the event carried them. */
  credits?: number;
}
export interface Ledger {
  filmId?: string;
  entries: LedgerEntry[];
  clippyCredits?: number;
}
export interface CostRow {
  model: string;
  calls: number;
  usd: number;
}
export interface CostSummary {
  filmId?: string;
  rows: CostRow[];
  totalUsd: number;
  calls: number;
  /** The ledger's own figure when it has one, else the sum of the entries' credits: never both, so nothing is counted twice. */
  clippyCredits: number;
  skipped: number;
}

const MICRO = 1e6;
const micro = (usd: number) => Math.round(usd * MICRO);

export function summariseLedger(l: Ledger & { skipped?: number }): CostSummary {
  const byModel = new Map<string, { calls: number; micro: number }>();
  let credits = 0;
  for (const e of l.entries) {
    const row = byModel.get(e.model) ?? { calls: 0, micro: 0 };
    row.calls++;
    row.micro += micro(e.usd); // integer micro-dollars, so 0.1 + 0.2 is 0.3 and not 0.30000000000000004
    byModel.set(e.model, row);
    credits += e.credits ?? 0;
  }
  const rows = [...byModel.entries()]
    .map(([model, r]) => ({ model, calls: r.calls, usd: r.micro / MICRO, micro: r.micro }))
    .sort((a, b) => b.micro - a.micro || a.model.localeCompare(b.model))
    .map(({ model, calls, usd }) => ({ model, calls, usd }));
  const totalMicro = [...byModel.values()].reduce((n, r) => n + r.micro, 0);
  return {
    ...(l.filmId ? { filmId: l.filmId } : {}),
    rows,
    totalUsd: totalMicro / MICRO,
    calls: l.entries.length,
    clippyCredits: l.clippyCredits ?? credits,
    skipped: l.skipped ?? 0,
  };
}

const finiteNonNegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Reads an events.jsonl (`{seq, event}` lines or bare events). Keeps the cost events, ignores the others, and counts the lines it could not use. */
export function ledgerFromEvents(jsonl: string): Ledger & { skipped: number } {
  const entries: LedgerEntry[] = [];
  let skipped = 0;
  let filmId: string | undefined;
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    const e = (parsed && typeof parsed === 'object' && 'event' in parsed ? (parsed as { event: unknown }).event : parsed) as Record<string, unknown> | null;
    if (!e || typeof e !== 'object') continue;
    if (typeof e.filmId === 'string') filmId ??= e.filmId;
    if (e.type !== 'cost') continue;
    const usd = e.usd;
    const credits = e.credits;
    if (typeof e.model !== 'string' || !finiteNonNegative(usd) || (credits !== undefined && !finiteNonNegative(credits))) {
      skipped++;
      continue;
    }
    entries.push({ model: e.model, units: typeof e.units === 'string' ? e.units : '', usd, ...(credits !== undefined ? { credits } : {}) });
  }
  return { ...(filmId ? { filmId } : {}), entries, skipped };
}

/** The fixed layout the README shows. */
export function formatCostTable(s: CostSummary): string {
  const row = (name: string, calls: number, usd: number) => `${name.padEnd(27)}${String(calls).padStart(6)}${usd.toFixed(4).padStart(10)}`;
  return [
    `Cost summary: film ${s.filmId ?? 'unknown'}`,
    `${'model'.padEnd(27)}${'calls'.padStart(6)}${'USD'.padStart(10)}`,
    ...s.rows.map((r) => row(r.model, r.calls, r.usd)),
    row('TOTAL', s.calls, s.totalUsd),
    `Clippy credits: ${s.clippyCredits}`,
  ].join('\n');
}
