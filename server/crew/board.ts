// Owned by S12a. The job table (design.md 4 and 5.2): every transition is checked, announced as a job.update and saved.
import type { Job, JobStatus } from '@shared/crew';

export class JobTransitionError extends Error {
  constructor(jobId: string, from: JobStatus, to: JobStatus) {
    super(`job ${jobId} cannot go from ${from} to ${to}`);
    this.name = 'JobTransitionError';
  }
}

export const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  // queued -> failed is the budget refusing a job that never started (design 5.11)
  queued: ['running', 'failed', 'superseded', 'cancelled'],
  running: ['awaiting-frames', 'done', 'failed', 'superseded', 'cancelled'],
  'awaiting-frames': ['done', 'failed', 'cancelled'],
  done: [],
  failed: [],
  cancelled: [],
  superseded: [],
};

export const TERMINAL: readonly JobStatus[] = ['done', 'failed', 'cancelled', 'superseded'];

export type NewJob = Pick<Job, 'kind' | 'origin'> & Partial<Omit<Job, 'id' | 'kind' | 'origin' | 'status' | 'createdAt'>>;

export interface BoardDeps {
  filmId: string;
  emit(event: { type: 'job.update'; job: Job }): void;
  persist(jobs: Job[]): void | Promise<void>;
  now?: () => number;
  /** Jobs read back from board.json. Ids continue after the highest one. */
  initial?: Job[];
}

export interface Board {
  add(job: NewJob): Job;
  get(id: string): Job | undefined;
  list(): Job[];
  update(id: string, patch: Partial<Omit<Job, 'id'>>): Job;
  /** Resolves when every save so far has finished. */
  flush(): Promise<void>;
}

export function createBoard(deps: BoardDeps): Board {
  const now = deps.now ?? Date.now;
  const iso = () => new Date(now()).toISOString();
  const jobs = new Map<string, Job>((deps.initial ?? []).map((j) => [j.id, structuredClone(j)]));
  let counter = Math.max(0, ...[...jobs.keys()].map((id) => Number(/^j(\d+)$/.exec(id)?.[1] ?? 0)));
  let saving: Promise<void> = Promise.resolve();

  const announce = (job: Job) => {
    deps.emit({ type: 'job.update', job: structuredClone(job) });
    const snapshot = [...jobs.values()].map((j) => structuredClone(j));
    saving = saving.then(() => deps.persist(snapshot)).catch((e: unknown) => console.error(`crew board save failed for ${deps.filmId}:`, e));
  };

  return {
    add(input) {
      const job: Job = { brief: '', reason: '', filmId: deps.filmId, costUsd: 0, ...input, id: `j${++counter}`, status: 'queued', createdAt: iso() };
      jobs.set(job.id, job);
      announce(job);
      return structuredClone(job);
    },
    get: (id) => (jobs.has(id) ? structuredClone(jobs.get(id)!) : undefined),
    list: () => [...jobs.values()].map((j) => structuredClone(j)),
    update(id, patch) {
      const job = jobs.get(id);
      if (!job) throw new Error(`no job '${id}'`);
      if (patch.status !== undefined && patch.status !== job.status) {
        if (!TRANSITIONS[job.status].includes(patch.status)) throw new JobTransitionError(id, job.status, patch.status);
        if (patch.status === 'running' && !job.startedAt) job.startedAt = iso();
        if (TERMINAL.includes(patch.status)) {
          job.endedAt = iso();
          if (job.startedAt) job.ms = Date.parse(job.endedAt) - Date.parse(job.startedAt);
        }
      }
      Object.assign(job, patch);
      announce(job);
      return structuredClone(job);
    },
    flush: () => saving,
  };
}
