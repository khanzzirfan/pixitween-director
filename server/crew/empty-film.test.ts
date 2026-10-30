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
