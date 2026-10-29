// Owned by S12a. Crew files under data/films/<id>/crew/, written atomically (temp file, then rename) like the film store.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { jobSchema, type Job } from '@shared/crew';
import type { SceneSnapshot } from './scene-snapshot';

async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, file);
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

export interface CrewPersist {
  saveBoard(jobs: Job[]): Promise<void>;
  /** The saved jobs, or [] when the film has no board yet. */
  loadBoard(): Promise<Job[]>;
  saveSnapshot(jobId: string, snap: SceneSnapshot): Promise<void>;
  loadSnapshot(jobId: string): Promise<SceneSnapshot | undefined>;
}

export function createCrewPersist(dataDir: string, filmId: string): CrewPersist {
  const root = join(dataDir, 'films', filmId, 'crew');
  const jobFile = (jobId: string) => {
    if (!/^j\d+$/.test(jobId)) throw new Error(`bad job id '${jobId}'`);
    return join(root, 'snapshots', `${jobId}.json`);
  };
  return {
    saveBoard: (jobs) => writeJson(join(root, 'board.json'), jobs),
    async loadBoard() {
      const raw = await readJson<unknown[]>(join(root, 'board.json'));
      return (raw ?? []).map((j) => jobSchema.parse(j));
    },
    saveSnapshot: (jobId, snap) => writeJson(jobFile(jobId), snap),
    loadSnapshot: (jobId) => readJson<SceneSnapshot>(jobFile(jobId)),
  };
}
