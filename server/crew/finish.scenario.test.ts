// S12f US-011: a fake-mode film where the showrunner tries to break the finish rules and the crew must hold.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CrewEngine } from '@shared/crew';
import type { LlmBackend, ToolCall } from '@shared/ports';
import type { Scene } from '@shared/storyboard';
import { makeTestDeps } from '../test-utils/deps';
import { createCrew } from './run-crew';
import { clearWorkers, registerWorker } from './workers';

const scene: Omit<Scene, 'id'> = { durationSec: 4, intent: 'a scene', shotType: 'hero', camera: 'static', layersWanted: ['bg'], mode: 'motion', modeReason: 'a still is enough' };
const saved = { ...process.env };

beforeEach(() => {
  process.env.CREW_ENABLED = 'true';
  process.env.CREW_INBOX_DEBOUNCE_MS = '0';
  process.env.CREW_AUTO_FINISH = '1';
  process.env.CREW_MAX_FIXES_PER_SCENE = '3';
});
afterEach(() => {
  process.env = { ...saved };
  clearWorkers();
});

/** Scripted showrunner: plan two scenes, then try to remove a director scene and to run four fixes; then stall. */
function scriptedShowrunner(): LlmBackend {
  const script: ToolCall[][] = [
    [
      { id: 'p1', name: 'reviseStoryboard', args: { ops: [{ op: 'add', scene }, { op: 'add', scene }] } },
      { id: 'p2', name: 'dispatch', args: { kind: 'build-scene', sceneId: 's1', brief: 'b', reason: 'r' } },
      { id: 'p3', name: 'dispatch', args: { kind: 'build-scene', sceneId: 's2', brief: 'b', reason: 'r' } },
    ],
    [
      { id: 'r1', name: 'reviseStoryboard', args: { ops: [{ op: 'remove', sceneId: 's1' }] } },
      ...[1, 2, 3, 4].map((i) => ({ id: `f${i}`, name: 'dispatch', args: { kind: 'fix', sceneId: 's1', brief: `fix ${i}`, reason: 'safe area' } })),
    ],
  ];
  let stalls = 0;
  return {
    id: 'wonder',
    async chatWithTools() {
      const next = script.shift() ?? [{ id: `say${++stalls}`, name: 'say', args: { text: 'on it' } }];
      return { toolCalls: next, ms: 1 };
    },
  };
}

describe.each<CrewEngine>(['native', 'langgraph'])('finish scenario on the %s engine', (engine) => {
  it('ends ready by itself: the director scenes stay, the refusals hold, no job fails', async () => {
    const deps = await makeTestDeps();
    registerWorker('build-scene', async (job) => ({ summary: `built ${job.sceneId}` }));
    registerWorker('fix', async (job) => ({ summary: `fixed ${job.sceneId}` }));

    const session = await createCrew(deps, { backend: scriptedShowrunner(), idleEndMs: 200, engine }).start(deps.filmId);
    session.push({ from: 'user', text: 'two scenes, s1 must stay' });
    await session.done;

    const film = await deps.films.get(deps.filmId);
    expect(film.status).toBe('ready');
    const s1 = film.storyboard?.scenes.find((s) => s.id === 's1');
    expect(s1?.requestedBy).toBe('user');
    expect(film.storyboard?.scenes.map((s) => s.id)).toEqual(expect.arrayContaining(['s1', 's2']));

    const toolCalls = deps.events.filter((e) => e.type === 'tool.call');
    expect(toolCalls.find((e) => e.type === 'tool.call' && e.name === 'reviseStoryboard' && !e.ok)).toMatchObject({ error: expect.stringContaining('asked for by the director') });
    expect(toolCalls.filter((e) => e.type === 'tool.call' && e.name === 'dispatch' && !e.ok).map((e) => e.type === 'tool.call' && e.error)).toEqual([expect.stringContaining('fix cap reached for s1')]);

    const jobs = new Map<string, { kind: string; sceneId?: string; status: string }>();
    for (const e of deps.events) if (e.type === 'job.update') jobs.set(e.job.id, e.job);
    expect([...jobs.values()].filter((j) => j.status === 'failed')).toEqual([]);
    expect([...jobs.values()].filter((j) => j.kind === 'fix' && j.sceneId === 's1' && j.status === 'done').length).toBeLessThanOrEqual(3);
  });
});

/**
 * Gate item 3. Worker events (job.update, worker crew.agent) race the showrunner's own events, so their order differs from
 * run to run on either engine. What the engine decides does not: the film status steps, the storyboard revisions and the
 * tool calls with their outcomes. `say` is left out because how many idle turns it fills depends on how job-end wakes coalesce.
 */
async function runOn(engine: CrewEngine): Promise<{ decisions: string[]; storyboard: string[] }> {
  const deps = await makeTestDeps();
  registerWorker('build-scene', async (job) => ({ summary: `built ${job.sceneId}` }));
  registerWorker('fix', async (job) => ({ summary: `fixed ${job.sceneId}` }));
  const session = await createCrew(deps, { backend: scriptedShowrunner(), idleEndMs: 200, engine }).start(deps.filmId);
  session.push({ from: 'user', text: 'two scenes, s1 must stay' });
  await session.done;
  const film = await deps.films.get(deps.filmId);
  clearWorkers();
  const decisions = deps.events.flatMap((e): string[] => {
    if (e.type === 'film.status') return [`status:${e.status}`];
    if (e.type === 'storyboard.revised') return [`revised:${e.rev}`];
    if (e.type === 'tool.call' && e.name !== 'say') return [`tool:${e.name}:${e.ok ? 'ok' : e.error}`];
    return [];
  });
  return { decisions, storyboard: film.storyboard?.scenes.map((s) => s.id) ?? [] };
}

describe('engine parity', () => {
  it('make the same decisions in the same order on native and langgraph', async () => {
    const native = await runOn('native');
    const graph = await runOn('langgraph');
    expect(native.decisions.length).toBeGreaterThan(8);
    expect(graph.decisions).toEqual(native.decisions);
    expect(graph.storyboard).toEqual(native.storyboard);
  });
});
