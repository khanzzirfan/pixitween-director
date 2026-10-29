import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Job } from '@shared/crew';
import { addLayer } from '../authoring/api';
import { sceneIds } from '../authoring/meta';
import type { Comp, Obj } from '../authoring/types';
import { fixturePath } from '../test-utils/fixtures';
import { makeTestFilm } from '../test-utils/film';
import { createScheduler, type WorkerResult } from './scheduler';
import { snapshotScene } from './scene-snapshot';
import { makeTestBoard } from './test-helpers';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Workers that wait to be released, so a test decides when each one finishes. */
function fakeWorkers() {
  const started: string[] = [];
  const gates = new Map<string, { release(r?: WorkerResult): void; fail(e: Error): void }>();
  const runWorker = (job: Job, signal: AbortSignal) =>
    new Promise<WorkerResult | void>((resolve, reject) => {
      started.push(job.id);
      gates.set(job.id, { release: (r) => resolve(r), fail: reject });
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  return { started, gates, runWorker };
}
const spec = (kind: Job['kind'], sceneId: string, origin: Job['origin'] = 'auto') => ({ kind, sceneId, origin, brief: `${kind} ${sceneId}`, reason: 'test' });

describe('scheduler: order and limits', () => {
  it('runs 4 of 6 builds at once and starts the fifth when one finishes', async () => {
    const t = makeTestBoard();
    const w = fakeWorkers();
    const s = createScheduler({ board: t.board, maxWorkers: 4, runWorker: w.runWorker });
    for (let i = 1; i <= 6; i++) await s.dispatch(spec('build-scene', `s${i}`));
    await tick();
    expect(w.started).toEqual(['j1', 'j2', 'j3', 'j4']);
    expect(s.activeCount()).toBe(4);
    w.gates.get('j2')!.release({ summary: 'built' });
    await tick();
    expect(w.started).toEqual(['j1', 'j2', 'j3', 'j4', 'j5']);
    expect(t.board.get('j2')).toMatchObject({ status: 'done', summary: 'built' });
  });

  it('does not start a second writer on a scene that has one, but does start one on another scene', async () => {
    const t = makeTestBoard();
    const w = fakeWorkers();
    const s = createScheduler({ board: t.board, maxWorkers: 4, runWorker: w.runWorker });
    await s.dispatch(spec('build-scene', 's1'));
    // an edit from the showrunner does not replace the builder, so it queues behind it
    await s.dispatch(spec('edit', 's1', 'showrunner'));
    await s.dispatch(spec('build-scene', 's2'));
    await tick();
    expect(w.started).toEqual(['j1', 'j3']);
    expect(t.board.get('j2')!.status).toBe('queued');
    w.gates.get('j1')!.release();
    await tick();
    expect(w.started).toEqual(['j1', 'j3', 'j2']);
  });

  it('a user restyle queued after three auto builds starts first when one slot frees', async () => {
    const t = makeTestBoard();
    const w = fakeWorkers();
    const s = createScheduler({ board: t.board, maxWorkers: 1, runWorker: w.runWorker });
    await s.dispatch(spec('build-scene', 's1'));
    await tick();
    await s.dispatch(spec('build-scene', 's2'));
    await s.dispatch(spec('build-scene', 's3'));
    await s.dispatch(spec('build-scene', 's4'));
    await s.dispatch(spec('restyle-scene', 's5', 'user'));
    w.gates.get('j1')!.release();
    await tick();
    expect(w.started).toEqual(['j1', 'j5']);
  });

  it('fix goes before build, and a take after a build', async () => {
    const t = makeTestBoard();
    const w = fakeWorkers();
    const s = createScheduler({ board: t.board, maxWorkers: 1, runWorker: w.runWorker });
    await s.dispatch(spec('build-scene', 's1'));
    await tick();
    await s.dispatch(spec('take', 's2'));
    await s.dispatch(spec('build-scene', 's3'));
    await s.dispatch(spec('fix', 's4', 'showrunner'));
    w.gates.get('j1')!.release();
    await tick();
    w.gates.get('j4')!.release();
    await tick();
    w.gates.get('j3')!.release();
    await tick();
    expect(w.started).toEqual(['j1', 'j4', 'j3', 'j2']);
  });

  it('a critique does not start while a writing job on its scene is queued or running', async () => {
    const t = makeTestBoard();
    const w = fakeWorkers();
    const s = createScheduler({ board: t.board, maxWorkers: 4, runWorker: w.runWorker });
    // the critique goes into the board directly, as the auto-chain will: the writer is queued first
    t.board.add({ ...spec('build-scene', 's1') });
    t.board.add({ ...spec('critique', 's1') });
    s.pump();
    await tick();
    expect(w.started).toEqual(['j1']);
    w.gates.get('j1')!.release();
    await tick();
    expect(w.started).toEqual(['j1', 'j2']);
  });

  it('a job waits for its dependsOn, and is cancelled if that job fails', async () => {
    const t = makeTestBoard();
    const w = fakeWorkers();
    const s = createScheduler({ board: t.board, maxWorkers: 4, runWorker: w.runWorker });
    await s.dispatch(spec('build-scene', 's1'));
    await s.dispatch({ ...spec('critique', 's2'), dependsOn: ['j1'] });
    await tick();
    expect(w.started).toEqual(['j1']);
    w.gates.get('j1')!.fail(new Error('model said no'));
    await tick();
    expect(t.board.get('j1')).toMatchObject({ status: 'failed', error: 'model said no' });
    expect(t.board.get('j2')!.status).toBe('cancelled');
  });

  it('a finished worker marks the job done with its summary and cost, and idle() resolves', async () => {
    const t = makeTestBoard();
    const w = fakeWorkers();
    const s = createScheduler({ board: t.board, maxWorkers: 2, runWorker: w.runWorker });
    await s.dispatch(spec('build-scene', 's1'));
    await tick();
    const idle = s.idle();
    w.gates.get('j1')!.release({ summary: '7 tool calls', costUsd: 0.03, version: 4 });
    await idle;
    expect(t.board.get('j1')).toMatchObject({ status: 'done', summary: '7 tool calls', costUsd: 0.03, version: 4, worker: 'w1' });
  });

  it('gives each running job its own worker name', async () => {
    const t = makeTestBoard();
    const w = fakeWorkers();
    const s = createScheduler({ board: t.board, maxWorkers: 3, runWorker: w.runWorker });
    for (const id of ['s1', 's2', 's3']) await s.dispatch(spec('build-scene', id));
    await tick();
    expect(t.board.list().map((j) => j.worker)).toEqual(['w1', 'w2', 'w3']);
  });
});

describe('scheduler: supersede, cancel and rollback', () => {
  const twoScenes = () => JSON.parse(readFileSync(fixturePath('s03a', 'valid/two-scene-dolly.json'), 'utf8')) as Comp;
  const precomp = (c: Comp, id: string) => (c.precomps as Record<string, Obj>)[id]!;
  const layerCount = (c: Comp, id: string) => precomp(c, id).layers.length;

  /** A builder that commits one layer per tick and checks the signal between ticks. */
  async function setup(maxWorkers = 4) {
    const film = await makeTestFilm({ composition: twoScenes() });
    const t = makeTestBoard({ filmId: film.filmId });
    const [S1, S2] = sceneIds(twoScenes()) as [string, string];
    const gates = new Map<string, () => void>();
    const runWorker = async (job: Job, signal: AbortSignal): Promise<WorkerResult> => {
      for (let i = 0; i < 4; i++) {
        if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        if (job.kind === 'build-scene' || job.kind === 'rebuild-scene') {
          await film.films.mutate(job.filmId, (f) => ({ next: addLayer(f.composition!, { sceneId: job.sceneId!, role: 'caption', kind: 'text', text: `${job.id} layer ${i}` }), data: undefined }), 'director', `${job.id} ${i}`);
        }
        // pause after two layers, like a model call in flight: an abort ends it
        if (i === 1 && job.kind === 'build-scene')
          await new Promise<void>((resolve, reject) => {
            gates.set(job.id, resolve);
            signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          });
        await tick();
      }
      return { summary: 'done' };
    };
    const s = createScheduler({ board: t.board, maxWorkers, runWorker, films: film.films, persist: t.persist });
    const comp = async () => (await film.films.get(film.filmId)).composition!;
    return { film, t, s, S1, S2, gates, comp };
  }

  it('a user restyle supersedes a running builder and s1 is back at its snapshot before the restyle starts', async () => {
    const { film, t, s, S1, S2, gates, comp } = await setup();
    const before = await comp();
    const s1Before = snapshotScene(before, S1);
    await s.dispatch(spec('build-scene', S1));
    await vi_waitFor(() => gates.has('j1'));
    expect(layerCount(await comp(), S1)).toBe(layerCount(before, S1) + 2);

    // scene s2 is built by another worker while the rollback happens
    const other = await s.dispatch(spec('build-scene', S2));
    await vi_waitFor(() => gates.has(other.id));
    const s2Before = structuredClone(precomp(await comp(), S2));

    const startedBeforeRestyle: Array<string> = [];
    const second = await s.dispatch({ ...spec('restyle-scene', S1, 'user'), brief: 'warmer light' });
    startedBeforeRestyle.push(...t.board.list().filter((j) => j.status !== 'queued').map((j) => j.id));

    expect(t.board.get('j1')).toMatchObject({ status: 'superseded', supersededBy: second.id });
    expect(snapshotScene(await comp(), S1).precomp).toEqual(s1Before.precomp);
    expect(await film.films.versions(film.filmId)).toSatisfy((v: Array<{ note?: string }>) => v.some((x) => x.note === 'rollback j1'));
    // s2 has not been rolled back or touched by the rollback
    expect(precomp(await comp(), S2)).toEqual(s2Before);
    expect(other.sceneId).toBe(S2);
    gates.get(other.id)!();
    await s.idle();
    expect(t.board.get(second.id)!.status).toBe('done');
  });

  it('a queued build on s1 becomes superseded and a queued critique on s1 becomes cancelled', async () => {
    const t = makeTestBoard();
    const w = fakeWorkers();
    const s = createScheduler({ board: t.board, maxWorkers: 1, runWorker: w.runWorker });
    await s.dispatch(spec('build-scene', 's9')); // occupies the only worker
    await tick();
    t.board.add(spec('build-scene', 's1'));
    t.board.add(spec('critique', 's1'));
    const next = await s.dispatch(spec('restyle-scene', 's1', 'user'));
    expect(t.board.get('j2')).toMatchObject({ status: 'superseded', supersededBy: next.id });
    expect(t.board.get('j3')!.status).toBe('cancelled');
  });

  it('a showrunner edit waits for the running builder instead of cancelling it', async () => {
    const t = makeTestBoard();
    const w = fakeWorkers();
    const s = createScheduler({ board: t.board, maxWorkers: 4, runWorker: w.runWorker });
    await s.dispatch(spec('build-scene', 's1'));
    await tick();
    const edit = await s.dispatch(spec('edit', 's1', 'showrunner'));
    await tick();
    expect(t.board.get('j1')!.status).toBe('running');
    expect(edit.status).toBe('queued');
    w.gates.get('j1')!.release();
    await tick();
    expect(w.started).toEqual(['j1', edit.id]);
  });

  it('cancel() on a running job aborts the worker, rolls back and ends it cancelled', async () => {
    const { film, t, s, S1, gates, comp } = await setup();
    const before = await comp();
    await s.dispatch(spec('build-scene', S1));
    await vi_waitFor(() => gates.has('j1'));
    await s.cancel('j1');
    expect(t.board.get('j1')!.status).toBe('cancelled');
    expect(snapshotScene(await comp(), S1).precomp).toEqual(snapshotScene(before, S1).precomp);
    expect((await film.films.versions(film.filmId)).some((v) => v.note === 'rollback j1')).toBe(true);
  });

  it('saves the snapshot under crew/snapshots/<jobId>.json', async () => {
    const { t, s, S1, gates } = await setup();
    await s.dispatch(spec('build-scene', S1));
    await vi_waitFor(() => gates.has('j1'));
    expect((await t.persist.loadSnapshot('j1'))?.precomp).toBeDefined();
    await s.cancel('j1');
  });
});

/** Polls until `ok()` holds. */
async function vi_waitFor(ok: () => boolean, ms = 2000): Promise<void> {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error('condition not reached');
    await tick();
  }
}
