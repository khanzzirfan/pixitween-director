// Owned by S12c. Which worker runs which kind of job. The default for runCrew.
import type { JobKind } from '@shared/crew';
import { runContinuityJob } from '../continuity';
import { createTakes } from '../takes';
import { createFixtureForge } from '../../cartoon/fixture-forge';
import { loadEnv } from '../../env';
import { runBlockJob } from '../../cartoon/blocking';
import { runCriticJob, type CriticOptions } from './critic';
import { runBuilderJob, type BuilderOptions } from './builder';
import type { WorkerFn } from '../workers';

const forgeMissing: WorkerFn = async (job) => {
  throw new Error(`${job.kind}: the forge is not available yet (S16a)`);
};

export type WorkerMap = Record<JobKind, WorkerFn>;

/** Every job kind has a worker. `takes` is given when a session needs its own take memory (the pick uses it). */
export function createWorkerRegistry(o: { takes?: ReturnType<typeof createTakes>; builder?: BuilderOptions; critic?: CriticOptions } = {}): WorkerMap {
  const takes = o.takes ?? createTakes({ ...(o.builder ? { builderOptions: o.builder } : {}) });
  // the plain functions when nothing is overridden, so the mapping is easy to see and to test
  const builder: WorkerFn = o.builder ? (job, signal, crew) => runBuilderJob(job, signal, crew, o.builder) : runBuilderJob;
  const critic: WorkerFn = o.critic ? (job, signal, crew) => runCriticJob(job, signal, crew, o.critic) : runCriticJob;
  const blocker: WorkerFn = o.builder ? (job, signal, crew) => runBlockJob(job, signal, crew, o.builder) : runBlockJob;
  return {
    'build-scene': builder,
    'rebuild-scene': builder,
    'restyle-scene': builder,
    edit: builder,
    fix: builder,
    revert: builder,
    critique: critic,
    continuity: runContinuityJob,
    take: takes.start,
    'block-shot': blocker,
    // until the forge (S16a) is built the cast, props, set and motions come from the fixture models
    ...(loadEnv().CARTOON_MODE ? createFixtureForge({ paint: loadEnv().CARTOON_PAINT }) : { 'cast-character': forgeMissing, 'make-prop': forgeMissing, 'make-set': forgeMissing, 'make-motion': forgeMissing }),
  };
}
