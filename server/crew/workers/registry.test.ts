import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JOB_KINDS, type Job } from '@shared/crew';
import type { LlmBackend, ToolCall } from '@shared/ports';
import { createFakeShowrunner } from '../fake-showrunner';
import { runContinuityJob } from '../continuity';
import { createCrew } from '../run-crew';
import { makeTestDeps } from '../../test-utils/deps';
import { runBuilderJob } from './builder';
import { runCriticJob } from './critic';
import { createWorkerRegistry } from './registry';

const saved = { ...process.env };
beforeEach(() => {
  process.env.CREW_ENABLED = 'true';
  process.env.CREW_INBOX_DEBOUNCE_MS = '10';
  delete process.env.DIRECTOR_FAKE;
});
afterEach(() => {
  process.env = { ...saved };
});

describe('createWorkerRegistry', () => {
  it('maps every job kind, the builder kinds to runBuilderJob and the checks to their workers', () => {
    const reg = createWorkerRegistry();
    for (const kind of JOB_KINDS) expect(typeof reg[kind]).toBe('function');
    for (const kind of ['build-scene', 'rebuild-scene', 'restyle-scene', 'edit', 'fix', 'revert'] as const) expect(reg[kind]).toBe(runBuilderJob);
    expect(reg.critique).toBe(runCriticJob);
    expect(reg.continuity).toBe(runContinuityJob);
    expect(reg.take).not.toBe(runBuilderJob);
  });
});

describe('a crew film with the real workers', () => {
  /** A model that builds the scene it is asked about: a background, the product, and a headline. */
  const builderBackend = (productId: string): ((job: Job) => LlmBackend) => (job) => {
    let turn = 0;
    return {
      id: 'spark',
      async chatWithTools() {
        if (turn++) return { toolCalls: [], ms: 1 };
        const s = job.sceneId!;
        const calls = [
          { name: 'addLayer', args: { sceneId: s, role: 'bg', kind: 'shape', fill: '#1f2937' } },
          { name: 'addLayer', args: { sceneId: s, role: 'product', kind: 'image', assetId: productId } },
          { name: 'addLayer', args: { sceneId: s, role: 'headline', kind: 'text', text: 'Hello' } },
        ];
        return { toolCalls: calls.map((c, i): ToolCall => ({ id: `${s}_${i}`, ...c })), ms: 1 };
      },
    };
  };

  it('ends ready, with continuity and critique done for every scene (no browser, so the critic uses rules only)', async () => {
    const deps = await makeTestDeps();
    const product = (await deps.films.get(deps.filmId)).brief.productAssetId;
    const workers = createWorkerRegistry({ builder: { backendFor: builderBackend(product) }, critic: { timeoutMs: 40 } });
    await createCrew(deps, { backend: createFakeShowrunner({ delayMs: 5 }), workers, idleEndMs: 600 }).runCrew(deps.filmId);
    await new Promise((r) => setTimeout(r, 40));
    const film = await deps.films.get(deps.filmId);
    expect(film.status).toBe('ready');
    const jobs = new Map<string, Job>();
    for (const e of deps.events) if (e.type === 'job.update') jobs.set(e.job.id, e.job);
    const all = [...jobs.values()];
    for (const id of ['s1', 's2', 's3', 's4']) {
      expect(all.find((j) => j.kind === 'build-scene' && j.sceneId === id)?.status, `build ${id}`).toBe('done');
      expect(all.find((j) => j.kind === 'continuity' && j.sceneId === id)?.status, `continuity ${id}`).toBe('done');
      expect(all.find((j) => j.kind === 'critique' && j.sceneId === id)?.status, `critique ${id}`).toBe('done');
    }
    expect(all.find((j) => j.kind === 'critique')?.summary).toBe('no browser connected; rules only');
    expect(deps.events.filter((e) => e.type === 'capture.request').length).toBeGreaterThanOrEqual(4);
    expect(all.filter((j) => j.status === 'failed').map((j) => [j.id, j.kind, j.sceneId, j.error])).toEqual([]);
  });
});
