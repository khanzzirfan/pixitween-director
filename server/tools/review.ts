import { z } from 'zod';
import type { ToolDef } from '@shared/tools';
import { latestFrames } from '../review/frames';
import { reviewDeterministic, reviewScene } from '../review/loop';

const noComposition = async (ctx: Parameters<ToolDef['run']>[0]) => !(await ctx.films.get(ctx.filmId)).composition;

export const STUB_OWNER = 'S5b' as const;

/** Review one scene with its newest captured frames. Chat calls this after an edit to check its own work. */
export const reviewScoped: ToolDef<{ sceneId: string }> = {
  name: 'reviewScene',
  description: 'Check one scene for layout and readability problems using the frames captured for it, and fix what is clearly wrong.',
  params: z.object({ sceneId: z.string() }),
  async run(ctx, a) {
    if (await noComposition(ctx)) return { ok: false, error: 'film has no composition yet' };
    const frames = await latestFrames(ctx, a.sceneId);
    if (!frames.length) return { ok: false, error: 'capture frames first' };
    const result = await reviewScene(ctx, a.sceneId, frames);
    return { ok: true, data: { reverted: result.reverted, applied: result.applied, unresolved: result.unresolved.map((f) => f.kind) } };
  },
};

export const reviewRules: ToolDef<{ sceneIds?: string[] }> = {
  name: 'reviewDeterministic',
  description: 'Run the automatic layout rules on some or all scenes, without a visual check or any cost.',
  params: z.object({ sceneIds: z.array(z.string()).optional() }),
  async run(ctx, a) {
    if (await noComposition(ctx)) return { ok: false, error: 'film has no composition yet' };
    const { findings, skipped } = await reviewDeterministic(ctx, a.sceneIds);
    return { ok: true, data: { findings: findings.map((f) => ({ sceneId: f.sceneId, kind: f.kind, evidence: f.evidence })), skipped } };
  },
};

export const tools: ToolDef[] = [reviewScoped, reviewRules];
