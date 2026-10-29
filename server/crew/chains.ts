// Owned by S12b. What happens on its own when a job ends (design.md 5.5): a finished writer is checked and critiqued,
// and its outcome goes to the showrunner's inbox, so the showrunner spends turns on decisions, not bookkeeping.
import { WRITING_KINDS, type Job } from '@shared/crew';
import type { Board } from './board';
import type { Inbox } from './inbox';
import type { Scheduler } from './scheduler';

/** A scene is critiqued automatically this many times per session. A finding that survives that many rounds is the showrunner's to judge. */
export const MAX_AUTO_CRITIQUES = 3;

export interface ChainDeps {
  board(): Board;
  scheduler(): Scheduler;
  inbox: Inbox;
  /** Called when a chained dispatch throws. */
  onError?(e: unknown): void;
  newId?(): string;
}

const describe = (job: Job): string => {
  const what = `${job.kind}${job.sceneId ? ` ${job.sceneId}` : ''}`;
  return job.status === 'failed' ? `${what} failed: ${job.error ?? 'unknown error'}` : `${what} done${job.summary ? `: ${job.summary}` : ''}`;
};

/** Returns the function to call with every job.update. It acts once per job per status. */
export function createJobChains(deps: ChainDeps): (job: Job) => void {
  const seen = new Set<string>();
  const critiques = new Map<string, number>();
  let n = 0;
  const id = deps.newId ?? (() => `inbox-${++n}`);

  return (job) => {
    const key = `${job.id}:${job.status}`;
    if (seen.has(key) || (job.status !== 'done' && job.status !== 'failed')) return;
    seen.add(key);

    const isChecker = job.kind === 'critique' || job.kind === 'continuity';
    // a check that finished says its findings itself; only its failure is news
    if (!isChecker || job.status === 'failed') {
      deps.inbox.push({ id: id(), at: new Date().toISOString(), from: 'job', jobId: job.id, text: describe(job) });
    }
    if (job.status !== 'done' || !WRITING_KINDS.includes(job.kind) || !job.sceneId) return;

    const sceneId = job.sceneId;
    // off the call stack: this runs inside the board's own update
    void Promise.resolve()
      .then(async () => {
        await deps.scheduler().dispatch({ kind: 'continuity', sceneId, origin: 'auto', brief: `check continuity after ${job.id}`, reason: `after ${job.kind} on ${sceneId}`, filmId: job.filmId });
        const rounds = critiques.get(sceneId) ?? 0;
        if (rounds < MAX_AUTO_CRITIQUES && !deps.board().list().some((j) => j.kind === 'critique' && j.sceneId === sceneId && j.status === 'queued')) {
          critiques.set(sceneId, rounds + 1);
          await deps.scheduler().dispatch({ kind: 'critique', sceneId, origin: 'auto', brief: `review the frames of ${sceneId}`, reason: `after ${job.kind} on ${sceneId}`, filmId: job.filmId });
        }
      })
      .catch((e: unknown) => deps.onError?.(e));
  };
}
