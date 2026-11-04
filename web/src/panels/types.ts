import type { FilmState } from '@shared/composition';
import type { FilmEvent } from '@shared/events';

/** Every panel receives the open film and its events, so panels never fetch the film themselves. */
export interface PanelProps {
  film: FilmState | null;
  events: FilmEvent[];
}
