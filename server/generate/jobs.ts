// Owned by S7b. Persists in-flight generation state so a restart can resume it.
import { getDb } from '../db/open';
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
  /** The clip length asked for; the resume path needs it to place the clip. */
  clipSec?: number;
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

export function createJobStore(o: { dataDir?: string } = {}): JobStore {
  const db = () => getDb(o.dataDir ?? loadEnv().DATA_DIR);

  return {
    async save(record) {
      db()
        .prepare(
          `INSERT INTO generate_jobs (film_id, scene_id, status, record_json, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (film_id, scene_id) DO UPDATE SET status = excluded.status, record_json = excluded.record_json, updated_at = excluded.updated_at`,
        )
        .run(record.filmId, record.sceneId, record.status, JSON.stringify(record), record.updatedAt);
    },

    async get(filmId, sceneId) {
      const row = db().prepare('SELECT record_json FROM generate_jobs WHERE film_id = ? AND scene_id = ?').get(filmId, sceneId) as
        { record_json: string } | undefined;
      return row ? (JSON.parse(row.record_json) as JobRecord) : undefined;
    },

    async listActive() {
      const marks = ACTIVE.map(() => '?').join(',');
      const rows = db()
        .prepare(`SELECT record_json FROM generate_jobs WHERE status IN (${marks}) ORDER BY film_id, scene_id`)
        .all(...ACTIVE) as { record_json: string }[];
      return rows.map((r) => JSON.parse(r.record_json) as JobRecord);
    },
  };
}
