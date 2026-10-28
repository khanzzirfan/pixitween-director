import type { FilmStore } from '@shared/ports';
import type { FilmVersion } from '@shared/composition';
import type { ToolCtx, ToolResult } from '@shared/tools';
import { runTool } from '../tools/registry';
import type { ProposedFix } from './visual';

/** Wraps a film store so every commit and mutate is recorded with `source`, whatever the caller passes. */
export function withCommitSource(films: FilmStore, source: FilmVersion['source']): FilmStore {
  return {
    ...films,
    commit: (id, next, _source, note) => films.commit(id, next, source, note),
    mutate: (id, fn, _source, note) => films.mutate(id, fn, source, note),
  };
}

export interface AppliedFix {
  fix: ProposedFix;
  result: ToolResult;
}

/** Runs fixes through the tool registry, so each one is validated and recorded as a review edit. Stops at the first failure. */
export async function applyFixes(
  ctx: ToolCtx,
  fixes: ProposedFix[],
): Promise<{ applied: AppliedFix[]; failed?: { fix: ProposedFix; error: string } }> {
  const reviewCtx: ToolCtx = { ...ctx, films: withCommitSource(ctx.films, 'review'), source: 'review' };
  const applied: AppliedFix[] = [];
  for (const fix of fixes) {
    const result = await runTool(reviewCtx, fix.tool, fix.args);
    if (!result.ok) return { applied, failed: { fix, error: result.error } };
    applied.push({ fix, result });
  }
  return { applied };
}
