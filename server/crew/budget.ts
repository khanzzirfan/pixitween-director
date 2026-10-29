// Owned by S12a. The producer (design.md 5.11): a per-film spend cap with a warning at 80 % and a stop at 100 %.
import type { Job, JobKind } from '@shared/crew';
import type { Ledger } from '@shared/ports';
import type { JobGate } from './scheduler';

export type BudgetLevel = 'ok' | 'warn' | 'stop';

/** Static estimates in USD, from the S1 token counts and prices. Recalibrate after the live crew run. */
export const JOB_ESTIMATE_USD: Record<JobKind, number> = {
  'build-scene': 0.03,
  'rebuild-scene': 0.03,
  'restyle-scene': 0.02,
  edit: 0.02,
  fix: 0.02,
  take: 0.03,
  critique: 0.01,
  continuity: 0,
  revert: 0,
};
export const SHOWRUNNER_TURN_USD = 0.06;
export const WARN_FRACTION = 0.8;
const EPS = 1e-9;

export interface BudgetDeps {
  ledger: Pick<Ledger, 'total'>;
  filmId: string;
  /** The ids of this film's take films; what they spend counts toward the parent. */
  childFilmIds: () => string[];
  capUsd: number;
  emit(event: { type: 'budget'; spentUsd: number; capUsd: number; level: BudgetLevel }): void;
  /** Called once per level change, for the inbox note to the showrunner. */
  onLevel?(level: BudgetLevel, spentUsd: number): void;
}

export interface Budget extends JobGate {
  check(): void;
  spent(): number;
  estimate(job: Pick<Job, 'kind'>): number;
  level(): BudgetLevel;
}

export function createBudget(deps: BudgetDeps): Budget {
  let announced: BudgetLevel = 'ok';
  const spent = () => [deps.filmId, ...deps.childFilmIds()].reduce((n, id) => n + deps.ledger.total(id), 0);
  const levelFor = (usd: number): BudgetLevel => (usd + EPS >= deps.capUsd ? 'stop' : usd + EPS >= deps.capUsd * WARN_FRACTION ? 'warn' : 'ok');
  const estimate = (job: Pick<Job, 'kind'>) => JOB_ESTIMATE_USD[job.kind];

  return {
    spent,
    estimate,
    level: () => levelFor(spent()),
    allows(job) {
      const cost = estimate(job);
      if (cost === 0) return true; // continuity and revert make no model call
      return spent() + cost <= deps.capUsd + EPS;
    },
    check() {
      const usd = spent();
      const level = levelFor(usd);
      if (level === announced) return;
      announced = level;
      deps.emit({ type: 'budget', spentUsd: usd, capUsd: deps.capUsd, level });
      deps.onLevel?.(level, usd);
    },
  };
}
