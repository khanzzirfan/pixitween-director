import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmBackend } from '@shared/ports';
import { addLayer, addScene, newFilmComposition } from '../../authoring/api';
import { makeTestCrew } from '../test-helpers';

let local = false;
const picked: Array<{ task: string; local?: boolean }> = [];
const backend = (id: LlmBackend['id']): LlmBackend => ({
  id,
  async chatWithTools() {
    return { toolCalls: [{ id: 'a', name: 'setText', args: { layerId: 's1:headline', text: 'edited' } }], ms: 1 };
  },
});
vi.mock('../../llm/local-mode', () => ({ getLocalMode: () => local }));
vi.mock('../../llm/router', () => ({
  pickBackend: (task: string, o?: { local?: boolean }) => {
    picked.push({ task, local: o?.local });
    return backend(o?.local ? 'glimmer' : 'spark');
  },
}));

const { runBuilderJob } = await import('./builder');

beforeEach(() => {
  local = false;
  picked.length = 0;
});

async function setup() {
  const t = await makeTestCrew();
  let c = addScene(newFilmComposition({ aspect: '16:9', title: 'T', palette: ['#111111'] }), { id: 's1', durationSec: 4, mode: 'motion' });
  c = addLayer(c, { sceneId: 's1', role: 'headline', kind: 'text', text: 'before' });
  await t.film.films.commit(t.film.filmId, c, 'director');
  await t.film.films.update(t.film.filmId, {
    storyboard: { title: 'T', aspect: '16:9', durationSec: 8, palette: ['#111111'], scenes: [1, 2].map((i) => ({ id: `s${i}`, durationSec: 4, intent: 'i', shotType: 'hero' as const, camera: 'static' as const, layersWanted: ['bg' as const], mode: 'motion' as const, modeReason: 'r' })) },
  });
  const job = t.board.add({ kind: 'edit', origin: 'showrunner', sceneId: 's1', brief: 'change the headline', reason: 'r' });
  return { ...t, job };
}
const agentEvents = (t: Awaited<ReturnType<typeof setup>>) => t.events.filter((e) => e.type === 'crew.agent') as Array<{ lane: string; worker: string; state: string; model?: string }>;
const settle = () => new Promise<void>((r) => setTimeout(r, 30));

describe('the local lane', () => {
  it('with Local mode on an edit job runs on Glimmer, on the local lane, and the job says so', async () => {
    local = true;
    const t = await setup();
    await runBuilderJob(t.job, new AbortController().signal, t.crew);
    await settle();
    expect(picked).toEqual([{ task: 'edit', local: true }]);
    expect(agentEvents(t).map((e) => [e.lane, e.worker, e.state])).toEqual([['local', 'local', 'working'], ['local', 'local', 'idle']]);
    expect(t.board.get(t.job.id)).toMatchObject({ worker: 'local', model: 'muse-glimmer:30b-mlx' });
  });

  it('with Local mode off the same job runs on Spark, on the builder lane', async () => {
    const t = await setup();
    await runBuilderJob(t.job, new AbortController().signal, t.crew);
    await settle();
    expect(picked).toEqual([{ task: 'edit', local: false }]);
    expect(agentEvents(t)[0]).toMatchObject({ lane: 'builder', state: 'working' });
    expect(t.board.get(t.job.id)!.worker).not.toBe('local');
  });

  it('a restyle stays on Spark in Local mode, because it needs new art', async () => {
    local = true;
    const t = await setup();
    const restyle = t.board.add({ kind: 'restyle-scene', origin: 'showrunner', sceneId: 's1', brief: 'b', reason: 'r' });
    await runBuilderJob(restyle, new AbortController().signal, t.crew);
    expect(picked).toEqual([{ task: 'build', local: undefined }]);
  });

  it('the idle event still goes out when the job fails', async () => {
    const t = await setup();
    const bad = t.board.add({ kind: 'fix', origin: 'showrunner', sceneId: 's9', brief: 'b', reason: 'r' });
    await expect(runBuilderJob(bad, new AbortController().signal, t.crew)).rejects.toThrow(/scene s9 is not in the storyboard/);
    await settle();
    expect(agentEvents(t)).toEqual([]); // it failed before it started working, so there is nothing to close
  });
});
