import { Buffer } from 'node:buffer';
import type { Hono } from 'hono';
import { isFilmId, type FilmState } from '@shared/composition';
import type { ToolCtx } from '@shared/tools';
import type { AppDeps } from '../deps';
import { makeToolCtx } from '../deps';
import { compareGeometry, measuredForRules, type MeasuredBoxes } from '../../review/compare';
import type { Box } from '../../review/types';
import { FrameInputError, storeFrames, validateFrames } from '../../review/frames';
import { findFix } from '../../review/fix-log';
import { runReview } from '../../review/loop';
import { listScenes } from '../../review/geometry';
import type { VisualFrame } from '../../review/visual';
import { resolveCapture, waitingCapture } from '../../crew/workers/critic';

export const STUB_OWNER = 'S5b' as const;

export type ReviewRunner = (
  ctx: ToolCtx,
  input: { frames: Record<string, VisualFrame[]>; measured?: Record<string, Box> },
) => Promise<unknown>;

const defaultRun: ReviewRunner = (ctx, input) => runReview(ctx, { frames: input.frames, measured: input.measured });

function sceneIdsOf(film: FilmState): string[] {
  if (film.composition) return listScenes(film.composition).map((s) => s.sceneId);
  return film.storyboard?.scenes.map((s) => s.id) ?? [];
}

function parseJsonField(raw: unknown, name: string): unknown {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') throw new FrameInputError(400, 'bad_json', `${name} must be JSON text.`);
  try {
    return JSON.parse(raw);
  } catch {
    throw new FrameInputError(400, 'bad_json', `${name} is not valid JSON.`);
  }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The browser's measured text boxes, checked field by field so a bad payload is a 400 and not a crash in the geometry maths. */
function parseTextBoxes(raw: unknown): MeasuredBoxes | undefined {
  if (raw === undefined) return undefined;
  const bad = () => new FrameInputError(400, 'bad_text_boxes', 'textBoxes must map layer ids to {frame, box:{left,top,right,bottom}} numbers.');
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw bad();
  const out: MeasuredBoxes = {};
  for (const [layerId, m] of Object.entries(raw)) {
    const v = m as { frame?: unknown; box?: Record<string, unknown> } | null;
    const b = v?.box;
    if (!v || !finite(v.frame) || !b || typeof b !== 'object') throw bad();
    if (!finite(b.left) || !finite(b.top) || !finite(b.right) || !finite(b.bottom)) throw bad();
    out[layerId] = { frame: v.frame, box: { left: b.left, top: b.top, right: b.right, bottom: b.bottom } };
  }
  return out;
}

/** A stale 'reviewing' status left by a crash is cleared on start, with one status event per film. */
async function resetStaleReviews(deps: AppDeps): Promise<void> {
  for (const film of await deps.films.list()) {
    if (film.status !== 'reviewing') continue;
    await deps.films.update(film.id, { status: 'ready' });
    makeToolCtx(deps, film.id).emit({ type: 'film.status', status: 'ready' });
  }
}

export function registerReviewRoutes(app: Hono, deps: AppDeps, o: { run?: ReviewRunner } = {}): void {
  const run = o.run ?? defaultRun;
  // Claimed synchronously, before any await, so two simultaneous uploads cannot both pass the busy check.
  const busy = new Set<string>();
  void resetStaleReviews(deps).catch((e: unknown) => console.error('review reset failed:', e));

  app.post('/api/films/:id/frames', async (c) => {
    const id = c.req.param('id');
    if (!isFilmId(id)) return c.json({ error: 'not_found' }, 404);
    let film: FilmState;
    try {
      film = await deps.films.get(id);
    } catch {
      return c.json({ error: 'not_found' }, 404);
    }
    try {
      const body = await c.req.parseBody({ all: true }).catch(() => {
        throw new FrameInputError(400, 'bad_form', 'Send the frames as multipart form data.');
      });
      const rawFiles = Array.isArray(body.frames) ? body.frames : body.frames ? [body.frames] : [];
      const files = await Promise.all(
        rawFiles
          .filter((f): f is File => typeof File !== 'undefined' && f instanceof File)
          .map(async (f) => ({ bytes: Buffer.from(await f.arrayBuffer()), name: f.name })),
      );
      const phase = c.req.query('phase') === 'after' || body.phase === 'after' ? 'after' : 'before';
      const meta = parseJsonField(body.meta, 'meta');
      const textBoxes = parseTextBoxes(parseJsonField(body.textBoxes, 'textBoxes'));
      const valid = validateFrames(files, meta, { sceneIds: sceneIdsOf(film) });

      // frames a crew critique asked for go to that job, and nothing else is started (design 5.9)
      const requestId = typeof body.requestId === 'string' ? body.requestId : undefined;
      if (requestId && phase === 'before') {
        const want = waitingCapture(requestId);
        if (!want || want.filmId !== id) return c.json({ error: 'unknown_request', message: 'No critique is waiting for these frames.' }, 409);
        if (valid.some((f) => f.meta.sceneId !== want.sceneId)) throw new FrameInputError(400, 'wrong_scene', `The frames must all be of scene '${want.sceneId}'.`);
        const stored = await storeFrames(deps.assets, id, valid, { phase: 'before', batch: new Date().toISOString() });
        resolveCapture(requestId, {
          frames: stored.map((f) => ({ id: f.id, atSec: f.atSec, image: f.image })),
          ...(textBoxes ? { textBoxes } : {}),
        });
        return c.json({ review: 'crew', frames: stored.length }, 202);
      }
      // a crew film has one reviewer, the critic, so a scene is never reviewed and billed twice
      if (film.crew && phase === 'before') return c.json({ error: 'crew_reviews', message: 'This film is reviewed by its crew.' }, 409);

      if (phase === 'after') {
        const ctx = makeToolCtx(deps, id);
        let stored = 0;
        const frames = await storeFrames(deps.assets, id, valid, { phase: 'after', batch: new Date().toISOString() });
        for (const f of frames) {
          stored++;
          const fix = findFix(id, f.sceneId, f.atSec);
          if (!fix) continue;
          ctx.emit({
            type: 'review.fix',
            sceneId: f.sceneId,
            atSec: f.atSec,
            beforeFrame: fix.beforeFrame,
            afterFrame: f.id,
            note: fix.note,
          });
        }
        return c.json({ stored });
      }

      if (film.status === 'reviewing' || busy.has(id)) return c.json({ error: 'film_busy' }, 409);
      busy.add(id);
      let started = false;
      try {
        const batch = new Date().toISOString();
        const frames = await storeFrames(deps.assets, id, valid, { phase: 'before', batch });
        const comp = film.composition;
        const measured = textBoxes && comp ? measuredForRules(comp, textBoxes) : undefined;
        const geometry = textBoxes && comp ? compareGeometry(comp, textBoxes) : null;
        const byScene: Record<string, VisualFrame[]> = {};
        for (const f of frames) (byScene[f.sceneId] ??= []).push({ id: f.id, atSec: f.atSec, image: f.image });

        const ctx = makeToolCtx(deps, id);
        // the review itself emits the 'reviewing' event; this only sets the status before the run starts
        await deps.films.update(id, { status: 'reviewing' });
        started = true;
        void Promise.resolve()
          .then(() => run(ctx, { frames: byScene, measured }))
          .catch(async (e: unknown) => {
            ctx.emit({ type: 'error', where: 'review', message: e instanceof Error ? e.message : String(e) });
            await deps.films.update(id, { status: 'ready' }).catch(() => undefined);
            ctx.emit({ type: 'film.status', status: 'ready' });
          })
          .finally(() => busy.delete(id));
        return c.json({ review: 'started', frames: frames.length, geometry }, 202);
      } finally {
        if (!started) busy.delete(id);
      }
    } catch (e) {
      if (e instanceof FrameInputError) return c.json({ error: e.code, message: e.message }, e.status);
      throw e;
    }
  });
}
