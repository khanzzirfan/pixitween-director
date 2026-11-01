// Owned by S14. The five steps of a film and where a film's status puts it.
import type { ShellStep } from './StudioShell';

export const STEPS: ShellStep[] = [
  { label: 'Brief', tab: 'new' },
  { label: 'Plan', tab: 'plan' },
  { label: 'Build', tab: 'plan' },
  { label: 'Review', tab: 'review' },
  { label: 'Export', tab: 'export' },
];

/** Index of the step a film is on; 0 when there is no film or it has no status yet. */
export function stepFor(status: string | undefined): number {
  switch (status) {
    case 'planning':
      return 1;
    case 'building':
    case 'failed':
      return 2;
    case 'reviewing':
      return 3;
    case 'ready':
      return 4;
    default:
      return 0;
  }
}
