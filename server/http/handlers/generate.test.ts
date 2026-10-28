import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBalanceReader } from '../../clippy/balance';
import { makeFakeClippy } from '../../clippy/fake';
import { createApprovalStore } from '../../generate/approval';
import { setGenerationRunner, setRevertHandler, type GenerationRunner } from '../../generate/runner-registry';
import { setGenerateServicesForTests } from '../../generate/services';
import { buildComp } from '../../generate/test-helpers';
import { makeTestFilm } from '../../test-utils/film';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppDeps } from '../deps';
import { registerGenerateRoutes } from './generate';

const saved = process.env.PUBLIC_BASE_URL;
beforeEach(() => void (process.env.PUBLIC_BASE_URL = 'https://app.example.test'));
afterEach(() => {
  if (saved === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = saved;
  setGenerationRunner(undefined);
  setRevertHandler(undefined);
  setGenerateServicesForTests(undefined);
});

async function setup(o: { balance?: number | 'none'; modes?: Array<'motion' | 'generate'> } = {}) {
  const modes = o.modes ?? ['motion', 'motion', 'motion'];
  const t = await makeTestFilm({ composition: buildComp(modes.map((mode, i) => ({ id: `s${i + 1}`, mode, frames: 120 }))) });
  let now = Date.parse('2026-11-02T01:00:00Z');
  const dir = mkdtempSync(join(tmpdir(), 'gen-'));
  const clippy = o.balance === 'none' ? undefined : makeFakeClippy({ balance: o.balance ?? 120 });
  setGenerateServicesForTests({ approvals: createApprovalStore({ dir: (f) => join(dir, f), now: () => new Date(now) }), clippy, balance: createBalanceReader(clippy, { ttlMs: 0 }) });
  const deps = { films: t.films, assets: t.assets, meta: t.meta, ledger: t.ledger, bus: t.bus, makeToolCtx: () => t.ctx } as AppDeps;
  const app = new Hono();
  registerGenerateRoutes(app, deps);
  const post = (path: string, body: unknown) => app.request(`/api/films/${t.filmId}/scenes/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const mode = async (sceneId: string, m: string) => (await post(`${sceneId}/mode`, { mode: m }));
  const modeOf = async (sceneId: string) => ((await t.films.get(t.filmId)).composition!.meta as any).director.scenes[sceneId].mode;
  const settle = () => new Promise((r) => setTimeout(r, 40));
  return { t, post, mode, modeOf, settle, advance: (min: number) => (now += min * 60_000) };
}
const runner = (over: Partial<GenerationRunner> = {}): GenerationRunner & { run: ReturnType<typeof vi.fn> } => ({ preflight: async () => ({ ok: true }), run: vi.fn(async () => undefined), ...over }) as never;

describe('mode route', () => {
  it('flips a scene to generate and returns a proposal once', async () => {
    const s = await setup();
    const res = await s.mode('s1', 'generate');
    expect(res.status).toBe(200);
    const { mode, proposal } = await res.json();
    expect(mode).toBe('generate');
    expect(proposal).toMatchObject({ estCredits: 25, balance: 120, sceneId: 's1', model: 'fast-h3', durationSec: 5.2 });
    expect(proposal.token).toMatch(/^[0-9a-f]{32}$/);
    expect(await s.modeOf('s1')).toBe('generate');
    await s.settle();
    expect(s.t.events.filter((e) => e.type === 'generate.proposed')).toHaveLength(1);
    expect((await (await s.mode('s1', 'generate')).json()).proposal.token).toBe(proposal.token);
  });
  it('enforces the two-scene cap and 404s unknown scenes', async () => {
    const s = await setup({ modes: ['generate', 'generate', 'motion'] });
    const res = await s.mode('s3', 'generate');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'generate_cap' });
    expect(await s.modeOf('s3')).toBe('motion');
    expect((await s.mode('nope', 'generate')).status).toBe(404);
  });
  it('flips back to motion and calls the revert handler', async () => {
    const s = await setup({ modes: ['generate', 'motion', 'motion'] });
    const revert = vi.fn(async () => undefined);
    setRevertHandler(revert);
    const res = await s.mode('s1', 'motion');
    expect(await res.json()).toEqual({ mode: 'motion' });
    expect(await s.modeOf('s1')).toBe('motion');
    expect(revert).toHaveBeenCalledTimes(1);
  });
  it('still proposes with no Clippy client, without a balance', async () => {
    const s = await setup({ balance: 'none' });
    const { proposal } = await (await s.mode('s1', 'generate')).json();
    expect(proposal.token).toBeTruthy();
    expect('balance' in proposal).toBe(false);
  });
});

describe('approve route', () => {
  async function proposed(s: Awaited<ReturnType<typeof setup>>) {
    return (await (await s.mode('s1', 'generate')).json()).proposal.token as string;
  }
  it('starts the runner once and spends the token', async () => {
    const s = await setup();
    const token = await proposed(s);
    const r = runner();
    setGenerationRunner(r);
    const res = await s.post('s1/approve', { token });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true });
    expect(r.run).toHaveBeenCalledTimes(1);
    expect(r.run.mock.calls[0]![1]).toMatchObject({ sceneId: 's1', approval: { filmId: s.t.filmId, sceneId: 's1', attempt: 1 } });
    const again = await s.post('s1/approve', { token });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'token_used' });
  });
  it('fails before consuming the token, so a later request succeeds', async () => {
    const s = await setup();
    const token = await proposed(s);
    expect((await s.post('s1/approve', { token })).status).toBe(501); // no runner
    setGenerationRunner(runner());

    process.env.PUBLIC_BASE_URL = 'http://localhost:8787';
    const bad = await s.post('s1/approve', { token });
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toBe('public_url_invalid');
    process.env.PUBLIC_BASE_URL = 'https://app.example.test';

    setGenerationRunner(runner({ preflight: async () => ({ ok: false, status: 429, error: 'rate_limited', retryAfterSec: 120 }) }));
    const limited = await s.post('s1/approve', { token });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate_limited', retryAfterSec: 120 });

    const fresh = runner();
    setGenerationRunner(fresh);
    expect((await s.post('s1/approve', { token })).status).toBe(202);
    expect(fresh.run).toHaveBeenCalledTimes(1);
  });
  it('402s on a low balance without consuming', async () => {
    const s = await setup({ balance: 10 });
    const token = await proposed(s);
    setGenerationRunner(runner());
    const res = await s.post('s1/approve', { token });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'insufficient_credits' });
  });
  it('404s bad tokens and unknown scenes, 410s expired ones, 409s motion scenes', async () => {
    const s = await setup();
    const token = await proposed(s);
    setGenerationRunner(runner());
    expect((await s.post('s1/approve', { token: 'nope' })).status).toBe(404);
    expect((await s.post('nope/approve', { token })).status).toBe(404);
    expect((await s.post('s2/approve', { token })).status).toBe(409); // s2 is motion
    s.advance(31);
    const res = await s.post('s1/approve', { token });
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'token_expired' });
  });
  it('a rejecting runner keeps the 202 and emits one error event', async () => {
    const s = await setup();
    const token = await proposed(s);
    setGenerationRunner(runner({ run: vi.fn(async () => { throw new Error('boom'); }) as never }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await s.post('s1/approve', { token })).status).toBe(202);
    await s.settle();
    spy.mockRestore();
    const errors = s.t.events.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ where: 'generate', message: 'boom' });
  });
});
