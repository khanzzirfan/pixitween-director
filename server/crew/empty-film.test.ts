import { afterEach, beforeEach, expect, it } from 'vitest';
import type { LlmBackend } from '@shared/ports';
import { makeTestDeps } from '../test-utils/deps';
import { createCrew } from './run-crew';
import { clearWorkers } from './workers';

const saved = { ...process.env };
beforeEach(() => { process.env.CREW_ENABLED = 'true'; process.env.CREW_INBOX_DEBOUNCE_MS = '0'; process.env.CREW_AUTO_FINISH = '1'; });
afterEach(() => { process.env = { ...saved }; clearWorkers(); });

it('a showrunner that never plans does not get its empty film auto-finished', async () => {
  const deps = await makeTestDeps();
  const backend: LlmBackend = { id: 'wonder', async chatWithTools() { return { toolCalls: [], ms: 1 }; } };
  await createCrew(deps, { backend, idleEndMs: 100 }).runCrew(deps.filmId);
  const film = await deps.films.get(deps.filmId);
  expect(film.status).toBe('failed');
  expect(film.composition).toBeFalsy();
});

it('a first turn that plans nothing is prompted twice, then fails without waiting out the idle end', async () => {
  const deps = await makeTestDeps();
  const seen: string[] = [];
  let calls = 0;
  const backend: LlmBackend = {
    id: 'wonder',
    async chatWithTools(messages) {
      calls++;
      const last = messages[messages.length - 1];
      seen.push(typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content));
      // only a style bible, as in the hung runs
      return calls === 1
        ? { toolCalls: [{ id: 'c1', name: 'setStyleBible', args: { palette: ['#1f2937', '#f59e0b'], light: 'warm', camera: 'slow', type: { font: 'sans', weight: 700, case: 'upper' }, productLine: 'a can', mood: 'calm' } }], ms: 1 }
        : { toolCalls: [], ms: 1 };
    },
  };
  const t0 = Date.now();
  await createCrew(deps, { backend, idleEndMs: 60_000 }).runCrew(deps.filmId);
  expect(Date.now() - t0).toBeLessThan(5000);
  expect(calls).toBe(3);
  expect(seen.filter((x) => x.includes('have not planned any scenes'))).toHaveLength(2);
  expect((await deps.films.get(deps.filmId)).status).toBe('failed');
});

it('a first turn whose dispatch names an unknown scene gets one repair turn at once', async () => {
  const deps = await makeTestDeps();
  const seen: string[] = [];
  let calls = 0;
  const backend: LlmBackend = {
    id: 'wonder',
    async chatWithTools(messages) {
      calls++;
      const last = messages[messages.length - 1];
      seen.push(typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content));
      return calls === 1
        ? { toolCalls: [{ id: 'c0', name: 'say', args: { text: 'on it' } }, { id: 'c1', name: 'dispatch', args: { kind: 'build-scene', sceneId: 'pour', brief: 'pour', reason: 'r' } }], ms: 1 }
        : { toolCalls: [], ms: 1 };
    },
  };
  await createCrew(deps, { backend, idleEndMs: 60_000 }).runCrew(deps.filmId);
  // nothing runs after the failed dispatch, so the stalled wording applies
  expect(seen[1]).toContain('Some tool calls in your last turn failed');
});
