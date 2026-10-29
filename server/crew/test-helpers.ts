// Owned by S12a. Shared by the crew tests: a board over a temp dir whose events are collected.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from '@shared/crew';
import { createBoard, type Board } from './board';
import { createCrewPersist, type CrewPersist } from './persist';

export interface TestBoard {
  board: Board;
  persist: CrewPersist;
  dir: string;
  filmId: string;
  /** Every job.update the board emitted, in order. */
  updates: Job[];
  /** Moves the board's clock. */
  advance(ms: number): void;
}

export function makeTestBoard(o: { filmId?: string; dir?: string; initial?: Job[] } = {}): TestBoard {
  const dir = o.dir ?? mkdtempSync(join(tmpdir(), 'crew-'));
  const filmId = o.filmId ?? 'film_aaaaaaaaaaaa';
  const persist = createCrewPersist(dir, filmId);
  const updates: Job[] = [];
  let t = Date.parse('2026-10-30T00:00:00Z');
  const board = createBoard({ filmId, emit: (e) => updates.push(e.job), persist: (jobs) => persist.saveBoard(jobs), now: () => t, initial: o.initial });
  return { board, persist, dir, filmId, updates, advance: (ms) => void (t += ms) };
}
