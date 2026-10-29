// Owned by S12d. What the film has cost against its cap. Spending is never hidden.
import { dollars } from './format';
import type { CrewState } from './crewReducer';

export function BudgetMeter({ budget, credits = 0 }: { budget: CrewState['budget']; credits?: number }) {
  const spent = budget?.spentUsd ?? 0;
  const cap = budget?.capUsd ?? 0;
  const level = budget?.level ?? 'ok';
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  return (
    <div className={`budget-meter${level === 'warn' ? ' is-warn' : ''}${level === 'stop' ? ' is-stop' : ''}`} role="group" aria-label="Budget">
      <div className="budget-text">
        <span className="budget-figures">{cap > 0 ? `${dollars(spent)} of ${dollars(cap)}` : 'Budget starts with the first turn'}</span>
        {level !== 'ok' && <span className="budget-level">{level === 'warn' ? 'nearly spent' : 'stopped'}</span>}
        {credits > 0 && <span className="budget-credits">{credits} credits</span>}
      </div>
      <div className="budget-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Budget used">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
