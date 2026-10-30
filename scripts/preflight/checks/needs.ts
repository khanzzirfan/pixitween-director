// Owned by S10. The owner reads every engine gap and stamps the file, so none is forgotten at submission.
import { fail, pass, pending, type CheckResult, type PreflightCtx } from '../types';

export function checkEngineNeeds(ctx: PreflightCtx): CheckResult[] {
  const title = 'ENGINE-NEEDS.md has the owner review stamp';
  const text = ctx.readText('ENGINE-NEEDS.md');
  if (text === undefined) return [fail('engine.needs', title, 'ENGINE-NEEDS.md is missing')];
  const stamp = /^Reviewed: (\d{4}-\d{2}-\d{2})\s*$/m.exec(text);
  return stamp ? [pass('engine.needs', title, `reviewed ${stamp[1]}`)] : [pending('engine.needs', title, "add a line 'Reviewed: YYYY-MM-DD' once you have read every row")];
}
