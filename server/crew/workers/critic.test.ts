import { Hono } from 'hono';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { FilmEvent } from '@shared/events';
import { addLayer, addScene, newFilmComposition } from '../../authoring/api';
import { registerReviewRoutes } from '../../http/handlers/review';
import { makeToolCtx } from '../../http/deps';
import type { Reviewer } from '../../review/visual';
import { makeTestCrew, waitFor } from '../test-helpers';
import { captureTimes, isWaitingCapture, runCriticJob } from './critic';

const INTENT = 'golden sunrise over the counter';
const noise = (seed: number) => {
  const raw = Buffer.alloc(64 * 64 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 31 + seed * 97 + ((i >> 5) % 7) * 40) % 256;
  return sharp(raw, { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
};

async function setup() {
  const t = await makeTestCrew();
  t.film.bus.subscribe(t.film.filmId, () => {});
  let c = addScene(newFilmComposition({ aspect: '16:9', title: 'T', palette: ['#111111'] }), { id: 's1', durationSec: 5, mode: 'motion', intent: INTENT });
  c = addLayer(c, { sceneId: 's1', role: 'headline', kind: 'text', text: 'Hello' });
  await t.film.films.commit(t.film.filmId, c, 'director');
  await t.film.films.update(t.film.filmId, {
    status: 'ready',
    storyboard: { title: 'T', aspect: '16:9', durationSec: 10, palette: ['#111111'], scenes: [1, 2].map((i) => ({ id: `s${i}`, durationSec: 5, intent: INTENT, shotType: 'hero' as const, camera: 'static' as const, layersWanted: ['bg' as const], mode: 'motion' as const, modeReason: 'r' })) },
  });
  const job = t.board.add({ kind: 'critique', origin: 'auto', sceneId: 's1', brief: 'review s1', reason: 'r' });
  t.board.update(job.id, { status: 'running' });
  const capture = () => t.events.find((e) => e.type === 'capture.request') as Extract<FilmEvent, { type: 'capture.request' }> | undefined;
  return { ...t, job, capture };
}

/** The upload the browser would send for a request. */
async function upload(t: Awaited<ReturnType<typeof setup>>, requestId: string | undefined, o: { run?: () => Promise<unknown>; film?: string } = {}) {
  const app = new Hono();
  const run = vi.fn(o.run ?? (async () => undefined));
  registerReviewRoutes(app, { ...t.film, makeToolCtx: (id: string) => makeToolCtx(t.film, id), dataDir: t.film.dir } as never, { run });
  const form = new FormData();
  const times = captureTimes(5);
  const png = await noise(1);
  for (const [i] of times.entries()) form.append('frames', new File([new Uint8Array(await noise(i + 1))], `f${i}.png`, { type: 'image/png' }));
  void png;
  form.set('meta', JSON.stringify(times.map((atSec) => ({ sceneId: 's1', atSec }))));
  if (requestId) form.set('requestId', requestId);
  const res = await app.request(`/api/films/${o.film ?? t.film.filmId}/frames`, { method: 'POST', body: form });
  return { res, run };
}

const verdictFor = (times: number[], n = 2) => ({
  sceneId: 's1',
  pass: false,
  issues: times.slice(0, n).map((t, i) => ({ image: i + 1, atSec: t, kind: i ? 'low-contrast' : 'text-over-product', evidence: `something is wrong at frame ${i + 1}` })),
  fixes: [],
});


describe('capture request', () => {
  it('asks for frames inside the scene, scene-relative, and goes to awaiting-frames', async () => {
    const t = await setup();
    const run = runCriticJob(t.job, new AbortController().signal, t.crew, { timeoutMs: 60_000 });
    await waitFor(() => t.capture() !== undefined);
    const req = t.capture()!;
    expect(req.sceneId).toBe('s1');
    expect(req.timesSec).toEqual([1, 2.5, 4]);
    expect(req.timesSec.every((s) => s > 0 && s < 5)).toBe(true);
    expect(t.board.get(t.job.id)!.status).toBe('awaiting-frames');
    expect(isWaitingCapture(req.requestId)).toBe(true);
    await expect(Promise.race([run, new Promise((r) => setTimeout(() => r('still waiting'), 30))])).resolves.toBe('still waiting');
    const { res } = await upload(t, req.requestId);
    expect(res.status).toBe(202);
    await run.catch(() => undefined);
  });

  it('captureTimes are whole capture frames at 20, 50 and 80 percent', () => {
    expect(captureTimes(5)).toEqual([1, 2.5, 4]);
    expect(captureTimes(4)).toEqual([0.8, 2, 3.2]);
  });
});

describe('POST /frames with a requestId', () => {
  it('resolves the job and starts no review', async () => {
    const t = await setup();
    const reviewer: Reviewer = async () => verdictFor([1, 2.5, 4], 0);
    const run = runCriticJob(t.job, new AbortController().signal, t.crew, { timeoutMs: 60_000, reviewer });
    await waitFor(() => t.capture() !== undefined);
    const { res, run: spy } = await upload(t, t.capture()!.requestId);
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ review: 'crew' });
    const r = await run;
    expect(spy).not.toHaveBeenCalled();
    expect(r.summary).toBe('no findings');
    expect(isWaitingCapture(t.capture()!.requestId)).toBe(false);
  });

  it('an unknown or already-answered request is a 409 and starts nothing', async () => {
    const t = await setup();
    const { res, run } = await upload(t, 'cap_nope');
    expect(res.status).toBe(409);
    expect(run).not.toHaveBeenCalled();
  });

  it('on a crew film, frames without a requestId are refused with crew_reviews', async () => {
    const t = await setup();
    await t.film.films.update(t.film.filmId, { status: 'ready' });
    const crewFilm = await t.film.films.create({ aspect: '16:9', brief: { text: 'x', productAssetId: 'ast_' + '0'.repeat(32) }, assets: [], crew: true });
    let c = addScene(newFilmComposition({ aspect: '16:9', title: 'T', palette: ['#111111'] }), { id: 's1', durationSec: 5, mode: 'motion' });
    c = addLayer(c, { sceneId: 's1', role: 'headline', kind: 'text', text: 'Hi' });
    await t.film.films.commit(crewFilm.id, c, 'director');
    const { res, run } = await upload(t, undefined, { film: crewFilm.id });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'crew_reviews' });
    expect(run).not.toHaveBeenCalled();
  });

  it('on a film that is not a crew film, frames without a requestId start the review as before', async () => {
    const t = await setup();
    const { res, run } = await upload(t, undefined);
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ review: 'started' });
    await waitFor(() => run.mock.calls.length === 1);
  });
});

describe('the blind review', () => {
  it('sends a prompt with none of the scene intent, and keeps the two blind sentences', async () => {
    const t = await setup();
    const prompts: string[] = [];
    const reviewer: Reviewer = async (_i, prompt) => (prompts.push(prompt), verdictFor([1, 2.5, 4], 0));
    const run = runCriticJob(t.job, new AbortController().signal, t.crew, { timeoutMs: 60_000, reviewer });
    await waitFor(() => t.capture() !== undefined);
    await upload(t, t.capture()!.requestId);
    await run;
    expect(prompts).toHaveLength(1);
    for (const word of ['golden', 'sunrise', 'counter', INTENT]) expect(prompts[0]!.toLowerCase()).not.toContain(word);
    expect(prompts[0]).toContain('Judge only what is visible. Report each problem with the frame index and what you see. Do not guess what the film is meant to show.');
    expect(prompts[0]).not.toContain('HOW TO FIX');
  });

  it('two findings give two review.finding events and one inbox item from the critic', async () => {
    const t = await setup();
    const reviewer: Reviewer = async () => verdictFor([1, 2.5, 4], 2);
    const run = runCriticJob(t.job, new AbortController().signal, t.crew, { timeoutMs: 60_000, reviewer });
    await waitFor(() => t.capture() !== undefined);
    await upload(t, t.capture()!.requestId);
    const r = await run;
    await new Promise((res) => setTimeout(res, 30));
    const findings = t.events.filter((e) => e.type === 'review.finding' && !e.deterministic);
    expect(findings.map((e) => (e as { kind: string }).kind)).toEqual(['text-over-product', 'low-contrast']);
    expect(r.summary).toBe('2 findings');
    expect(t.inbox.size()).toBe(1);
    const [item] = await t.inbox.drain();
    expect(item).toMatchObject({ from: 'critic', jobId: t.job.id });
    expect(item!.text).toContain('s1 at 1s text-over-product');
    expect(item!.text).toContain('s1 at 2.5s low-contrast');
  });

  it('a reviewer that fails leaves the rules findings and a summary that says so', async () => {
    const t = await setup();
    const reviewer: Reviewer = async () => {
      throw new Error('vision is down');
    };
    const run = runCriticJob(t.job, new AbortController().signal, t.crew, { timeoutMs: 60_000, reviewer });
    await waitFor(() => t.capture() !== undefined);
    await upload(t, t.capture()!.requestId);
    expect((await run).summary).toContain('rules only');
  });
});

describe('no browser', () => {
  it('ends done after the capture timeout with rules only', async () => {
    const t = await setup();
    const t0 = Date.now();
    const run = runCriticJob(t.job, new AbortController().signal, t.crew, { timeoutMs: 80 });
    await waitFor(() => t.capture() !== undefined);
    expect(t.board.get(t.job.id)!.status).toBe('awaiting-frames');
    const r = await run;
    expect(Date.now() - t0).toBeGreaterThanOrEqual(75);
    expect(r.summary).toBe('no browser connected; rules only');
    expect(isWaitingCapture(t.capture()!.requestId)).toBe(false);
  });

  it('an abort ends the wait with an AbortError and forgets the request', async () => {
    const t = await setup();
    const ac = new AbortController();
    const run = runCriticJob(t.job, ac.signal, t.crew, { timeoutMs: 60_000 });
    await waitFor(() => t.capture() !== undefined);
    ac.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(isWaitingCapture(t.capture()!.requestId)).toBe(false);
  });
});

