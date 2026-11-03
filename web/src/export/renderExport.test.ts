import { expect, it, vi } from 'vitest';
import { downloadRenderExport, pollRenderExport, renderExportAvailable, startRenderExport } from './renderExport';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const v = (status: string) => ({ id: 'j', status, progress: 0, frame: 0, frames: 1, problems: [] });

it('reads capability and starts a job', async () => {
  expect(await renderExportAvailable(vi.fn(async () => json({ available: true })) as never)).toBe(true);
  expect(await renderExportAvailable(vi.fn(async () => { throw new Error('x'); }) as never)).toBe(false);
  const f = vi.fn(async () => json({ id: 'j' }, 202));
  await startRenderExport('film_aaaaaaaaaaaa', 'full', f as never);
  expect(f).toHaveBeenCalledWith('/api/films/film_aaaaaaaaaaaa/render-exports', expect.objectContaining({ method: 'POST', body: '{"quality":"full"}' }));
});
it('turns a server refusal into its message', async () => {
  const f = vi.fn(async () => json({ message: 'Another export is running.' }, 429));
  await expect(startRenderExport('film_aaaaaaaaaaaa', 'draft', f as never)).rejects.toThrow('Another export is running.');
  await expect(downloadRenderExport('j', vi.fn(async () => json({}, 404)) as never)).rejects.toThrow(/404/);
});
it('polls until the job finishes', async () => {
  const seen: string[] = [];
  const f = vi.fn().mockResolvedValueOnce(json(v('rendering'))).mockResolvedValueOnce(json(v('encoding'))).mockResolvedValueOnce(json(v('done')));
  const last = await pollRenderExport('j', { onView: (x) => seen.push(x.status), intervalMs: 1, fetch: f as never });
  expect(last.status).toBe('done');
  expect(seen).toEqual(['rendering', 'encoding', 'done']);
});
it('keeps polling through a blip and gives up on a lost server', async () => {
  const blip = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(json(v('done')));
  expect((await pollRenderExport('j', { onView: () => undefined, intervalMs: 1, fetch: blip as never })).status).toBe('done');
  const dead = vi.fn().mockRejectedValue(new Error('gone'));
  await expect(pollRenderExport('j', { onView: () => undefined, intervalMs: 1, fetch: dead as never })).rejects.toThrow('gone');
});
