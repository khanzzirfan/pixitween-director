// Owned by S10. Every relative link in the README points at a tracked file or folder.
import { posix } from 'node:path';
import { fail, pass, type CheckResult, type PreflightCtx } from '../types';

const TITLE = 'README links resolve';

/** The link targets of a markdown text: `[text](target)`, skipping fenced code. */
export function linkTargets(text: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    for (const m of line.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) out.push(m[1]!);
  }
  return out;
}

export function checkReadmeLinks(ctx: PreflightCtx, file = 'README.md'): CheckResult[] {
  const text = ctx.readText(file);
  if (text === undefined) return [fail('readme.links', TITLE, `${file} is missing`)];
  const tracked = new Set(ctx.tracked);
  const dirs = new Set<string>();
  for (const p of ctx.tracked) for (let d = posix.dirname(p); d !== '.' && d !== '/'; d = posix.dirname(d)) dirs.add(d);
  const missing: string[] = [];
  for (const raw of linkTargets(text)) {
    if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(raw)) continue; // https:, mailto:, an anchor
    const target = decodeURIComponent(raw.split('#')[0]!.split('?')[0]!);
    if (!target) continue;
    const resolved = posix.normalize(posix.join(posix.dirname(file), target)).replace(/\/$/, '');
    if (!tracked.has(resolved) && !dirs.has(resolved)) missing.push(resolved);
  }
  if (missing.length) return [fail('readme.links', TITLE, `not tracked: ${[...new Set(missing)].join(', ')}`)];
  return [pass('readme.links', TITLE)];
}
