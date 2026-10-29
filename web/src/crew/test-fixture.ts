// Owned by S12d. The recorded crew events the panels are built and tested against (fixtures/s12d/crew-midbuild.json).
import type { FilmEvent } from '@shared/events';
import raw from '../../../fixtures/s12d/crew-midbuild.json';

export const FIXTURE = raw.events as unknown as FilmEvent[];
/** fourBuilds: the first 19 events end with four builders working. afterUserMessage: one event past it, the user's message. */
export const MARKS = raw.marks;
export const upTo = (n: number) => FIXTURE.slice(0, n);
