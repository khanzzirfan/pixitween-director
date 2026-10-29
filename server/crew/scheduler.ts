// Owned by S12a. Starts runnable jobs in the right order (design.md 5.1) and supersedes or cancels them with scene rollback (5.2).
import { JOB_PRIORITY, WRITING_KINDS, type Job } from '@shared/crew';
import type { FilmStore } from '@shared/ports';
import { TERMINAL, type Board, type NewJob } from './board';
import type { CrewPersist } from './persist';
import { restoreScene, snapshotScene, type SceneSnapshot } from './scene-snapshot';

export interface WorkerResult {
  summary?: string;
  costUsd?: number;
  version?: number;
  model?: string;
}

/** Decides whether a job may start. The producer's budget implements it. */
export interface JobGate {
  allows(job: Job): boolean;
  /** Called after a job ends, so a level change is announced. */
  check?(): void;
}

export interface SchedulerDeps {
  board: Board;
  maxWorkers: number;
  /** Runs one job. It must stop when `signal` aborts (before its next model turn or tool call). Throwing marks the job failed. */
  runWorker(job: Job, signal: AbortSignal): Promise<WorkerResult | void>;
  budget?: JobGate;
  /** Needed for scene snapshots and rollback. Without it writing jobs run unprotected. */
  films?: Pick<FilmStore, 'get' | 'mutate'>;
  persist?: Pick<CrewPersist, 'saveSnapshot'>;
  log?: (line: string) => void;
}

export interface Scheduler {
  /** Adds a job, applies the supersede rules, and starts what can start. Resolves once any rollback it triggered has finished. */
  dispatch(job: NewJob): Promise<Job>;
  /** Stops a job. A running writing job is rolled back to its snapshot before it leaves `running`. */
  cancel(jobId: string, opts?: { status?: 'cancelled' | 'superseded'; supersededBy?: string }): Promise<void>;
  pump(): void;
  /** Resolves when no worker is running. */
  idle(): Promise<void>;
  activeCount(): number;
}

interface Active {
  controller: AbortController;
  done: Promise<void>;
  cancelled: boolean;
}

const isWriting = (j: Pick<Job, 'kind'>) => WRITING_KINDS.includes(j.kind);
const sameScene = (a: Job, b: Job) => a.filmId === b.filmId && a.sceneId === b.sceneId;
const idNum = (id: string) => Number(/\d+/.exec(id)?.[0] ?? 0);

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const { board, maxWorkers } = deps;
  const log = deps.log ?? (() => undefined);
  const active = new Map<string, Active>();
  const snapshots = new Map<string, SceneSnapshot>();
  const idleWaiters: Array<() => void> = [];

  const live = (j: Job) => j.status === 'running' || j.status === 'awaiting-frames';

  function startable(job: Job, all: Job[]): boolean {
    if (job.dependsOn?.some((id) => board.get(id)?.status !== 'done')) return false;
    if (isWriting(job) && all.some((o) => o.id !== job.id && isWriting(o) && live(o) && sameScene(o, job))) return false;
    if (job.kind === 'critique' && all.some((o) => isWriting(o) && (o.status === 'queued' || live(o)) && sameScene(o, job))) return false;
    return true;
  }

  function pump(): void {
    for (;;) {
      if (active.size >= maxWorkers) return;
      const all = board.list();
      // a job that waits on one that can no longer finish will never run
      for (const j of all) {
        const dead = j.status === 'queued' ? j.dependsOn?.find((id) => TERMINAL.includes(board.get(id)?.status ?? 'queued') && board.get(id)?.status !== 'done') : undefined;
        if (dead) board.update(j.id, { status: 'cancelled', error: `waited on ${dead}, which did not finish` });
      }
      const next = all
        .filter((j) => board.get(j.id)?.status === 'queued')
        .sort((a, b) => JOB_PRIORITY(a) - JOB_PRIORITY(b) || a.createdAt.localeCompare(b.createdAt) || idNum(a.id) - idNum(b.id))
        .find((j) => startable(j, all));
      if (!next) return;
      if (deps.budget && !deps.budget.allows(next)) {
        board.update(next.id, { status: 'failed', error: 'budget' });
        deps.budget.check?.();
        continue;
      }
      start(next);
    }
  }

  function start(job: Job): void {
    const controller = new AbortController();
    const entry: Active = { controller, cancelled: false, done: Promise.resolve() };
    const slot = [...Array(maxWorkers).keys()].find((n) => ![...active.keys()].some((id) => board.get(id)?.worker === `w${n + 1}`)) ?? 0;
    const running = board.update(job.id, { status: 'running', worker: job.worker ?? `w${slot + 1}` });
    entry.done = (async () => {
      try {
        await takeSnapshot(running);
        if (controller.signal.aborted) return;
        const r = (await deps.runWorker(running, controller.signal)) ?? {};
        if (!entry.cancelled && live(board.get(job.id)!)) board.update(job.id, { ...r, status: 'done' });
      } catch (e) {
        if (!entry.cancelled && live(board.get(job.id)!)) {
          const message = e instanceof Error ? e.message : String(e);
          log(`[crew] ${job.id} failed: ${message}`);
          board.update(job.id, { status: 'failed', error: message.slice(0, 300) });
        }
      } finally {
        active.delete(job.id);
        deps.budget?.check?.();
        pump();
        if (!active.size) for (const w of idleWaiters.splice(0)) w();
      }
    })();
    active.set(job.id, entry);
  }

  async function takeSnapshot(job: Job): Promise<void> {
    if (!deps.films || !isWriting(job) || !job.sceneId) return;
    const comp = (await deps.films.get(job.filmId)).composition;
    if (!comp) return;
    try {
      const snap = snapshotScene(comp, job.sceneId);
      snapshots.set(job.id, snap);
      await deps.persist?.saveSnapshot(job.id, snap);
    } catch {
      // the scene is not in the composition yet (a first build): there is nothing to roll back to
    }
  }

  async function rollback(job: Job): Promise<void> {
    const snap = snapshots.get(job.id);
    if (!deps.films || !snap || !job.sceneId) return;
    const sceneId = job.sceneId;
    const r = await deps.films.mutate(job.filmId, (film) => ({ next: restoreScene(film.composition!, sceneId, snap), data: undefined }), 'director', `rollback ${job.id}`);
    if (!r.ok) log(`[crew] rollback of ${job.id} was refused`);
  }

  async function cancel(jobId: string, opts: { status?: 'cancelled' | 'superseded'; supersededBy?: string } = {}): Promise<void> {
    const job = board.get(jobId);
    if (!job || TERMINAL.includes(job.status)) return;
    const status = opts.status ?? 'cancelled';
    const patch = { status, ...(opts.supersededBy ? { supersededBy: opts.supersededBy } : {}) } as const;
    const entry = active.get(jobId);
    if (job.status === 'queued' || !entry) {
      board.update(jobId, patch);
      return;
    }
    entry.cancelled = true;
    entry.controller.abort();
    await entry.done; // the worker stops before its next model turn or tool call
    if (isWriting(job)) await rollback(job);
    board.update(jobId, patch);
    pump();
  }

  async function dispatch(input: NewJob): Promise<Job> {
    const job = board.add(input);
    const pending: Array<Promise<void>> = [];
    if (isWriting(job) && job.sceneId) {
      for (const o of board.list()) {
        if (o.id === job.id || !sameScene(o, job)) continue;
        if (isWriting(o) && o.status === 'queued') pending.push(cancel(o.id, { status: 'superseded', supersededBy: job.id }));
        else if (o.kind === 'critique' && (o.status === 'queued' || o.status === 'awaiting-frames')) pending.push(cancel(o.id));
      }
      const running = board.list().find((o) => o.id !== job.id && isWriting(o) && live(o) && sameScene(o, job));
      const replaces = job.origin === 'user' || ['rebuild-scene', 'restyle-scene', 'revert'].includes(job.kind);
      if (running && replaces) pending.push(cancel(running.id, { status: 'superseded', supersededBy: job.id }));
    }
    await Promise.all(pending);
    pump();
    return board.get(job.id)!;
  }

  return {
    dispatch,
    cancel,
    pump,
    idle: () => (active.size ? new Promise<void>((r) => idleWaiters.push(r)) : Promise.resolve()),
    activeCount: () => active.size,
  };
}
