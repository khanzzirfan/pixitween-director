// Owned by S12b. The crew's HTTP surface (contract 06 section 7). Mutating routes sit behind the passcode middleware like the others;
// the board and the log are read-only so the gallery replay works for anyone.
import { Buffer } from 'node:buffer';
import type { Hono } from 'hono';
import { z } from 'zod';
import { WRITING_KINDS, storyboardOpSchema, type Job, type StoryboardOp } from '@shared/crew';
import { isFilmId, type FilmState } from '@shared/composition';
import { TERMINAL } from '../../crew/board';
import { createCrewPersist } from '../../crew/persist';
import { directShowrunner, ensureCrewSession, getCrewSession } from '../../crew/run-crew';
import { restoreScene } from '../../crew/scene-snapshot';
import { autoDispatch } from '../../crew/showrunner';
import { newTurn, reviseStoryboard } from '../../crew/showrunner-tools';
import { StoryboardOpError } from '../../crew/storyboard-ops';
import { loadEnv } from '../../env';
import { BriefTooLongError, EmptyBriefError, transcribeBrief } from '../../listener';
import { getProductNoun } from '../../authoring/api';
import type { Comp } from '../../authoring/types';
import type { AppDeps } from '../deps';

const notFound = { error: 'not_found' } as const;
const bodySchema = z.object({ ops: z.array(storyboardOpSchema).min(1).max(8) });

const dataDir = (deps: AppDeps) => deps.dataDir ?? loadEnv().DATA_DIR;

/** One line for the showrunner about what the user did by hand to the storyboard. */
export function describeOps(ops: StoryboardOp[]): string {
  const parts = ops.map((o) => {
    if (o.op === 'add') return `added a scene${o.after === null ? ' first' : o.after ? ` after ${o.after}` : ' at the end'}`;
    if (o.op === 'remove') return `removed ${o.sceneId}`;
    if (o.op === 'move') return `moved ${o.sceneId} ${o.after === null ? 'to the start' : `after ${o.after}`}`;
    return `changed ${Object.keys(o.patch).join(', ')} of ${o.sceneId}`;
  });
  return `The user edited the storyboard: ${parts.join('; ')}.`;
}

async function getFilm(deps: AppDeps, id: string): Promise<FilmState | undefined> {
  if (!isFilmId(id)) return undefined;
  try {
    return await deps.films.get(id);
  } catch {
    return undefined;
  }
}

export function registerCrewRoutes(app: Hono, deps: AppDeps): void {
  app.get('/api/films/:id/crew', async (c) => {
    const film = await getFilm(deps, c.req.param('id'));
    if (!film) return c.json(notFound, 404);
    const live = getCrewSession(film.id);
    const jobs: Job[] = live ? live.crew.board.list() : await createCrewPersist(dataDir(deps), film.id).loadBoard();
    return c.json({ jobs, ...(film.styleBible ? { styleBible: film.styleBible } : {}), storyboardRev: film.storyboardRev ?? 0 });
  });

  app.get('/api/films/:id/log', async (c) => {
    const film = await getFilm(deps, c.req.param('id'));
    if (!film) return c.json(notFound, 404);
    return c.json((await deps.bus.replay(film.id)).map((e) => e.event));
  });

  app.post('/api/films/:id/storyboard', async (c) => {
    const film = await getFilm(deps, c.req.param('id'));
    if (!film) return c.json(notFound, 404);
    if (!film.crew) return c.json({ error: 'not_a_crew_film' }, 409);
    const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_ops', message: parsed.error.issues[0]?.message ?? 'invalid ops' }, 400);
    const session = await ensureCrewSession(film.id);
    // the user is the director: the edit applies now, with no model in the loop; builders start for what changed
    const crew = { ...session.crew, source: 'user' as const, turn: newTurn() };
    let revision;
    try {
      revision = await reviseStoryboard(crew, parsed.data.ops);
    } catch (e) {
      if (e instanceof StoryboardOpError) return c.json({ error: 'bad_ops', message: e.message }, 400);
      throw e;
    }
    const started = await autoDispatch(crew, 'user');
    if (started.length && film.status === 'ready') {
      await deps.films.update(film.id, { status: 'building' });
      deps.makeToolCtx(film.id).emit({ type: 'film.status', status: 'building' });
    }
    // debounced like a job result: the showrunner hears of it and may adjust the rest
    session.push({ from: 'system', text: describeOps(parsed.data.ops) });
    return c.json({ rev: revision.rev, needsMode: revision.needsMode });
  });

  app.post('/api/films/:id/jobs/:jobId/cancel', async (c) => {
    const film = await getFilm(deps, c.req.param('id'));
    if (!film) return c.json(notFound, 404);
    const session = getCrewSession(film.id);
    const job = session?.crew.board.get(c.req.param('jobId'));
    if (!session || !job) return c.json({ error: 'job_not_active' }, 404);
    if (TERMINAL.includes(job.status)) return c.json({ error: 'job_finished', status: job.status }, 409);
    await session.scheduler.cancel(job.id);
    session.push({ from: 'system', text: `The user cancelled job ${job.id} (${job.kind}${job.sceneId ? ` ${job.sceneId}` : ''}).` });
    return c.json({ ok: true });
  });

  app.post('/api/films/:id/takes/:jobId/pick', async (c) => {
    const film = await getFilm(deps, c.req.param('id'));
    if (!film) return c.json(notFound, 404);
    const body = z.object({ takeFilmId: z.string() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request' }, 400);
    const session = getCrewSession(film.id);
    if (!session?.crew.takes) return c.json({ error: 'takes_unavailable' }, 409);
    const r = await session.crew.takes.pick({ takeFilmId: body.data.takeFilmId, reason: 'picked by the user' });
    return r.ok ? c.json({ version: r.version ?? (await deps.films.get(film.id)).version }) : c.json({ error: 'pick_failed', message: r.error }, 409);
  });

  app.post('/api/films/:id/scenes/:sceneId/revert', async (c) => {
    const film = await getFilm(deps, c.req.param('id'));
    if (!film?.crew) return c.json(film ? { error: 'not_a_crew_film' } : notFound, film ? 409 : 404);
    const sceneId = c.req.param('sceneId');
    const session = await ensureCrewSession(film.id);
    const jobs = session.crew.board.list().filter((j) => j.sceneId === sceneId && WRITING_KINDS.includes(j.kind));
    if (jobs.some((j) => !TERMINAL.includes(j.status))) return c.json({ error: 'scene_busy' }, 409);
    // the snapshot of the newest finished job is the scene as the job before it left it
    const done = jobs.filter((j) => j.status === 'done' && j.kind !== 'revert');
    const latest = done.at(-1);
    const snap = latest && done.length >= 2 ? await createCrewPersist(dataDir(deps), film.id).loadSnapshot(latest.id) : undefined;
    if (!latest || !snap) return c.json({ error: 'nothing_to_revert' }, 409);
    const job = session.crew.board.add({ kind: 'revert', sceneId, origin: 'user', brief: `revert ${latest.id}`, reason: 'the user went back' });
    session.crew.board.update(job.id, { status: 'running' });
    try {
      const r = await deps.films.mutate(film.id, (f) => ({ next: restoreScene(f.composition as Comp, sceneId, snap), data: null }), 'user', `revert ${sceneId}`);
      if (!r.ok) throw new Error('the reverted scene was refused');
      session.crew.board.update(job.id, { status: 'done', summary: `back to before ${latest.id}`, version: r.version });
      session.push({ from: 'system', text: `The user reverted ${sceneId} to before ${latest.id}.` });
      return c.json({ version: r.version });
    } catch (e) {
      session.crew.board.update(job.id, { status: 'failed', error: e instanceof Error ? e.message : String(e) });
      return c.json({ error: 'revert_failed' }, 500);
    }
  });

  app.post('/api/films/:id/voice', async (c) => {
    const film = await getFilm(deps, c.req.param('id'));
    if (!film) return c.json(notFound, 404);
    if (!film.crew) return c.json({ error: 'not_a_crew_film' }, 409);
    if (film.status === 'new' || film.status === 'failed') return c.json({ error: 'film_not_ready' }, 409);
    if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) return c.json({ error: 'unsupported_media' }, 415);
    const body = await c.req.parseBody();
    const file = body.audio;
    if (!(file instanceof File) || file.size === 0) return c.json({ error: 'audio_required' }, 400);
    const mime = file.type.toLowerCase();
    if (!(mime.startsWith('audio/') || mime === 'video/webm')) return c.json({ error: 'unsupported_media' }, 415);
    if (file.size > loadEnv().MAX_UPLOAD_MB * 1024 * 1024) return c.json({ error: 'too_large' }, 413);
    const bytes = Buffer.from(await file.arrayBuffer());
    let text: string;
    try {
      const noun = film.composition ? getProductNoun(film.composition as Comp) : undefined;
      text = (await transcribeBrief(bytes, { meta: deps.meta, keywords: noun ? [noun] : [] })).text;
    } catch (e) {
      if (e instanceof BriefTooLongError) return c.json({ error: 'audio_too_long', message: e.message }, 400);
      if (e instanceof EmptyBriefError) return c.json({ error: 'empty_audio', message: e.message }, 400);
      throw e;
    }
    deps.makeToolCtx(film.id).emit({ type: 'listener.transcript', text });
    const inboxId = await directShowrunner(deps, film.id, text);
    return c.json({ accepted: true, inboxId, transcript: text }, 202);
  });
}
