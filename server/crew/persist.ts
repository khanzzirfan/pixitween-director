// Owned by S12a. The crew's job board and per-job snapshots, one row each in director.db.
import { jobSchema, type Job } from '@shared/crew';
import { getDb } from '../db/open';
import type { SceneSnapshot } from './scene-snapshot';

export interface CrewPersist {
  saveBoard(jobs: Job[]): Promise<void>;
  /** The saved jobs, or [] when the film has no board yet. */
  loadBoard(): Promise<Job[]>;
  saveSnapshot(jobId: string, snap: SceneSnapshot): Promise<void>;
  loadSnapshot(jobId: string): Promise<SceneSnapshot | undefined>;
}

export function createCrewPersist(dataDir: string, filmId: string): CrewPersist {
  const db = () => getDb(dataDir);
  const checkJob = (jobId: string) => {
    if (!/^j\d+$/.test(jobId)) throw new Error(`bad job id '${jobId}'`);
  };
  return {
    async saveBoard(jobs) {
      db()
        .prepare(
          'INSERT INTO crew_board (film_id, jobs_json, updated_at) VALUES (?, ?, ?) ON CONFLICT (film_id) DO UPDATE SET jobs_json = excluded.jobs_json, updated_at = excluded.updated_at',
        )
        .run(filmId, JSON.stringify(jobs), new Date().toISOString());
    },
    async loadBoard() {
      const row = db().prepare('SELECT jobs_json FROM crew_board WHERE film_id = ?').get(filmId) as { jobs_json: string } | undefined;
      return (row ? (JSON.parse(row.jobs_json) as unknown[]) : []).map((j) => jobSchema.parse(j));
    },
    async saveSnapshot(jobId, snap) {
      checkJob(jobId);
      db()
        .prepare(
          'INSERT INTO crew_snapshots (film_id, job_id, snapshot_json) VALUES (?, ?, ?) ON CONFLICT (film_id, job_id) DO UPDATE SET snapshot_json = excluded.snapshot_json',
        )
        .run(filmId, jobId, JSON.stringify(snap));
    },
    async loadSnapshot(jobId) {
      checkJob(jobId);
      const row = db().prepare('SELECT snapshot_json FROM crew_snapshots WHERE film_id = ? AND job_id = ?').get(filmId, jobId) as
        { snapshot_json: string } | undefined;
      return row ? (JSON.parse(row.snapshot_json) as SceneSnapshot) : undefined;
    },
  };
}
