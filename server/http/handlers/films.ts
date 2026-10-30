import type { Hono } from 'hono';
import { getAdmission } from '../../admission';
import { bindDirector, runDirector } from '../../agent/director';
import { BriefTooLongError, EmptyBriefError, transcribeBrief } from '../../listener';
import { bindCrew, runCrew } from '../../crew/run-crew';
import { loadEnv } from '../../env';
import type { AppDeps } from '../deps';
import { InputError, parseCreateFilm } from './films-input';

export const STUB_OWNER = 'S3b' as const;

export function registerFilmsRoutes(app: Hono, deps: AppDeps): void {
  app.post('/api/films', async (c) => {
    let input;
    try {
      input = await parseCreateFilm(await c.req.parseBody(), { maxBytes: loadEnv().MAX_UPLOAD_MB * 1024 * 1024 });
    } catch (e) {
      if (e instanceof InputError) return c.json({ error: e.code, message: e.message }, e.status);
      throw e;
    }
    const admission = getAdmission(deps);
    const gate = admission.canAccept();
    if (!gate.ok)
      return c.json({ error: 'busy', message: 'The film queue is full.', retryAfterSec: gate.retryAfterSec }, 429, {
        'Retry-After': String(gate.retryAfterSec),
      });
    const product = await deps.assets.put(input.product.bytes, input.product.mime, { role: 'product-photo' });
    let text = input.brief!;
    if (input.audio) {
      try {
        text = (await transcribeBrief(input.audio.bytes, { meta: deps.meta, keywords: input.title ? [input.title] : [] })).text;
      } catch (e) {
        if (e instanceof BriefTooLongError) return c.json({ error: 'audio_too_long', message: e.message }, 400);
        if (e instanceof EmptyBriefError) return c.json({ error: 'empty_brief', message: e.message }, 400);
        throw e;
      }
    }
    const env = loadEnv();
    const crewOn = env.CREW_ENABLED; // the showrunner and the crew make the film; off, the single director does
    const film = await deps.films.create({
      aspect: input.aspect,
      brief: { text, ...(input.audio ? { transcript: text } : {}), productAssetId: product.id },
      ...(input.title ? { title: input.title } : {}),
      ...(crewOn ? { crew: true } : {}),
      crewEngine: env.CREW_ENGINE,
      assets: [product],
    });
    const ctx = deps.makeToolCtx(film.id);
    if (input.audio) ctx.emit({ type: 'listener.transcript', text });
    bindDirector(deps);
    if (crewOn) bindCrew(deps);
    const queue = admission.submit(film.id, () => (crewOn ? runCrew(film.id) : runDirector(film.id)));
    if (queue.state === 'rejected') {
      await deps.films.update(film.id, { status: 'failed' });
      ctx.emit({ type: 'error', where: 'admission', message: 'film queue is full' });
      return c.json({ error: 'busy', retryAfterSec: queue.retryAfterSec }, 429, { 'Retry-After': String(queue.retryAfterSec) });
    }
    return c.json({ filmId: film.id, queue }, 202);
  });
}
