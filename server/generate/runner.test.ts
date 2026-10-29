import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { FilmEvent } from '@shared/events';
import type { ToolCtx } from '@shared/tools';
import { mugScene } from '../authoring/test-helpers';
import { ClippyError } from '../clippy/mcp';
import { makeFakeClippy } from '../clippy/fake';
import { hasFfmpeg, runFfmpeg } from '../media/ffmpeg';
import { makeTestFilm } from '../test-utils/film';
import { createApprovalStore } from './approval';
import { createJobStore } from './jobs';
import { setSceneMode } from './mode';
import type { PollOutcome } from './poll';
import { createRateLimiter } from './rate';
import { createRunner } from './runner';

const has = await hasFfmpeg();
const URL_SECRET = 'https://clip.example.test/out.mp4?sig=SECRET123';

async function testClip(): Promise<Buffer> {
  const out = join(mkdtempSync(join(tmpdir(), 'runner-clip-')), 'c.mp4');
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]);
  return readFile(out);
}

async function setup(o: { clip?: Buffer | 404; frac?: number; failSubmit?: ClippyError; poll?: () => Promise<PollOutcome> } = {}) {
  const t = await makeTestFilm({ composition: setSceneMode(mugScene(), 's1', 'generate') });
  const stillBytes = await sharp({ create: { width: 1536, height: 864, channels: 3, background: '#888' } }).jpeg().toBuffer();
  await t.assets.put(stillBytes, 'image/jpeg', { role: 'still', sceneId: 's1', width: 1536, height: 864 });
  const frames = 100;
  t.meta.sam.trackVideo = async () => ({ frames, framesWithObject: Array.from({ length: Math.round(frames * (o.frac ?? 0.9)) }, (_, i) => i), objectIds: ['0'] });

  const approvals = createApprovalStore({ dir: () => t.dir });
  const jobs = createJobStore({ filmsDir: join(t.dir, 'films') });
  const rate = createRateLimiter({ max: 4 });
  const clippy = makeFakeClippy({ script: ['queued', 'rendering', 'done'], resultUrl: URL_SECRET, failSubmit: o.failSubmit });
  const fetchImpl = (async () =>
    o.clip === 404
      ? new Response('', { status: 404 })
      : new Response(new Uint8Array(o.clip ?? Buffer.alloc(0)), { status: 200, headers: { 'content-type': 'video/mp4' } })) as typeof fetch;
  const runner = createRunner({
    clippy: () => clippy, approvals, jobs, rate, poll: o.poll,
    sleep: async () => undefined, now: () => 0,
    env: { PUBLIC_BASE_URL: 'https://demo.example.test', DATA_DIR: t.dir },
    download: { fetchImpl, sleep: async () => undefined },
  });
  const approval = approvals.consume(approvals.propose(t.filmId, 's1', 25).token, t.filmId, 's1');
  const before = (await t.films.get(t.filmId)).composition;
  // the bus delivers events a moment after emit, so let the last ones land
  const run = async () => {
    await runner.run(t.ctx as ToolCtx, { sceneId: 's1', approval });
    await new Promise((r) => setTimeout(r, 50));
  };
  const trace = () => t.events.map((e: FilmEvent) => (e.type === 'generate.progress' ? `progress:${e.status}` : e.type));
  return { ...t, runner, run, jobs, rate, clippy, approvals, before, trace };
}

describe('runner part 1', () => {
  it('failed submit: approved, error, failed progress, no active job, composition unchanged', async () => {
    const s = await setup({ failSubmit: new ClippyError('nope', { isToolError: true }) });
    await s.run();
    expect(s.trace()).toEqual(['progress:approved', 'error', expect.stringMatching(/^progress:failed:/)]);
    expect(await s.jobs.listActive()).toEqual([]);
    expect((await s.films.get(s.filmId)).composition).toEqual(s.before);
  });

  it('a failed poll carries its message; a timeout is reported; neither touches the film', async () => {
    const failed = await setup({ poll: async () => ({ kind: 'failed', status: null, message: 'pro_plan_required' }) });
    await failed.run();
    expect(failed.trace()).toEqual(['progress:approved', 'progress:submitted', 'cost', 'error', 'progress:failed: pro_plan_required']);
    expect((await failed.films.get(failed.filmId)).composition).toEqual(failed.before);
    expect((await failed.jobs.get(failed.filmId, 's1'))?.status).toBe('failed');

    const slow = await setup({ poll: async () => ({ kind: 'timed_out' }) });
    await slow.run();
    expect(slow.trace()).toContain('progress:timed_out');
    expect((await slow.films.get(slow.filmId)).composition).toEqual(slow.before);
  });

  it('submits exactly once with the attempt in the idempotency key and records 25 credits', async () => {
    const s = await setup({ poll: async () => ({ kind: 'timed_out' }) });
    await s.run();
    const submits = s.clippy.calls.filter((c) => c.tool === 'animate_image');
    expect(submits).toHaveLength(1);
    expect((submits[0]!.args as { idempotencyKey: string }).idempotencyKey).toBe(`${s.filmId}:s1:1`);
    expect(s.ledger.credits(s.filmId)).toBe(25);
  });

  it('preflight refuses with 429 once the hourly cap is used', async () => {
    const s = await setup();
    expect(await s.runner.preflight(s.ctx as ToolCtx, 's1')).toEqual({ ok: true });
    for (let i = 0; i < 4; i++) s.rate.tryAcquire();
    expect(await s.runner.preflight(s.ctx as ToolCtx, 's1')).toMatchObject({ ok: false, status: 429, error: 'rate_limited' });
  });
});

describe('runner part 2', () => {
  it.skipIf(!has)('places the clip under the headline and checks the product', async () => {
    const s = await setup({ clip: await testClip(), frac: 0.9 });
    await s.run();
    expect(s.trace()).toEqual(['progress:approved', 'progress:submitted', 'cost', 'progress:queued', 'progress:rendering', 'progress:downloading', 'progress:placing', 'progress:checking', 'cost', 'generate.done']);
    const done = s.events.find((e) => e.type === 'generate.done') as Extract<FilmEvent, { type: 'generate.done' }>;
    expect(done.productVisibleFrac).toBeCloseTo(0.9);
    const comp = (await s.films.get(s.filmId)).composition as unknown as { precomps: Record<string, { layers: Array<{ id: string; hidden?: boolean }> }> };
    const layers = comp.precomps.s1!.layers;
    expect(layers.map((l) => l.id)).toEqual(['s1:bg', 's1:product', 's1:clip', 's1:headline']);
    expect(layers.find((l) => l.id === 's1:bg')!.hidden).toBe(true);
    expect(layers.find((l) => l.id === 's1:product')!.hidden).toBe(true);
    const stored = (await s.assets.list()).find((a) => a.role === 'clip');
    expect(stored).toMatchObject({ role: 'clip', sceneId: 's1' });
    expect(await s.jobs.get(s.filmId, 's1')).toMatchObject({ status: 'done', productVisibleFrac: expect.closeTo(0.9, 5), assetId: stored!.id });
    expect(s.ledger.credits(s.filmId)).toBe(25);
    expect(s.events.some((e) => e.type === 'cost' && e.model === 'sam-3.1')).toBe(true);
  });

  it.skipIf(!has)('still places the clip when the product is mostly missing, and offers one retry', async () => {
    const s = await setup({ clip: await testClip(), frac: 0.4 });
    await s.run();
    const done = s.events.find((e) => e.type === 'generate.done') as Extract<FilmEvent, { type: 'generate.done' }>;
    expect(done.productVisibleFrac).toBeCloseTo(0.4);
    expect(s.events.filter((e) => e.type === 'review.finding' && e.kind === 'product-missing-in-clip')).toHaveLength(1);
    expect(s.events.filter((e) => e.type === 'generate.proposed')).toHaveLength(1);
  });

  it('cancels without placing anything when the scene went back to motion', async () => {
    const s = await setup({
      poll: async () => {
        await s.films.mutate(s.filmId, (f) => ({ next: setSceneMode(f.composition!, 's1', 'motion'), data: null }), 'user');
        return { kind: 'done', status: { jobId: 'job_1', status: 'done', resultUrl: URL_SECRET } };
      },
    });
    await s.run();
    expect(s.trace()).toContain('progress:cancelled');
    expect((await s.assets.list()).some((a) => a.role === 'clip')).toBe(false);
    expect((await s.jobs.get(s.filmId, 's1'))?.status).toBe('cancelled');
  });

  it('a 404 download fails cleanly, keeps the job id and never leaks the signed URL', async () => {
    const s = await setup({ clip: 404 });
    await s.run();
    expect(s.trace().at(-1)).toMatch(/^progress:failed:/);
    expect(s.events.some((e) => e.type === 'error')).toBe(true);
    expect((await s.films.get(s.filmId)).composition).toEqual(s.before);
    expect(await s.jobs.get(s.filmId, 's1')).toMatchObject({ status: 'failed', jobId: expect.stringMatching(/^job_/) });
    expect(JSON.stringify(s.events)).not.toContain('SECRET123');
  });
});
