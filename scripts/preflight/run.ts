// Owned by S10. Runs the checks, formats a table and decides the exit code.
import type { CheckResult, NamedCheck, PreflightCtx } from './types';

/** 1 for any fail; with `strict`, also for any pending (the owner's own markers); otherwise 0. */
export function exitCode(results: readonly CheckResult[], strict: boolean): 0 | 1 {
  if (results.some((r) => r.status === 'fail')) return 1;
  return strict && results.some((r) => r.status === 'pending') ? 1 : 0;
}

/** A check that throws becomes one fail whose id ends `.error`, so one broken check never hides the others. */
export function runChecks(checks: readonly NamedCheck[], ctx: PreflightCtx): CheckResult[] {
  const out: CheckResult[] = [];
  for (const c of checks) {
    try {
      out.push(...c.run(ctx));
    } catch (e) {
      out.push({ id: `${c.id}.error`, title: `${c.id} could not run`, status: 'fail', detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

const MARK: Record<CheckResult['status'], string> = { pass: 'PASS   ', fail: 'FAIL   ', pending: 'PENDING' };

export function formatResults(results: readonly CheckResult[]): string {
  const count = (s: CheckResult['status']) => results.filter((r) => r.status === s).length;
  const lines = results.map((r) => `${MARK[r.status]} ${r.id}${r.title ? `: ${r.title}` : ''}${r.detail ? ` (${r.detail})` : ''}`);
  return [...lines, '', `${count('pass')} pass, ${count('fail')} fail, ${count('pending')} pending`].join('\n');
}
