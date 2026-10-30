// The crew's film clock: a hard limit split into phases, scaled from the 180 s plan (plan 25, build 110, polish 160, wrap 180).
// The scheduler and the graph read it; nothing in the prompts enforces time.
import type { JobKind } from '@shared/crew';

export type Phase = 'plan' | 'build' | 'polish' | 'wrap';

/** Where each phase ends, as a share of the film deadline. */
const END: Record<Exclude<Phase, 'wrap'>, number> = { plan: 25 / 180, build: 110 / 180, polish: 160 / 180 };
/** A build job aborts after this share of the deadline; a build that starts in the polish phase gets the shorter late share. */
const BUILD_JOB = 80 / 180;
const LATE_BUILD_JOB = 45 / 180;
/** After this share, a rebuild or restyle becomes an edit. After the late share, only checks and edits start. */
const NOTE_EDIT_ONLY = 60 / 180;
const NOTE_REFUSED = 150 / 180;

export interface Deadline {
  totalMs: number;
  phase(): Phase;
  elapsedMs(): number;
  remainingMs(): number;
  /** Ms from now until the phase ends (0 once it has). */
  untilEndOf(phase: Phase): number;
  /** The kind a dispatch becomes at this point, or undefined when it is refused. */
  kindFor(kind: JobKind): JobKind | undefined;
  /** Whether a queued job may start in the current phase. */
  mayStart(kind: JobKind): boolean;
  /** How long a job that starts now may run, in ms. */
  jobBudgetMs(kind: JobKind): number;
}

const BUILD_KINDS: readonly JobKind[] = ['build-scene', 'rebuild-scene', 'restyle-scene'];

export function createDeadline(totalMs: number, now: () => number = Date.now): Deadline {
  const t0 = now();
  const elapsedMs = () => now() - t0;
  const endMs = (p: Phase) => (p === 'wrap' ? totalMs : Math.round(END[p] * totalMs));
  const phase = (): Phase => (elapsedMs() < endMs('plan') ? 'plan' : elapsedMs() < endMs('build') ? 'build' : elapsedMs() < endMs('polish') ? 'polish' : 'wrap');
  const untilEndOf = (p: Phase) => Math.max(0, endMs(p) - elapsedMs());

  return {
    totalMs,
    phase,
    elapsedMs,
    remainingMs: () => Math.max(0, totalMs - elapsedMs()),
    untilEndOf,
    kindFor(kind) {
      const e = elapsedMs();
      if (e >= NOTE_REFUSED * totalMs) return kind === 'critique' || kind === 'continuity' || kind === 'revert' ? kind : undefined;
      // late notes never rebuild: they become an edit of the named scene
      if (e >= NOTE_EDIT_ONLY * totalMs && (kind === 'rebuild-scene' || kind === 'restyle-scene')) return 'edit';
      return kind;
    },
    mayStart(kind) {
      const p = phase();
      if (p === 'wrap') return false;
      if (p === 'polish') return !['rebuild-scene', 'restyle-scene', 'take'].includes(kind);
      return true;
    },
    jobBudgetMs(kind) {
      const left = untilEndOf('polish');
      if (!BUILD_KINDS.includes(kind)) return left;
      return Math.min(left, (phase() === 'polish' ? LATE_BUILD_JOB : BUILD_JOB) * totalMs);
    },
  };
}
