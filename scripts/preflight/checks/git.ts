// Owned by S10. The repository history starts when the hackathon did, so "new work" can be checked from git.
import { fail, pass, pending, type CheckResult, type PreflightCtx } from '../types';

export const EVENT_START = '2026-10-26';

export function checkGitProvenance(ctx: PreflightCtx): CheckResult[] {
  const title = `the first commit is on or after ${EVENT_START}`;
  if (!ctx.firstCommitDate) return [pending('git.provenance', title, 'not a git repository, so the history cannot be read')];
  return ctx.firstCommitDate >= EVENT_START
    ? [pass('git.provenance', title, `first commit ${ctx.firstCommitDate}`)]
    : [fail('git.provenance', title, `first commit ${ctx.firstCommitDate} is before the event`)];
}
