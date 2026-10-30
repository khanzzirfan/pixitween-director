// Owned by S10. Each submission document exists, has its headings in order and no draft marker; owner markers are listed as pending.
import { REQUIRED_DOCS, type Heading, type RequiredDoc } from '../required-docs';
import { fail, pass, pending, type CheckResult, type PreflightCtx } from '../types';

/** The headings of a markdown text, skipping fenced code. */
export function headingsOf(text: string): Heading[] {
  const out: Heading[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1]!.length, text: m[2]! });
  }
  return out;
}

export function checkDoc(ctx: PreflightCtx, doc: RequiredDoc): CheckResult {
  const id = `docs:${doc.path}`;
  const title = `${doc.path} is complete`;
  const text = ctx.readText(doc.path);
  if (text === undefined) return fail(id, title, `${doc.path} is missing`);
  const have = headingsOf(text);
  let at = 0;
  for (const want of doc.headings) {
    const i = have.findIndex((x, k) => k >= at && x.level === want.level && x.text === want.text);
    if (i < 0) return fail(id, title, `heading '${'#'.repeat(want.level)} ${want.text}' is missing or out of order`);
    at = i + 1;
  }
  const lines = text.split('\n');
  const draft = lines.findIndex((l) => l.includes('<fill:'));
  if (draft >= 0) return fail(id, title, `a draft marker is left on line ${draft + 1}`);
  return pass(id, title, `${doc.headings.length} headings`);
}

export function checkDocs(ctx: PreflightCtx): CheckResult[] {
  return REQUIRED_DOCS.map((d) => checkDoc(ctx, d));
}

const MARKER = /<!--\s*OWNER:([\w-]+)\s*-->/g;

/** Every OWNER marker still in the documents. Pending, never a fail: the owner fills them. */
export function checkOwnerMarkers(ctx: PreflightCtx): CheckResult[] {
  const found = new Set<string>();
  for (const doc of REQUIRED_DOCS) {
    const text = ctx.readText(doc.path);
    if (text) for (const m of text.matchAll(MARKER)) found.add(m[1]!);
  }
  if (!found.size) return [pass('owner.markers', 'no owner markers are left')];
  return [pending('owner.markers', 'the owner still has markers to fill', [...found].sort().join(', '))];
}
