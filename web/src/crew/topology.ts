// Owned by S12d. Which agent handed work to which, read off one event. Pure, so a replay draws the same links as a live run.
import type { Job } from '@shared/crew';
import type { FilmEvent } from '@shared/events';

export type LinkKind = 'message' | 'edit' | 'dispatch' | 'result' | 'stopped' | 'finding' | 'reply';
export interface LinkSpec {
  from: string;
  to: string;
  kind: LinkKind;
  label?: string;
}

/** The map node of the agent that runs a job. */
export function nodeForJob(job: Pick<Job, 'kind' | 'worker'>): string {
  if (job.kind === 'critique') return 'critic';
  if (job.kind === 'continuity') return 'continuity';
  if (job.worker === 'local') return 'local';
  return `builder:${job.worker ?? 'builder'}`;
}

export function linkFor(e: FilmEvent): LinkSpec | null {
  switch (e.type) {
    case 'showrunner.heard':
      return e.from === 'user' ? { from: 'you', to: 'showrunner', kind: 'message' } : null;
    case 'storyboard.revised':
      return e.source === 'user' ? { from: 'you', to: 'showrunner', kind: 'edit' } : null;
    case 'job.update': {
      const node = nodeForJob(e.job);
      const what = `${e.job.kind}${e.job.sceneId ? ` ${e.job.sceneId}` : ''}`;
      if (e.job.status === 'running') return { from: 'showrunner', to: node, kind: 'dispatch', label: what };
      if (e.job.status === 'done') return { from: node, to: 'showrunner', kind: 'result', label: what };
      if (e.job.status === 'failed' || e.job.status === 'cancelled' || e.job.status === 'superseded') return { from: node, to: 'showrunner', kind: 'stopped', label: what };
      return null;
    }
    case 'review.finding':
      return { from: e.deterministic ? 'continuity' : 'critic', to: 'showrunner', kind: 'finding', label: e.kind };
    case 'showrunner.say':
      return { from: 'showrunner', to: 'you', kind: 'reply' };
    default:
      return null;
  }
}
