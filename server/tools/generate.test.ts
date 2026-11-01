import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@shared/tools';
import { mugScene } from '../authoring/test-helpers';
import { createApprovalStore } from '../generate/approval';
import { createJobStore, type JobRecord } from '../generate/jobs';
import { setSceneMode } from '../generate/mode';
import { getGenerationRunner, getRevertHandler } from '../generate/runner-registry';
import { setGenerateServicesForTests } from '../generate/services';
import { swapInClip } from '../generate/swap';
import { makeTestFilm } from '../test-utils/film';
import { proposeGenerate, resumeGenerations, revertScene } from './generate';

afterEach(() => setGenerateServicesForTests(undefined));

const job = (sceneId: string, status: JobRecord['status'] = 'rendering'): JobRecord => ({
  filmId: 'film_3fa9c2d41b7e', sceneId, jobId: `job_${sceneId}`, status, attempt: 1, submittedAt: 'x', updatedAt: 'x',
});

describe('registration', () => {
  it('registers a runner and a revert handler on import', () => {
    expect(typeof getGenerationRunner()?.run).toBe('function');
    expect(typeof getRevertHandler()).toBe('function');
  });
});

describe('proposeGenerate', () => {
  async function setup(mode: 'motion' | 'generate') {
    const t = await makeTestFilm({ composition: setSceneMode(mugScene(), 's1', mode) });
    setGenerateServicesForTests({ approvals: createApprovalStore({ dir: () => t.dir }), clippy: undefined, balance: { read: async () => undefined } });
    return t;
  }

  it('refuses a motion scene', async () => {
    const t = await setup('motion');
    expect(await proposeGenerate.run(t.ctx, { sceneId: 's1' })).toEqual({ ok: false, error: 'scene is not a generate scene' });
  });

  it('proposes on a generate scene and keeps the token out of the result', async () => {
    const t = await setup('generate');
    const r = await proposeGenerate.run(t.ctx, { sceneId: 's1' });
    await new Promise((res) => setTimeout(res, 50));
    const proposed = t.events.filter((e) => e.type === 'generate.proposed');
    expect(proposed).toHaveLength(1);
    const token = (proposed[0] as { token: string }).token;
    expect(r).toEqual({ ok: true, data: { proposed: true, estCredits: 25 } });
    expect(JSON.stringify(r)).not.toContain(token);
  });
});

describe('revertScene', () => {
  it('restores the original composition, and a second call changes nothing', async () => {
    const original = setSceneMode(mugScene(), 's1', 'generate');
    const t = await makeTestFilm({ composition: original });
    const swapped = swapInClip(original, { sceneId: 's1', asset: { id: 'ast_ffffffffffffffffffffffffffffffff', url: '/api/assets/x' }, clipSec: 2.5, frame: { width: 1920, height: 1080 }, clipSize: { width: 1280, height: 720 } });
    await t.films.commit(t.filmId, swapped, 'generate');
    const jobs = createJobStore({ filmsDir: join(t.dir, 'films') });
    await jobs.save({ ...job('s1', 'done'), filmId: t.filmId, originalDurationSec: 4 });

    await revertScene(t.ctx, 's1', jobs);
    const after = await t.films.get(t.filmId);
    expect(after.composition).toEqual(original);
    await revertScene(t.ctx, 's1', jobs);
    expect((await t.films.get(t.filmId)).version).toBe(after.version);
  });
});

describe('resumeGenerations', () => {
  const ctx = {} as ToolCtx;
  const store = (records: JobRecord[]) => ({ save: async () => undefined, get: async () => undefined, listActive: async () => records });

  it('counts resumed jobs', async () => {
    const resume = vi.fn(async () => undefined);
    expect(await resumeGenerations(async () => ctx, { jobs: store([job('a'), job('b')]), runner: { resume } })).toBe(2);
    expect(resume).toHaveBeenCalledTimes(2);
    expect(await resumeGenerations(async () => ctx, { jobs: store([]), runner: { resume } })).toBe(0);
  });

  it('logs a failing job, does not count it and does not reject', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const resume = vi.fn(async (_c: ToolCtx, j: JobRecord) => {
      if (j.sceneId === 'bad') throw new Error('boom');
    });
    expect(await resumeGenerations(async () => ctx, { jobs: store([job('bad'), job('good')]), runner: { resume } })).toBe(1);
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});
