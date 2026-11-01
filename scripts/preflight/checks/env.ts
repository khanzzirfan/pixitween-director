// Owned by S10. .env never ships, and .env.example holds only empty secrets.
import { fail, pass, type CheckResult, type PreflightCtx } from '../types';

const SECRET_NAME = /KEY|TOKEN|PASSCODE|SECRET/;

export function checkEnv(ctx: PreflightCtx): CheckResult[] {
  const out: CheckResult[] = [];
  const leaked = ctx.tracked.filter((p) => {
    const base = p.split('/').pop()!;
    return base === '.env' || (base.startsWith('.env.') && base !== '.env.example');
  });
  out.push(leaked.length ? fail('env.tracked', '.env files are not tracked', `tracked: ${leaked.join(', ')}`) : pass('env.tracked', '.env files are not tracked'));

  const text = ctx.readText('.env.example');
  if (text === undefined) return [...out, fail('env.example', '.env.example holds no secrets', '.env.example is missing')];
  const filled: string[] = [];
  for (const raw of text.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(raw);
    if (!m || !SECRET_NAME.test(m[1]!)) continue;
    const value = m[2]!.replace(/(^|\s)#.*$/, '').trim().replace(/^["']|["']$/g, '');
    if (value) filled.push(m[1]!);
  }
  out.push(filled.length ? fail('env.example', '.env.example holds no secrets', `a value is set for ${filled.join(', ')}`) : pass('env.example', '.env.example holds no secrets'));
  return out;
}
