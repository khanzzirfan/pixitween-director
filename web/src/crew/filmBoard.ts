// What a crew film puts on the board: its product, its brief, its shots with live status, and who is busy.
import type { FilmState } from '@shared/composition';
import type { Job } from '@shared/crew';
import type { BoardShot, BoardState, StudioBoardProps } from '../shell/StudioBoard';
import type { CrewState } from './crewReducer';
import { ringFor, type RingState } from './SceneCard';

const STATE: Record<RingState, BoardState> = { queued: 'waiting', building: 'working', reviewing: 'working', done: 'done', failed: 'failed' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');

export function filmBoard(film: FilmState | null, crew: CrewState, story: string): Omit<StudioBoardProps, 'onPoint'> {
  const jobs: Job[] = Object.values(crew.jobs);
  const scenes = crew.storyboard?.scenes ?? film?.storyboard?.scenes ?? [];
  const shots: BoardShot[] = scenes.map((s) => ({ id: s.id, title: s.text || s.intent, state: STATE[ringFor(jobs, s.id)] }));
  const crewLines = Object.entries(crew.lanes)
    .filter(([, l]) => l.state !== 'idle')
    .map(([key, l]) => {
      const job = l.jobId ? crew.jobs[l.jobId] : undefined;
      const on = job?.sceneId ? ` on ${job.sceneId}` : '';
      return `${cap(key)} ${l.state}${on}${l.note ? ` · ${l.note}` : ''}`;
    });
  return {
    products: film ? [{ id: film.brief?.productAssetId || 'product', title: film.title || 'Your product' }] : [],
    story,
    shots,
    crew: crewLines,
  };
}
