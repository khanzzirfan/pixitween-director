// Owned by S7b. Follows one approved scene from submission to a placed, checked clip.
import type { AssetRef, FilmState } from '@shared/composition';
import type { ToolCtx } from '@shared/tools';
import { sceneInfo, type Comp } from '../authoring/api';
import type { ClippyClient } from '../clippy/mcp';
import type { StatusResult } from '../clippy/types';
import { loadEnv } from '../env';
import { probeVideo } from '../media/ffmpeg';
import type { ApprovalStore, ConsumedApproval } from './approval';
import { checkClip } from './clip-check';
import { downloadClip, type DownloadDeps } from './download';
import { submitApproved } from './guard';
import { createJobStore, type JobRecord, type JobStatus, type JobStore } from './jobs';
import { pollJob, type PollDeps, type PollOutcome } from './poll';
import { resolveProductNoun } from './product-noun';
import { publicAssetUrl } from './public-url';
import { getRateLimiter, type RateLimiter } from './rate';
import { buildAnimateRequest } from './request';
import { offerRetry } from './retry';
import type { GenerationRunner } from './runner-registry';
import { getGenerateServices } from './services';
import { prepareSourceStill } from './source-still';
import { swapInClip } from './swap';

const CREDITS = 25;

export interface RunnerDeps {
  clippy?(): ClippyClient;
  approvals?: ApprovalStore;
  jobs?: JobStore;
  rate?: RateLimiter;
  /** Where product-noun.json is cached per film; defaults to the film's data folder next to its jobs. */
  filmsDir?: string;
  poll?: (client: ClippyClient, jobId: string, deps?: PollDeps) => Promise<PollOutcome>;
  sleep?(ms: number): Promise<void>;
  now?(): number;
  env?: { PUBLIC_BASE_URL: string; DATA_DIR?: string };
  download?: DownloadDeps;
}

export type Runner = GenerationRunner & {
  /** Picks up a job that was in flight when the server stopped: polls it again and carries on. */
  resume(ctx: ToolCtx, job: JobRecord): Promise<void>;
};

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createRunner(deps: RunnerDeps = {}): Runner {
  const clippy = () => (deps.clippy ?? (() => {
    const c = getGenerateServices().clippy;
    if (!c) throw new Error('Clippy is not configured (CLIPPY_MCP_URL and CLIPPY_TOKEN)');
    return c;
  }))();
  const jobs = () => deps.jobs ?? (deps.jobs = createJobStore());
  const rate = () => deps.rate ?? getRateLimiter();
  const env = () => deps.env ?? loadEnv();
  const cacheDir = (filmId: string) => `${deps.filmsDir ?? `${env().DATA_DIR ?? './data'}/films`}/${filmId}/generate`;

  const progress = (ctx: ToolCtx, sceneId: string, status: string) => ctx.emit({ type: 'generate.progress', sceneId, status });
  const fail = (ctx: ToolCtx, sceneId: string, text: string) => {
    ctx.emit({ type: 'error', where: 'generate', message: text });
    progress(ctx, sceneId, `failed: ${text}`);
  };

  async function save(rec: JobRecord, status: JobStatus, extra: Partial<JobRecord> = {}): Promise<JobRecord> {
    const next = { ...rec, ...extra, status, updatedAt: new Date().toISOString() };
    await jobs().save(next);
    return next;
  }

  const scenesOf = (film: FilmState) => sceneInfo(film.composition as Comp);

  const hasClipLayer = (film: FilmState, sceneId: string): boolean =>
    ((film.composition?.precomps as Record<string, { layers?: Array<{ id: string }> }> | undefined)?.[sceneId]?.layers ?? []).some((l) => l.id === `${sceneId}:clip`);

  /** Part 2: the job is done at Clippy; fetch the clip, place it, check it. */
  async function finish(ctx: ToolCtx, job: JobRecord, status: StatusResult): Promise<void> {
    const { sceneId } = job;
    let rec = job;
    if (!(await stillGenerating(ctx, sceneId))) {
      progress(ctx, sceneId, 'cancelled');
      await save(rec, 'cancelled');
      return;
    }
    try {
      rec = await save(rec, 'downloading', { creditsCharged: status.creditsCharged ?? CREDITS });
      progress(ctx, sceneId, 'downloading');
      const bytes = await downloadClip(status.resultUrl!, deps.download);
      const asset = await ctx.assets.put(bytes, 'video/mp4', { role: 'clip', sceneId });
      rec = await save(rec, 'placing', { assetId: asset.id });
    } catch (e) {
      fail(ctx, sceneId, message(e));
      await save(rec, 'failed', { error: message(e) });
      return;
    }
    await placeAndCheck(ctx, rec);
  }

  async function stillGenerating(ctx: ToolCtx, sceneId: string): Promise<boolean> {
    const film = await ctx.films.get(ctx.filmId);
    return !!film.composition && scenesOf(film).some((s) => s.id === sceneId && s.mode === 'generate');
  }

  /** Place the stored clip (unless it is already placed) and run the product check. Reads the clip back from the asset store. */
  async function placeAndCheck(ctx: ToolCtx, job: JobRecord): Promise<void> {
    const { sceneId } = job;
    let rec = job;
    const stop = async (text: string) => {
      fail(ctx, sceneId, text);
      await save(rec, 'failed', { error: text });
    };

    let asset: AssetRef;
    let bytes: Buffer;
    let size: { width: number; height: number };
    try {
      asset = (await ctx.assets.list()).find((a) => a.id === rec.assetId)!;
      if (!asset) throw new Error('the downloaded clip is missing from the asset store');
      bytes = await ctx.assets.read(asset.id);
      const probe = await probeVideo(bytes);
      size = { width: probe.width, height: probe.height };
    } catch (e) {
      await stop(message(e));
      return;
    }

    let film = await ctx.films.get(ctx.filmId);
    if (!hasClipLayer(film, sceneId)) {
      try {
        rec = await save(rec, 'placing');
        progress(ctx, sceneId, 'placing');
        const clipSec = rec.clipSec ?? scenesOf(film).find((s) => s.id === sceneId)?.durationSec ?? 5;
        const placed = await ctx.films.mutate(
          ctx.filmId,
          (f) => ({
            next: swapInClip(f.composition as Comp, { sceneId, asset: { id: asset.id, url: asset.url }, clipSec, frame: { width: f.composition!.width, height: f.composition!.height }, clipSize: size }),
            data: null,
          }),
          'generate',
          `generated clip for scene ${sceneId}`,
        );
        if (!placed.ok) {
          await stop('the film rejected the clip');
          return;
        }
      } catch (e) {
        await stop(message(e));
        return;
      }
    }

    rec = await save(rec, 'checking');
    progress(ctx, sceneId, 'checking');
    film = await ctx.films.get(ctx.filmId);
    const noun = await resolveProductNoun(ctx, film, film.composition as Comp, { cacheDir: cacheDir(ctx.filmId) });
    const check = await checkClip(ctx, { clip: bytes, noun, sceneId });

    if ('error' in check) {
      ctx.emit({ type: 'generate.done', sceneId, asset });
      ctx.emit({ type: 'review.finding', sceneId, kind: 'clip-check-failed', evidence: check.error, deterministic: false });
      await save(rec, 'done');
      return;
    }
    ctx.emit({ type: 'generate.done', sceneId, asset, productVisibleFrac: check.productVisibleFrac });
    offerRetry(ctx, { sceneId, frac: check.productVisibleFrac, attempt: rec.attempt, approvals: deps.approvals ?? getGenerateServices().approvals });
    await save(rec, 'done', { productVisibleFrac: check.productVisibleFrac });
  }

  /** Poll to the end, then place the clip when it is done. */
  async function follow(ctx: ToolCtx, job: JobRecord): Promise<void> {
    const { sceneId } = job;
    let rec = job;
    let writes: Promise<unknown> = Promise.resolve();
    const outcome = await (deps.poll ?? pollJob)(clippy(), job.jobId, {
      sleep: deps.sleep,
      now: deps.now,
      onStatus: (s) => {
        if (s.status === 'done' || s.status === 'failed' || s.status === 'cancelled') return;
        progress(ctx, sceneId, s.status);
        // saves run one after another so two writes to the same job file never overlap
        writes = writes.then(async () => void (rec = await save(rec, 'rendering')));
      },
    });
    await writes;
    if (outcome.kind === 'done') return finish(ctx, rec, outcome.status);
    if (outcome.kind === 'cancelled') {
      progress(ctx, sceneId, 'cancelled');
      await save(rec, 'cancelled');
    } else if (outcome.kind === 'timed_out') {
      ctx.emit({ type: 'error', where: 'generate', message: 'the clip did not finish in 15 minutes' });
      progress(ctx, sceneId, 'timed_out');
      await save(rec, 'timed_out');
    } else {
      fail(ctx, sceneId, outcome.message);
      await save(rec, 'failed', { error: outcome.message });
    }
  }

  return {
    async preflight(_ctx, _sceneId) {
      const r = rate().peek();
      return r.ok ? { ok: true } : { ok: false, status: 429, error: 'rate_limited', retryAfterSec: r.retryAfterSec };
    },

    async run(ctx: ToolCtx, input: { sceneId: string; approval: ConsumedApproval }): Promise<void> {
      const { sceneId, approval } = input;
      try {
        progress(ctx, sceneId, 'approved');
        if (!rate().tryAcquire().ok) {
          progress(ctx, sceneId, 'failed: rate_limited');
          return;
        }
        const film = await ctx.films.get(ctx.filmId);
        const scene = scenesOf(film).find((s) => s.id === sceneId);
        if (!scene) throw new Error(`no scene '${sceneId}'`);
        const meta = (film.composition!.meta as { director: { scenes: Record<string, { intent?: string; camera?: { move: 'static' | 'dolly-in' | 'pan' | 'orbit' | 'parallax' } }> } }).director.scenes[sceneId]!;

        let job: JobRecord;
        let model: string;
        try {
          const still = await prepareSourceStill(ctx, sceneId, film.aspect);
          const base = env().PUBLIC_BASE_URL;
          const args = buildAnimateRequest({
            filmId: ctx.filmId,
            aspect: film.aspect,
            scene: { id: sceneId, durationSec: scene.durationSec, intent: meta.intent ?? '', camera: meta.camera?.move ?? 'static' },
            stillUrl: publicAssetUrl(base, ctx.assets.url(still.asset.id)),
            productPhotoUrl: publicAssetUrl(base, ctx.assets.url(film.brief.productAssetId)),
            attempt: approval.attempt,
            adjust: approval.attempt > 1,
          });
          model = args.model;
          const sub = await submitApproved(clippy(), approval, args);
          const now = new Date().toISOString();
          job = { filmId: ctx.filmId, sceneId, jobId: sub.jobId, status: 'submitted', attempt: approval.attempt, submittedAt: now, updatedAt: now, originalDurationSec: scene.durationSec, clipSec: args.durationSec };
          await jobs().save(job);
        } catch (e) {
          fail(ctx, sceneId, message(e));
          return;
        }
        progress(ctx, sceneId, 'submitted');
        ctx.ledger.addCredits(ctx.filmId, CREDITS, `animate_image ${model} scene ${sceneId}`);
        await follow(ctx, job);
      } catch (e) {
        fail(ctx, sceneId, message(e));
      }
    },

    async resume(ctx, job) {
      try {
        if (job.status === 'placing' || job.status === 'checking') {
          if (!job.assetId) throw new Error('the stored job has no clip to place');
          if (!(await stillGenerating(ctx, job.sceneId))) {
            progress(ctx, job.sceneId, 'cancelled');
            await save(job, 'cancelled');
            return;
          }
          await placeAndCheck(ctx, job);
        } else if (job.status === 'downloading') {
          // the old signed URL may have expired, so ask for a fresh one
          const status = await clippy().getLiveAnimateStatus(job.jobId);
          if (status.status === 'done' && status.resultUrl) await finish(ctx, job, status);
          else await follow(ctx, job);
        } else {
          await follow(ctx, job);
        }
      } catch (e) {
        fail(ctx, job.sceneId, message(e));
      }
    },
  };
}
