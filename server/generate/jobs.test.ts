import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJobStore, isActiveStatus, type JobRecord } from './jobs';

const rec = (over: Partial<JobRecord>): JobRecord => ({
  filmId: 'f1',
  sceneId: 's1',
  jobId: 'job_1',
  status: 'rendering',
  attempt: 1,
  submittedAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jobs-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('job store', () => {
  it('saves, overwrites and reads back', async () => {
    const s = createJobStore({ dataDir: dir });
    await s.save(rec({}));
    expect(await s.get('f1', 's1')).toEqual(rec({}));
    await s.save(rec({ status: 'checking' }));
    expect((await s.get('f1', 's1'))?.status).toBe('checking');
    expect(await s.get('f1', 'nope')).toBeUndefined();
  });

  it('lists only active records across films', async () => {
    const s = createJobStore({ dataDir: dir });
    await s.save(rec({ filmId: 'f1', sceneId: 'a', status: 'submitted' }));
    await s.save(rec({ filmId: 'f1', sceneId: 'b', status: 'done' }));
    await s.save(rec({ filmId: 'f2', sceneId: 'c', status: 'placing' }));
    await s.save(rec({ filmId: 'f2', sceneId: 'd', status: 'failed' }));
    const got = (await s.listActive()).map((r) => r.sceneId).sort();
    expect(got).toEqual(['a', 'c']);
    expect(isActiveStatus('timed_out')).toBe(false);
  });
});
