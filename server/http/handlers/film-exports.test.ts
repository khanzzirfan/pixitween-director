import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import type { AppDeps } from '../deps';
import { BusyError, type ExportJob } from '../../export/jobs';
import { registerFilmExportRoutes } from './film-exports';

const job: ExportJob = { id: 'j1', filmId: 'film_aaaaaaaaaaaa', status: 'rendering', quality: 'draft', frame: 0, frames: 30, progress: 0, problems: [] };
const film = { title: 'Morning', composition: { fps: 30, durationInFrames: 60 } };
const mk = (o: { jobs?: Partial<Record<string, unknown>>; available?: boolean; film?: unknown } = {}) => {
  const jobs = { start: vi.fn().mockResolvedValue(job), get: vi.fn((id: string) => (id === 'j1' ? job : undefined)), file: vi.fn(), cancel: vi.fn((id: string) => id === 'j1'), ...o.jobs };
  const films = { get: vi.fn(async () => { if (o.film === null) throw new Error('missing'); return o.film ?? film; }) };
  const app = new Hono();
  registerFilmExportRoutes(app, { films } as unknown as AppDeps, { jobs: jobs as never, available: async () => o.available ?? true });
  return { app, jobs };
};
const post = (app: Hono, id = 'film_aaaaaaaaaaaa', body: unknown = { quality: 'full' }) =>
  app.request(`/api/films/${id}/render-exports`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

it('starts a job for a film', async () => {
  const { app, jobs } = mk();
  const res = await post(app);
  expect(res.status).toBe(202);
  expect(jobs.start).toHaveBeenCalledWith({ filmId: 'film_aaaaaaaaaaaa', title: 'Morning', composition: film.composition, quality: 'full', audio: { items: [], read: expect.any(Function) } });
});
it('refuses a bad id, a missing film, an empty film, a bad body and a server without a renderer', async () => {
  expect((await post(mk().app, 'nope')).status).toBe(404);
  expect((await post(mk({ film: null }).app)).status).toBe(404);
  expect((await post(mk({ film: { title: 'x', composition: { fps: 30, durationInFrames: 0 } } }).app)).status).toBe(409);
  expect((await post(mk().app, undefined, { quality: 'huge' })).status).toBe(400);
  expect((await post(mk({ available: false }).app)).status).toBe(503);
});
it('answers 429 while another export runs', async () => {
  const { app } = mk({ jobs: { start: vi.fn().mockRejectedValue(new BusyError('x')) } });
  expect((await post(app)).status).toBe(429);
});
it('reports progress, cancels and 404s unknown jobs', async () => {
  const { app } = mk();
  expect(await (await app.request('/api/render-exports/j1')).json()).toMatchObject({ status: 'rendering' });
  expect((await app.request('/api/render-exports/zz')).status).toBe(404);
  expect((await app.request('/api/render-exports/j1', { method: 'DELETE' })).status).toBe(204);
  expect((await app.request('/api/render-exports/zz', { method: 'DELETE' })).status).toBe(404);
});
it('serves the file only when the job is done', async () => {
  expect((await mk().app.request('/api/render-exports/j1/download')).status).toBe(404);
  const { writeFile, mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const path = join(await mkdtemp(join(tmpdir(), 'dl-')), 'out.mp4');
  await writeFile(path, 'mp4data');
  const { app } = mk({ jobs: { file: vi.fn(() => ({ path, name: 'morning-20261103.mp4' })) } });
  const res = await app.request('/api/render-exports/j1/download');
  expect(res.headers.get('content-type')).toBe('video/mp4');
  expect(res.headers.get('content-disposition')).toContain('morning-20261103.mp4');
  expect(await res.text()).toBe('mp4data');
});
