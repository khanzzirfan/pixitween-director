// Owned by S12a. Shared by the crew tests: a board over a temp dir whose events are collected.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from '@shared/crew';
import type { WorkerResult } from './scheduler';
import { createBoard, type Board } from './board';
import { createBudget } from './budget';
import { createInbox } from './inbox';
import { createScheduler } from './scheduler';
import { newTurn, type CrewCtx } from './showrunner-tools';
import { makeTestFilm } from '../test-utils/film';
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

/**
 * A CrewCtx over a real temp-dir film, with a scheduler whose workers are `runWorker` (default: finish at once).
 * `events` holds every event the ctx emitted, in order.
 */
export async function makeTestCrew(o: { runWorker?: (job: Job, signal: AbortSignal) => Promise<WorkerResult | void>; capUsd?: number; maxWorkers?: number; debounceMs?: number } = {}) {
  const film = await makeTestFilm();
  const t = makeTestBoard({ filmId: film.filmId, dir: film.dir });
  const budget = createBudget({ ledger: film.ledger, filmId: film.filmId, childFilmIds: () => [], capUsd: o.capUsd ?? 1.5, emit: (e) => film.ctx.emit(e) });
  const scheduler = createScheduler({ board: t.board, maxWorkers: o.maxWorkers ?? 4, runWorker: o.runWorker ?? (async () => ({ summary: 'ok' })), budget, films: film.films, persist: t.persist });
  const inbox = createInbox({ debounceMs: o.debounceMs ?? 0 });
  const crew: CrewCtx = {
    filmId: film.filmId, films: film.films, board: t.board, scheduler, budget, inbox,
    emit: film.ctx.emit, source: 'showrunner', takesMax: 3, removedIds: new Set(), toolCtx: film.ctx, turn: newTurn(),
  };
  return { crew, film, board: t.board, scheduler, inbox, budget, events: film.events };
}
