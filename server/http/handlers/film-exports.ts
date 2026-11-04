// Film export jobs: the page starts one, polls its progress and downloads the MP4 when it is done. The render and encode happen here, not in the browser.
import { readFile } from 'node:fs/promises';
import type { Hono } from 'hono';
import { z } from 'zod';
import { isFilmId } from '@shared/composition';
import type { AppDeps } from '../deps';
import { hasFfmpeg } from '../../media/ffmpeg';
import { collectAudio } from '../../export/audio';
import { BusyError, createExportJobs } from '../../export/jobs';
import { renderAvailable } from '../../export/render';

const body = z.object({ quality: z.enum(['draft', 'full']).default('draft') });

export interface FilmExportOptions {
  jobs?: ReturnType<typeof createExportJobs>;
  available?: () => Promise<boolean>;
}

export function registerFilmExportRoutes(app: Hono, deps: AppDeps, opts: FilmExportOptions = {}): void {
  const jobs = opts.jobs ?? createExportJobs();
  const available = opts.available ?? (async () => (await hasFfmpeg()) && (await renderAvailable()));

  app.get('/api/render-exports/capability', async (c) => c.json({ available: await available() }));

  app.post('/api/films/:id/render-exports', async (c) => {
    const id = c.req.param('id');
    if (!isFilmId(id)) return c.json({ error: 'not_found' }, 404);
    const parsed = body.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
    if (!(await available())) return c.json({ error: 'render_unavailable', message: 'This server cannot render video (ffmpeg or a headless browser is missing).' }, 503);
    let film;
    try {
      film = await deps.films.get(id);
    } catch {
      return c.json({ error: 'not_found' }, 404);
    }
    if (!film.composition || film.composition.durationInFrames < 1) return c.json({ error: 'nothing_to_export', message: 'Nothing to export yet.' }, 409);
    try {
      const job = await jobs.start({ filmId: id, title: film.title ?? 'film', composition: film.composition, quality: parsed.data.quality, audio: { items: collectAudio(film.composition as never), read: (aid) => deps.assets.read(aid) } });
      return c.json(job, 202);
    } catch (e) {
      if (e instanceof BusyError) return c.json({ error: 'busy', message: 'Another export is running. Try again in a minute.' }, 429);
      throw e;
    }
  });

  app.get('/api/render-exports/:id', (c) => {
    const job = jobs.get(c.req.param('id'));
    return job ? c.json(job) : c.json({ error: 'not_found' }, 404);
  });

  app.delete('/api/render-exports/:id', (c) => (jobs.cancel(c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'not_found' }, 404)));

  app.get('/api/render-exports/:id/download', async (c) => {
    const f = jobs.file(c.req.param('id'));
    if (!f) return c.json({ error: 'not_ready' }, 404);
    const video = await readFile(f.path);
    return new Response(new Uint8Array(video), {
      headers: { 'content-type': 'video/mp4', 'content-length': String(video.length), 'content-disposition': `attachment; filename="${f.name}"` },
    });
  });
}
