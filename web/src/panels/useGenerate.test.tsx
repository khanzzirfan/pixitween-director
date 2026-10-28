import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { FilmEvent } from '@shared/events';
import raw from '../../../fixtures/s07a/mode-response.json';
import { modeResponseSchema } from '../../../server/generate/types';
import type { ModeResponse } from './generate-types';
import { reduceGenerate, useGenerate, type GenState } from './useGenerate';

const F = 'film_aaaaaaaaaaaa';
const ev = (e: Record<string, unknown>) => ({ filmId: F, at: 'x', ...e }) as FilmEvent;
const run = (events: FilmEvent[]) => events.reduce(reduceGenerate, {} as GenState);
const comp = (modes: Record<string, string>) => ({ meta: { director: { scenes: Object.fromEntries(Object.entries(modes).map(([k, m]) => [k, { mode: m }])) } } }) as unknown as AepCompositionJson;
const asset = { id: 'ast_x', url: '/x', mime: 'video/mp4' };

it('walks proposed -> running -> placing -> checking -> done', () => {
  const steps: Array<[FilmEvent, string]> = [
    [ev({ type: 'generate.proposed', sceneId: 's2', reason: 'r', estCredits: 25, token: 'tok' }), 'proposed'],
    [ev({ type: 'generate.progress', sceneId: 's2', status: 'rendering' }), 'running'],
    [ev({ type: 'generate.progress', sceneId: 's2', status: 'downloading' }), 'running'],
    [ev({ type: 'generate.progress', sceneId: 's2', status: 'placing' }), 'placing'],
    [ev({ type: 'generate.progress', sceneId: 's2', status: 'checking' }), 'checking'],
    [ev({ type: 'generate.done', sceneId: 's2', asset, productVisibleFrac: 0.92 }), 'done'],
  ];
  let state: GenState = {};
  for (const [e, phase] of steps) {
    state = reduceGenerate(state, e);
    expect(state.s2!.phase).toBe(phase);
  }
  expect(state.s2!.visibleFrac).toBe(0.92);
});
it('maps failures, cancellation and a missing product', () => {
  expect(run([ev({ type: 'generate.progress', sceneId: 's2', status: 'failed: pro_plan_required' })]).s2).toMatchObject({ phase: 'failed', message: 'pro_plan_required' });
  expect(run([ev({ type: 'generate.progress', sceneId: 's2', status: 'timed_out' })]).s2).toMatchObject({ phase: 'failed', message: 'timed out' });
  expect(run([ev({ type: 'generate.progress', sceneId: 's2', status: 'cancelled' })]).s2!.phase).toBe('motion');
  const done = [ev({ type: 'generate.done', sceneId: 's2', asset })];
  const needs = [...done, ev({ type: 'review.finding', sceneId: 's2', kind: 'product-missing-in-clip', evidence: 'only 30% visible', deterministic: false })];
  expect(run(needs).s2!.phase).toBe('needs_retry');
  expect(run([...needs, ev({ type: 'generate.proposed', sceneId: 's2', reason: 'r', estCredits: 25, token: 't2' })]).s2!.phase).toBe('proposed');
  expect(run([ev({ type: 'review.finding', sceneId: 's2', kind: 'low-contrast', evidence: 'x', deterministic: true })])).toEqual({});
});

const proposal = { token: 'tok123', sceneId: 's2', attempt: 1, model: 'fast-h3' as const, durationSec: 5.2, withSound: false, estCredits: 25 as const, reason: 'r', expiresAt: '2099-01-01T00:00:00Z' };
function hook(events: FilmEvent[] = []) {
  const api = { setMode: vi.fn(async (_f: string, _s: string, mode: string) => (mode === 'generate' ? { mode, proposal } : { mode })) as never, approve: vi.fn(async () => ({ accepted: true })) };
  const r = renderHook(() => useGenerate({ filmId: F, comp: comp({ s1: 'motion', s2: 'generate' }), events, api }));
  return { api, r };
}

it('review stores the proposal and approve sends its token once', async () => {
  const { api, r } = hook();
  await act(async () => r.result.current.approve('s2')); // nothing to approve yet
  expect(api.approve).not.toHaveBeenCalled();
  await act(async () => r.result.current.review('s2'));
  expect(api.setMode).toHaveBeenCalledWith(F, 's2', 'generate');
  expect(r.result.current.scenes.find((s) => s.id === 's2')).toMatchObject({ phase: 'proposed', proposal });
  await act(async () => r.result.current.approve('s2'));
  expect(api.approve).toHaveBeenCalledTimes(1);
  expect(api.approve).toHaveBeenCalledWith(F, 's2', 'tok123');
});
it('keepMotion calls the API and reverts the scene', async () => {
  const { api, r } = hook();
  await act(async () => r.result.current.keepMotion('s2'));
  expect(api.setMode).toHaveBeenCalledWith(F, 's2', 'motion');
  expect(r.result.current.scenes.find((s) => s.id === 's2')!.phase).toBe('motion');
});
it('derives phases from composition modes and events', () => {
  const { r } = hook([ev({ type: 'generate.progress', sceneId: 's2', status: 'rendering' })]);
  expect(r.result.current.scenes.map((s) => [s.id, s.phase])).toEqual([['s1', 'motion'], ['s2', 'running']]);
});

it('the hand-authored mode-response fixture matches the schema and the web type', () => {
  const parsed: ModeResponse = modeResponseSchema.parse(raw);
  expect(parsed.proposal?.estCredits).toBe(25);
});
