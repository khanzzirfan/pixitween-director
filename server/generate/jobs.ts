// Owned by S7b. Persists in-flight generation state so a restart can resume it.
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnv } from '../env';

export type JobStatus = 'submitted' | 'rendering' | 'downloading' | 'placing' | 'checking' | 'done' | 'failed' | 'cancelled' | 'timed_out';

export interface JobRecord {
  filmId: string;
  sceneId: string;
  jobId: string;
  status: JobStatus;
  attempt: number;
  submittedAt: string;
  updatedAt: string;
  originalDurationSec?: number;
  assetId?: string;
  productVisibleFrac?: number;
  creditsCharged?: number;
  error?: string;
}

const ACTIVE: readonly JobStatus[] = ['submitted', 'rendering', 'downloading', 'placing', 'checking'];
export const isActiveStatus = (status: string): boolean => (ACTIVE as readonly string[]).includes(status);

export interface JobStore {
  save(record: JobRecord): Promise<void>;
  get(filmId: string, sceneId: string): Promise<JobRecord | undefined>;
  listActive(): Promise<JobRecord[]>;
}

export function createJobStore(o: { filmsDir?: string } = {}): JobStore {
  const filmsDir = () => o.filmsDir ?? join(loadEnv().DATA_DIR, 'films');
  const fileFor = (filmId: string, sceneId: string) => join(filmsDir(), filmId, 'generate', `${sceneId}.json`);

  return {
    async save(record) {
      const file = fileFor(record.filmId, record.sceneId);
      await mkdir(join(filmsDir(), record.filmId, 'generate'), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(record, null, 2));
      await rename(tmp, file);
    },

    async get(filmId, sceneId) {
      try {
        return JSON.parse(await readFile(fileFor(filmId, sceneId), 'utf8')) as JobRecord;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw e;
      }
    },

    async listActive() {
      const out: JobRecord[] = [];
      let films: string[];
      try {
        films = await readdir(filmsDir());
      } catch {
        return out;
      }
      for (const film of films) {
        let files: string[];
        try {
          files = (await readdir(join(filmsDir(), film, 'generate'))).filter((f) => f.endsWith('.json'));
        } catch {
          continue;
        }
        for (const f of files) {
          const path = join(filmsDir(), film, 'generate', f);
          try {
            const rec = JSON.parse(await readFile(path, 'utf8')) as JobRecord;
            if (isActiveStatus(rec.status)) out.push(rec);
          } catch {
            console.warn(`generate jobs: skipping unreadable job file ${path}`);
          }
        }
      }
      return out;
    },
  };
}
