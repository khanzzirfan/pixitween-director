import { fail, pass, type CheckResult, type PreflightCtx } from '../types';

const TITLE = 'LICENSE is Apache-2.0';

export function checkLicense(ctx: PreflightCtx): CheckResult[] {
  const text = ctx.readText('LICENSE');
  if (text === undefined) return [fail('license', TITLE, 'the LICENSE file is missing')];
  if (/Apache License/.test(text) && /Version 2\.0/.test(text)) return [pass('license', TITLE)];
  return [fail('license', TITLE, 'LICENSE is not the Apache License, Version 2.0')];
}
