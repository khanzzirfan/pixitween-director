import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LlmBackend, ToolCall } from '@shared/ports';
import type { Scene } from '@shared/storyboard';
import { makeTestDeps } from '../test-utils/deps';
import { createCrew } from './run-crew';
import { waitFor } from './test-helpers';
import { clearWorkers, registerWorker } from './workers';

const saved = { ...process.env };
beforeEach(() => {
  process.env.CREW_ENABLED = 'true';
  process.env.CREW_INBOX_DEBOUNCE_MS = '0';
});
afterEach(() => {
  process.env = { ...saved };
  clearWorkers();
});

const scene: Omit<Scene, 'id'> = { durationSec: 4, intent: 'a scene', shotType: 'hero', camera: 'static', layersWanted: ['bg'], mode: 'motion', modeReason: 'a still is enough' };
const settle = () => new Promise<void>((r) => setTimeout(r, 30));

function scripted(turns: Array<Array<{ name: string; args: unknown }>>): LlmBackend {
  const queue = [...turns];
  let n = 0;
  return {
    id: 'wonder',
    async chatWithTools() {
      const calls = queue.shift() ?? [];
      const t = n++;
      return { toolCalls: calls.map((c, i): ToolCall => ({ id: `c${t}_${i}`, name: c.name, args: c.args })), ms: 5 };
    },
  };
}

/** The scripted backend, also keeping each call's messages as JSON so a test can check what the showrunner was shown. */
function recording(turns: Array<Array<{ name: string; args: unknown }>>): LlmBackend & { sent: string[] } {
  const queue = [...turns];
  const sent: string[] = [];
  let n = 0;
  return {
    id: 'wonder',
    sent,
    async chatWithTools(messages) {
      sent.push(JSON.stringify(messages));
      const calls = queue.shift() ?? [];
      const t = n++;
      return { toolCalls: calls.map((c, i): ToolCall => ({ id: `c${t}_${i}`, name: c.name, args: c.args })), ms: 5 };
    },
  };
}

describe('runCrew', () => {
  it('plans, builds with the registered worker, and leaves the film ready', async () => {
    const deps = await makeTestDeps();
    registerWorker('build-scene', async (job) => ({ summary: `built ${job.sceneId}` }));
    const backend = scripted([[
      { name: 'reviseStoryboard', args: { ops: [{ op: 'add', scene }, { op: 'add', scene }] } },
      { name: 'dispatch', args: { kind: 'build-scene', sceneId: 's1', brief: 'b', reason: 'r' } },
      { name: 'dispatch', args: { kind: 'build-scene', sceneId: 's2', brief: 'b', reason: 'r' } },
    ]]);
    const crew = createCrew(deps, { backend, idleEndMs: 60, workers: {} });
    await crew.runCrew(deps.filmId);
    await settle();
    const film = await deps.films.get(deps.filmId);
    expect(film.status).toBe('ready');
    expect(film.storyboardRev).toBe(1);
    expect(deps.events.filter((e) => e.type === 'film.status').map((e) => (e as { status: string }).status)).toEqual(['planning', 'building', 'ready']);
    const done = deps.events.filter((e) => e.type === 'job.update' && e.job.status === 'done' && e.job.kind === 'build-scene');
    expect(done).toHaveLength(2);
  });

  it('puts the brief in the first inbox item the showrunner sees', async () => {
    const deps = await makeTestDeps();
    const seen: string[] = [];
    const backend: LlmBackend = { id: 'wonder', async chatWithTools(m) { seen.push(JSON.stringify(m)); return { toolCalls: [], ms: 1 }; } };
    await createCrew(deps, { backend, idleEndMs: 40 }).runCrew(deps.filmId);
    expect(seen[0]).toContain('New film. Brief: test brief');
    expect(seen[0]).toContain('[system]');
  });

  it('a showrunner that throws ends the film failed with an error event, and the promise resolves', async () => {
    const deps = await makeTestDeps();
    const backend: LlmBackend = { id: 'wonder', async chatWithTools() { throw new Error('model is down'); } };
    await expect(createCrew(deps, { backend, idleEndMs: 40 }).runCrew(deps.filmId)).resolves.toBeUndefined();
    await settle();
    expect((await deps.films.get(deps.filmId)).status).toBe('failed');
    expect(deps.events.find((e) => e.type === 'error' && e.where === 'showrunner')).toMatchObject({ message: 'model is down' });
  });

  it('a job with no registered worker fails on the board instead of hanging', async () => {
    const deps = await makeTestDeps();
    const backend = scripted([[
      { name: 'reviseStoryboard', args: { ops: [{ op: 'add', scene }, { op: 'add', scene }] } },
      { name: 'dispatch', args: { kind: 'build-scene', sceneId: 's1', brief: 'b', reason: 'r' } },
    ]]);
    await createCrew(deps, { backend, idleEndMs: 60, workers: {} }).runCrew(deps.filmId);
    await settle();
    const job = [...deps.events].reverse().find((e) => e.type === 'job.update' && e.job.id === 'j1');
    expect(job).toMatchObject({ job: { status: 'failed', error: 'no worker for build-scene' } });
  });

  it('keeps one session per film and removes it when the session ends', async () => {
    const deps = await makeTestDeps();
    const crew = createCrew(deps, { backend: scripted([]), idleEndMs: 50 });
    const a = await crew.start(deps.filmId);
    expect(await crew.start(deps.filmId)).toBe(a);
    expect(crew.get(deps.filmId)).toBe(a);
    await a.done;
    expect(crew.get(deps.filmId)).toBeUndefined();
  });

  it('a user item pushed into the session reaches the showrunner at once', async () => {
    const deps = await makeTestDeps();
    const seen: string[] = [];
    const backend: LlmBackend = { id: 'wonder', async chatWithTools(m) { seen.push(JSON.stringify(m.at(-1))); return { toolCalls: [], ms: 1 }; } };
    const crew = createCrew(deps, { backend, idleEndMs: 200 });
    const session = await crew.start(deps.filmId);
    // an empty crew is prompted to plan and then fails, so the note goes in while the session is still open
    session.push({ from: 'user', text: 'make it warmer' });
    await session.done;
    expect(seen.some((s) => s.includes('make it warmer'))).toBe(true);
  });

  it('a user message on the LangGraph engine reaches the showrunner within 100 ms while a builder is still running', async () => {
    const deps = await makeTestDeps();
    let builderStarted = false;
    let builderDone = false;
    registerWorker('build-scene', async (job) => {
      builderStarted = true;
      await new Promise((r) => setTimeout(r, 1500));
      builderDone = true;
      return { summary: `built ${job.sceneId}` };
    });
    const queue: ToolCall[][] = [
      [{ id: 'c0', name: 'reviseStoryboard', args: { ops: [{ op: 'add', scene }, { op: 'add', scene }] } }, { id: 'c1', name: 'dispatch', args: { kind: 'build-scene', sceneId: 's1', brief: 'b', reason: 'r' } }],
    ];
    const seen: Array<{ at: number; text: string }> = [];
    const backend: LlmBackend = {
      id: 'wonder',
      async chatWithTools(m) {
        seen.push({ at: Date.now(), text: JSON.stringify(m.at(-1)) });
        return { toolCalls: queue.shift() ?? [{ id: `say${seen.length}`, name: 'say', args: { text: 'on it' } }], ms: 1 };
      },
    };
    const crew = createCrew(deps, { backend, idleEndMs: 200 });
    const session = await crew.start(deps.filmId);
    await waitFor(() => builderStarted);
    const pushedAt = Date.now();
    session.push({ from: 'user', text: 'make it warmer' });
    await waitFor(() => seen.some((s) => s.text.includes('make it warmer')));
    const heard = seen.find((s) => s.text.includes('make it warmer'))!;
    expect(heard.at - pushedAt).toBeLessThan(100);
    expect(builderDone).toBe(false);
    await session.done;
    expect(builderDone).toBe(true);
  });

  it('runs the same plan on the LangGraph engine and saves its checkpoint', async () => {
    const deps = await makeTestDeps();
    registerWorker('build-scene', async (job) => ({ summary: `built ${job.sceneId}` }));
    const backend = scripted([[
      { name: 'reviseStoryboard', args: { ops: [{ op: 'add', scene }, { op: 'add', scene }] } },
      { name: 'dispatch', args: { kind: 'build-scene', sceneId: 's1', brief: 'b', reason: 'r' } },
      { name: 'dispatch', args: { kind: 'build-scene', sceneId: 's2', brief: 'b', reason: 'r' } },
    ]]);
    await createCrew(deps, { backend, idleEndMs: 60, workers: {} }).runCrew(deps.filmId);
    await settle();
    const film = await deps.films.get(deps.filmId);
    expect(film.status).toBe('ready');
    expect(deps.events.filter((e) => e.type === 'film.status').map((e) => (e as { status: string }).status)).toEqual(['planning', 'building', 'ready']);
    expect(existsSync(join(deps.dir, 'films', deps.filmId, 'crew', 'checkpoints', 'showrunner.json'))).toBe(true);
  });

  it('a LangGraph session stopped mid-build resumes with no duplicate job and no lost inbox item', async () => {
    const deps = await makeTestDeps();
    let started = 0;
    registerWorker('build-scene', (_job, signal) => {
      started++;
      return new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('stopped'))));
    });
    const first = recording([[
      { name: 'reviseStoryboard', args: { ops: [{ op: 'add', scene }, { op: 'add', scene }] } },
      { name: 'dispatch', args: { kind: 'build-scene', sceneId: 's1', brief: 'b', reason: 'r' } },
    ]]);
    const s1 = await createCrew(deps, { backend: first, idleEndMs: 200 }).start(deps.filmId);
    s1.push({ from: 'user', text: 'make two scenes' });
    await waitFor(() => started >= 1);
    s1.stop();
    await s1.done;

    const second = recording([[{ name: 'say', args: { text: 'picked up' } }]]);
    const s2 = await createCrew(deps, { backend: second, idleEndMs: 200 }).start(deps.filmId, { resume: true });
    s2.push({ from: 'user', text: 'carry on' });
    await s2.done;

    const builds = new Set(deps.events.filter((e) => e.type === 'job.update' && e.job.kind === 'build-scene' && e.job.sceneId === 's1').map((e) => e.type === 'job.update' && e.job.id));
    expect(builds.size).toBe(1);
    expect(second.sent.at(-1)).toContain('carry on');
    expect(second.sent[0]).toContain('make two scenes');
  });

  it('resumes the LangGraph showrunner with its history after a session ends', async () => {
    const deps = await makeTestDeps();
    registerWorker('build-scene', async (job) => ({ summary: `built ${job.sceneId}` }));
    const first = scripted([[
      { name: 'reviseStoryboard', args: { ops: [{ op: 'add', scene }, { op: 'add', scene }] } },
      { name: 'dispatch', args: { kind: 'build-scene', sceneId: 's1', brief: 'b', reason: 'r' } },
      { name: 'dispatch', args: { kind: 'build-scene', sceneId: 's2', brief: 'b', reason: 'r' } },
    ]]);
    await createCrew(deps, { backend: first, idleEndMs: 60, workers: {} }).runCrew(deps.filmId);
    await settle();

    const seen: string[] = [];
    const second: LlmBackend = { id: 'wonder', async chatWithTools(m) { seen.push(JSON.stringify(m)); return { toolCalls: [], content: 'still here', ms: 1 }; } };
    const session = await createCrew(deps, { backend: second, idleEndMs: 40 }).start(deps.filmId, { resume: true });
    session.push({ from: 'user', text: 'one more thing' });
    await session.done;
    await settle();
    expect(seen[0]).toContain('New film. Brief: test brief');
    expect(deps.events.some((e) => e.type === 'showrunner.say' && e.text === 'still here')).toBe(true);
  });

  it('saves the board under data/films/<id>/crew/board.json and can resume it', async () => {
    const deps = await makeTestDeps();
    registerWorker('build-scene', async () => ({ summary: 'ok' }));
    const backend = scripted([[
      { name: 'reviseStoryboard', args: { ops: [{ op: 'add', scene }, { op: 'add', scene }] } },
      { name: 'dispatch', args: { kind: 'build-scene', sceneId: 's1', brief: 'b', reason: 'r' } },
    ]]);
    await createCrew(deps, { backend, idleEndMs: 60, workers: {} }).runCrew(deps.filmId);
    await settle();
    const resumed = createCrew(deps, { backend: scripted([]), idleEndMs: 30 });
    const s = await resumed.start(deps.filmId, { resume: true });
    expect(s.crew.board.get('j1')).toMatchObject({ kind: 'build-scene', status: 'done' });
    await s.done;
  });
});
