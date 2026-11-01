// Owned by S7b. The proposeGenerate tool, the runner registration and the resume-after-restart hook.
import { z } from 'zod';
import type { ToolCtx, ToolDef } from '@shared/tools';
import { sceneInfo, type Comp } from '../authoring/api';
import { CLIPPY_ESTIMATED_CREDITS } from '../clippy/types';
import { createJobStore, type JobRecord, type JobStore } from '../generate/jobs';
import { createRunner, type Runner } from '../generate/runner';
import { setGenerationRunner, setRevertHandler } from '../generate/runner-registry';
import { getGenerateServices } from '../generate/services';
import { revertToMotion } from '../generate/swap';

const runner: Runner = createRunner();

export const proposeGenerate: ToolDef<{ sceneId: string }> = {
  name: 'proposeGenerate',
  description: 'Offer to turn one scene into a generated video clip. The user must approve it; nothing is spent until they do.',
  params: z.object({ sceneId: z.string() }),
  async run(ctx, a) {
    const film = await ctx.films.get(ctx.filmId);
    const scene = film.composition ? sceneInfo(film.composition as Comp).find((s) => s.id === a.sceneId) : undefined;
    if (!scene || scene.mode !== 'generate') return { ok: false, error: 'scene is not a generate scene' };
    const p = getGenerateServices().approvals.propose(ctx.filmId, a.sceneId, CLIPPY_ESTIMATED_CREDITS);
    // The token is a capability: it goes to the approval panel in the event and never into the model's context.
    ctx.emit({ type: 'generate.proposed', sceneId: a.sceneId, reason: 'Generate a video clip for this scene.', estCredits: CLIPPY_ESTIMATED_CREDITS, token: p.token });
    return { ok: true, data: { proposed: true, estCredits: CLIPPY_ESTIMATED_CREDITS } };
  },
};

export const tools: ToolDef[] = [proposeGenerate as ToolDef];

/** 'Keep as motion': take the clip out and restore the scene as it was. Safe to call twice. */
export async function revertScene(ctx: ToolCtx, sceneId: string, jobs: JobStore = createJobStore()): Promise<void> {
  const film = await ctx.films.get(ctx.filmId);
  const comp = film.composition as Comp | undefined;
  const scene = comp ? sceneInfo(comp).find((s) => s.id === sceneId) : undefined;
  if (!comp || !scene || !scene.layerIds.includes(`${sceneId}:clip`)) return;
  const original = (await jobs.get(ctx.filmId, sceneId))?.originalDurationSec ?? scene.durationSec;
  await ctx.films.mutate(ctx.filmId, (f) => ({ next: revertToMotion(f.composition as Comp, sceneId, original), data: null }), 'user', `scene ${sceneId} back to motion`);
}

setGenerationRunner(runner);
setRevertHandler((ctx, sceneId) => revertScene(ctx, sceneId));

/** Carries on every job that was in flight when the server stopped, and returns how many were resumed. It resolves when they have all finished. */
export async function resumeGenerations(
  makeCtx: (filmId: string) => ToolCtx | Promise<ToolCtx>,
  opts: { jobs?: JobStore; runner?: { resume(ctx: ToolCtx, job: JobRecord): Promise<void> } } = {},
): Promise<number> {
  const jobs = opts.jobs ?? createJobStore();
  const r = opts.runner ?? runner;
  let resumed = 0;
  for (const job of await jobs.listActive()) {
    try {
      await r.resume(await makeCtx(job.filmId), job);
      resumed += 1;
    } catch (e) {
      console.error(`resume failed for ${job.filmId}/${job.sceneId}:`, e);
    }
  }
  return resumed;
}
