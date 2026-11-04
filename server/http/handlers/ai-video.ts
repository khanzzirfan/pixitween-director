// The AI movie: a finished film's pictures go to Fal's MiniMax H3 as reference frames and come back as one clip.
// Quote first (free), then start (spends), then poll. The Fal key is always the visitor's own, saved in Settings: the server has none to spend.
import type { Context, Hono } from 'hono';
import { AI_VIDEO_RESOLUTIONS, type AiVideoJob, type AiVideoQuote, type AiVideoResolution } from '@shared/api';
import { isFilmId } from '@shared/composition';
import { loadEnv } from '../../env';
import { createFalClient, type FalClient } from '../../fal/client';
import { FalApiError } from '../../fal/errors';
import { buildH3Request, captureFrames, planAiFilm, quoteAiFilm } from '../../video/ai-film';
import { createJobId, readJob, writeJob, type VideoJob } from '../../video/jobs';
import { hashIp, ipMatches, openVideoSession } from '../../video/session';
import { clientIp } from '../client-ip';
import type { AppDeps } from '../deps';

export interface AiVideoOptions {
  dataDir?: () => string;
  fetchImpl?: typeof fetch;
}

type KeyChoice = { key: string; sessionId: string } | { error: 'ip_locked' | 'video_key_missing' };

const FAL_HOST = /(^|\.)fal\.(media|run|ai)$/;

const isResolution = (x: unknown): x is AiVideoResolution => typeof x === 'string' && (AI_VIDEO_RESOLUTIONS as readonly string[]).includes(x);

export function registerAiVideoRoutes(app: Hono, deps: AppDeps, opts: AiVideoOptions = {}): void {
  const dataDir = () => opts.dataDir?.() ?? deps.dataDir ?? loadEnv().DATA_DIR;
  const fal = (apiKey: string): FalClient => createFalClient({ apiKey, fetchImpl: opts.fetchImpl });

  /** The visitor's saved Fal key for this browser session and network. */
  function chooseKey(c: Context): KeyChoice {
    const opened = openVideoSession(dataDir(), c.req.header('cookie'), clientIp(c));
    if (opened.ok && opened.session.keys.fal) return { key: opened.session.keys.fal, sessionId: opened.session.id };
    return { error: !opened.ok && opened.error === 'ip_locked' ? 'ip_locked' : 'video_key_missing' };
  }

  /** The key that started a job, or nothing when this request is not that session. */
  function keyForJob(c: Context, job: VideoJob): string | undefined {
    const opened = openVideoSession(dataDir(), c.req.header('cookie'), clientIp(c));
    return opened.ok && opened.session.id === job.sessionId ? opened.session.keys.fal : undefined;
  }

  const failure = (c: Context, error: unknown) => {
    if (error instanceof FalApiError) return c.json({ error: error.code, message: error.message }, (error.status >= 400 && error.status < 600 ? error.status : 502) as 400);
    return c.json({ error: 'ai_video_failed', message: 'The AI movie could not be made.' }, 502);
  };

  async function readFilm(c: Context) {
    const id = c.req.param('id') ?? '';
    if (!isFilmId(id)) return { response: c.json({ error: 'not_found' }, 404) };
    let film;
    try {
      film = await deps.films.get(id);
    } catch {
      return { response: c.json({ error: 'not_found' }, 404) };
    }
    if (!film.composition || film.composition.durationInFrames < 1) return { response: c.json({ error: 'nothing_to_make', message: 'Nothing to make a movie from yet.' }, 409) };
    const comp = film.composition;
    const plan = planAiFilm(comp);
    if (!plan.shots.length) return { response: c.json({ error: 'no_frames', message: 'This film has no pictures to make an AI movie from yet.' }, 409) };
    return { id, comp, plan };
  }

  app.get('/api/films/:id/ai-video/quote', async (c) => {
    const resolution = c.req.query('resolution') ?? '480P';
    if (!isResolution(resolution)) return c.json({ error: 'bad_request' }, 400);
    const read = await readFilm(c);
    if ('response' in read) return read.response;
    const quote: AiVideoQuote = { ...quoteAiFilm(read.plan, resolution), keyReady: 'key' in chooseKey(c) };
    return c.json(quote);
  });

  app.post('/api/films/:id/ai-video', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { resolution?: unknown };
    const resolution = body.resolution ?? '480P';
    if (!isResolution(resolution)) return c.json({ error: 'bad_request' }, 400);
    const chosen = chooseKey(c);
    if ('error' in chosen) return c.json({ error: chosen.error }, chosen.error === 'ip_locked' ? 403 : 409);
    const read = await readFilm(c);
    if ('response' in read) return read.response;
    try {
      const frames = await captureFrames({ assets: deps.assets }, read.comp, read.plan);
      const client = fal(chosen.key);
      const urls: string[] = [];
      for (const [i, frame] of frames.entries()) urls.push(await client.upload(frame, 'image/jpeg', `${read.id}-shot-${i + 1}.jpg`));
      const request = buildH3Request(read.plan, urls, resolution);
      const handle = await client.submit(request.model, request.input);
      const quote = quoteAiFilm(read.plan, resolution);
      const job: VideoJob = {
        id: createJobId(),
        filmId: read.id,
        resolution,
        durationSec: quote.durationSec,
        costUsd: quote.costUsd,
        sessionId: chosen.sessionId,
        ipHash: hashIp(clientIp(c)),
        createdAt: new Date().toISOString(),
        fal: handle,
      };
      writeJob(dataDir(), job);
      const view: AiVideoJob = { id: job.id, filmId: job.filmId, status: 'queued', resolution, durationSec: job.durationSec, costUsd: job.costUsd };
      return c.json(view, 202);
    } catch (error) {
      return failure(c, error);
    }
  });

  /** The job and the key that can read it, or the refusal to send. */
  function open(c: Context): { job: VideoJob; key: string } | { response: Response } {
    const job = readJob(dataDir(), c.req.param('id') ?? '');
    if (!job) return { response: c.json({ error: 'not_found' }, 404) };
    if (!ipMatches(job.ipHash, clientIp(c))) return { response: c.json({ error: 'ip_locked' }, 403) };
    const key = keyForJob(c, job);
    if (!key) return { response: c.json({ error: 'video_key_missing' }, 409) };
    return { job, key };
  }

  app.get('/api/ai-videos/:id', async (c) => {
    const opened = open(c);
    if ('response' in opened) return opened.response;
    const { job } = opened;
    const base = { id: job.id, filmId: job.filmId, resolution: job.resolution, durationSec: job.durationSec, costUsd: job.costUsd };
    try {
      const client = fal(opened.key);
      const status = await client.status(job.fal);
      if (status.status === 'FAILED' || status.status === 'CANCELLED') {
        const view: AiVideoJob = { ...base, status: 'failed', error: 'Fal could not make the video. You were not charged for a failed run.' };
        return c.json(view);
      }
      if (status.status !== 'COMPLETED') {
        const view: AiVideoJob = { ...base, status: status.status === 'IN_PROGRESS' ? 'running' : 'queued', ...(status.queuePosition !== undefined ? { queuePosition: status.queuePosition } : {}) };
        return c.json(view);
      }
      const result = await client.result(job.fal);
      if (!result.videoUrl) return c.json({ ...base, status: 'failed', error: 'Fal finished without a video.' } satisfies AiVideoJob);
      return c.json({ ...base, status: 'succeeded', videoUrl: `/api/ai-videos/${job.id}/download` } satisfies AiVideoJob);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get('/api/ai-videos/:id/download', async (c) => {
    const opened = open(c);
    if ('response' in opened) return opened.response;
    try {
      const result = await fal(opened.key).result(opened.job.fal);
      const url = result.videoUrl ? new URL(result.videoUrl) : undefined;
      if (!url || url.protocol !== 'https:' || !FAL_HOST.test(url.hostname)) return c.json({ error: 'not_ready' }, 404);
      const upstream = await (opts.fetchImpl ?? fetch)(url);
      if (!upstream.ok || !upstream.body) return c.json({ error: 'not_ready' }, 502);
      return new Response(upstream.body, {
        headers: { 'content-type': 'video/mp4', 'content-disposition': `inline; filename="ai-movie-${opened.job.filmId}.mp4"`, 'cache-control': 'private, max-age=3600' },
      });
    } catch (error) {
      return failure(c, error);
    }
  });
}
