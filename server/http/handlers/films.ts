import type { Hono } from 'hono';
import { getAdmission } from '../../admission';
import { bindDirector, runDirector } from '../../agent/director';
import { BriefTooLongError, EmptyBriefError, transcribeBrief } from '../../listener';
import { bindCrew, runCrew } from '../../crew/run-crew';
import { loadEnv } from '../../env';
import { inventProductPhoto } from '../../art/invent-photo';
import { PRICE } from '../../art/prices';
import { imageSize } from '../../media/image';
import type { AppDeps } from '../deps';
import { InputError, parseCreateFilm } from './films-input';

export const STUB_OWNER = 'S3b' as const;

export function registerFilmsRoutes(app: Hono, deps: AppDeps): void {
  app.post('/api/films', async (c) => {
    let input;
    try {
      input = await parseCreateFilm(await c.req.parseBody({ all: true }), { maxBytes: loadEnv().MAX_UPLOAD_MB * 1024 * 1024 });
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
    let text = input.brief ?? '';
    if (input.audio) {
      try {
        text = (await transcribeBrief(input.audio.bytes, { meta: deps.meta, keywords: input.title ? [input.title] : [] })).text;
      } catch (e) {
        if (e instanceof BriefTooLongError) return c.json({ error: 'audio_too_long', message: e.message }, 400);
        if (e instanceof EmptyBriefError) return c.json({ error: 'empty_brief', message: e.message }, 400);
        throw e;
      }
    }
    // the first photo is the hero; with none, the image model invents one from the brief
    const photos = [];
    let invented = false;
    if (input.photos.length === 0) {
      try {
        const bytes = await inventProductPhoto(deps.meta, text, input.aspect);
        const size = await imageSize(bytes);
        photos.push(await deps.assets.put(bytes, size.mime, { role: 'product-photo', width: size.width, height: size.height }));
        invented = true;
      } catch (e) {
        return c.json({ error: 'no_photo', message: `No photo was sent and one could not be made: ${e instanceof Error ? e.message : 'image model unavailable'}` }, 502);
      }
    } else {
      for (const p of input.photos) photos.push(await deps.assets.put(p.bytes, p.mime, { role: 'product-photo' }));
    }
    const product = photos[0]!;
    const env = loadEnv();
    const crewOn = env.CREW_ENABLED; // the showrunner and the crew make the film; off, the single director does
    const film = await deps.films.create({
      aspect: input.aspect,
      brief: { text, ...(input.audio ? { transcript: text } : {}), productAssetId: product.id },
      ...(input.title ? { title: input.title } : {}),
      ...(crewOn ? { crew: true } : {}),
      assets: photos,
    });
    if (invented) deps.ledger.add(film.id, 'muse-image-1.0', '1 image', PRICE.museImageUsd);
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
