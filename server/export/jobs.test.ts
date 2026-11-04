import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BusyError, createExportJobs, exportName, type ExportJob } from './jobs';
import { RenderError } from './render';

let root: string;
beforeEach(async () => void (root = await mkdtemp(join(tmpdir(), 'jobs-test-'))));
afterEach(() => rm(root, { recursive: true, force: true }));

const input = { filmId: 'film_aaaaaaaaaaaa', title: 'Morning Ritual', composition: { fps: 30, durationInFrames: 60, width: 1080, height: 1920 }, quality: 'draft' as const };
const until = async (get: () => ExportJob | undefined, pred: (j: ExportJob) => boolean) => {
  for (let i = 0; i < 200; i++) {
    const j = get();
    if (j && pred(j)) return j;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timed out');
};
const okEncode = async (o: { out: string }) => void (await writeFile(o.out, 'mp4'));

it('renders, encodes, checks and offers the file', async () => {
  const render = vi.fn(async (o: { onFrame?(d: number, t: number): void; frames: number }) => {
    for (let i = 1; i <= o.frames; i++) o.onFrame?.(i, o.frames);
    return { width: 540, height: 960 };
  });
  const check = vi.fn().mockResolvedValue(['note']);
  const jobs = createExportJobs({ render: render as never, encode: okEncode as never, check, tmpRoot: root, base: 'http://x' });
  const started = await jobs.start(input);
  expect(started.frames).toBe(30); // 2 s at the draft 15 fps
  const done = await until(() => jobs.get(started.id), (j) => j.status === 'done');
  expect(done).toMatchObject({ progress: 1, problems: ['note'], bytes: 3 });
  expect(done.fileName).toMatch(/^morning-ritual-\d{8}\.mp4$/);
  expect(check).toHaveBeenCalledWith(expect.any(Buffer), { durationSec: 2, fps: 15, width: 540, height: 960 });
  expect(jobs.file(started.id)?.path).toMatch(/out\.mp4$/);
});

it('runs one job at a time', async () => {
  const render = vi.fn(() => new Promise<never>(() => undefined));
  const jobs = createExportJobs({ render: render as never, tmpRoot: root });
  await jobs.start(input);
  await expect(jobs.start(input)).rejects.toBeInstanceOf(BusyError);
});

it('reports a render failure and removes its frames', async () => {
  const jobs = createExportJobs({ render: vi.fn().mockRejectedValue(new RenderError('not-ready', 'not drawn')) as never, tmpRoot: root });
  const j = await jobs.start(input);
  const failed = await until(() => jobs.get(j.id), (x) => x.status === 'error');
  expect(failed.error).toBe('not drawn');
  expect(jobs.file(j.id)).toBeUndefined();
});

it('cancels a running job', async () => {
  const render = vi.fn((o: { signal: AbortSignal }) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new RenderError('aborted', 'x')))));
  const jobs = createExportJobs({ render: render as never, tmpRoot: root });
  const j = await jobs.start(input);
  expect(jobs.cancel(j.id)).toBe(true);
  expect((await until(() => jobs.get(j.id), (x) => x.status === 'cancelled')).status).toBe('cancelled');
  expect(jobs.cancel('nope')).toBe(false);
  expect(existsSync(root)).toBe(true);
});

it('names the file from the title and date', () => {
  expect(exportName('A runner shoes!', new Date('2026-11-03T00:00:00Z'))).toBe('a-runner-shoes-20261103.mp4');
  expect(exportName('???', new Date('2026-11-03T00:00:00Z'))).toBe('film-20261103.mp4');
});

it('lays the sound under the picture and checks the finished file', async () => {
  const render = async (o: { frames: number }) => (o.frames, { width: 540, height: 960 });
  const mux = vi.fn(async (m: { out: string }) => (await writeFile(m.out, 'with-audio'), { skipped: ['s'] }));
  const check = vi.fn().mockResolvedValue([]);
  const jobs = createExportJobs({ render: render as never, encode: okEncode as never, mux: mux as never, check, tmpRoot: root });
  const j = await jobs.start({ ...input, audio: { items: [{ layerId: 'm', assetId: 'a', startSec: 0, endSec: 2, gain: [[0, 1]] }], read: async () => Buffer.alloc(0) } });
  const done = await until(() => jobs.get(j.id), (x) => x.status === 'done');
  expect(done.problems).toEqual(['Exported without audio from: s']);
  expect(done.bytes).toBe('with-audio'.length);
  expect(jobs.file(j.id)?.path).toMatch(/final\.mp4$/);
});
it('keeps the silent video and says so when the mix fails', async () => {
  const render = async () => ({ width: 540, height: 960 });
  const jobs = createExportJobs({ render: render as never, encode: okEncode as never, mux: vi.fn().mockRejectedValue(new Error('x')) as never, check: vi.fn().mockResolvedValue([]), tmpRoot: root });
  const j = await jobs.start({ ...input, audio: { items: [{ layerId: 'm', assetId: 'a', startSec: 0, endSec: 2, gain: [[0, 1]] }], read: async () => Buffer.alloc(0) } });
  const done = await until(() => jobs.get(j.id), (x) => x.status === 'done');
  expect(done.problems).toEqual(['Exported without audio']);
  expect(jobs.file(j.id)?.path).toMatch(/out\.mp4$/);
});
