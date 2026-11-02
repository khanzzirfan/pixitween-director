// Owned by S10. The PRD files exist and nothing in them is silently unfinished.
import { fail, pass, pending, type CheckResult, type PreflightCtx } from '../types';

/** The 14 PRDs of the first build wave, the ones the documents count. Later PRDs (crew, 3D, shell) are checked for completion too, but are not required. */
export const EXPECTED_PRDS = [
  'prd-s02-skeleton',
  'prd-s03a-authoring-core',
  'prd-s03b-director-agent',
  'prd-s04-art-layers',
  'prd-s05a-review-rules',
  'prd-s05b-review-visual',
  'prd-s06-chat-edit',
  'prd-s07a-clippy-client',
  'prd-s07b-generate-integration',
  'prd-s08a-export-gallery',
  'prd-s08b-deploy',
  'prd-s09-local-mode',
  'prd-s10-docs-submission',
  'prd-s11-mcp-server',
] as const;

export function checkPrdExpected(ctx: PreflightCtx): CheckResult[] {
  const have = new Set(ctx.tracked);
  const missing = EXPECTED_PRDS.filter((s) => !have.has(`ralph/${s}.json`));
  return missing.length
    ? [fail('prd.expected', `all ${EXPECTED_PRDS.length} PRD files exist`, `missing: ${missing.join(', ')}`)]
    : [pass('prd.expected', `all ${EXPECTED_PRDS.length} PRD files exist`, `${EXPECTED_PRDS.length}/${EXPECTED_PRDS.length}`)];
}

interface Prd {
  userStories?: Array<{ id: string; passes?: boolean; notes?: string }>;
}

export function checkPrdComplete(ctx: PreflightCtx): CheckResult[] {
  const files = ctx.tracked.filter((p) => /^ralph\/prd-[^/]+\.json$/.test(p)).sort();
  return files.map((file) => {
    const stem = file.slice('ralph/'.length, -'.json'.length);
    const id = `prd.complete:${stem}`;
    const title = `${stem} is finished or explained`;
    const prd = ctx.json<Prd>(file);
    if (!prd || !Array.isArray(prd.userStories)) return fail(id, title, `${file} is not valid PRD JSON`);
    const open = prd.userStories.filter((s) => !s.passes);
    const done = `${prd.userStories.length - open.length}/${prd.userStories.length}`;
    if (!open.length) return pass(id, title, done);
    const unexplained = open.filter((s) => !(s.notes ?? '').trim());
    if (unexplained.length) {
      const ids = unexplained.map((s) => s.id);
      return fail(id, title, `${done}; no notes on ${ids.length > 4 ? `${ids.slice(0, 3).join(', ')} and ${ids.length - 3} more` : ids.join(', ')}`);
    }
    return pending(id, title, `${done}; every open story has a note: ${open.map((s) => s.id).join(', ')}`);
  });
}
