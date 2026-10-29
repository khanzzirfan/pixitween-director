// Owned by S12b, filled by S12c. Which function runs which kind of job. A kind with no worker fails its job, so a gap shows on the board.
import type { Job, JobKind } from '@shared/crew';
import type { WorkerResult } from './scheduler';
import type { CrewCtx } from './showrunner-tools';

export type WorkerFn = (job: Job, signal: AbortSignal, crew: CrewCtx) => Promise<WorkerResult | void>;

const registry = new Map<JobKind, WorkerFn>();

export function registerWorker(kind: JobKind, fn: WorkerFn): void {
  registry.set(kind, fn);
}

export function clearWorkers(): void {
  registry.clear();
}

export async function runRegisteredWorker(job: Job, signal: AbortSignal, crew: CrewCtx): Promise<WorkerResult | void> {
  const fn = registry.get(job.kind);
  if (!fn) throw new Error(`no worker for ${job.kind}`);
  return fn(job, signal, crew);
}
