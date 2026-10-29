// Owned by S12b. The crew's entry point (design.md 3.1): one session per film wires the board, scheduler, budget, inbox and showrunner together.
import type { InboxItem } from '@shared/crew';
import type { FilmEvent } from '@shared/events';
import type { LlmBackend } from '@shared/ports';
import { loadEnv } from '../env';
import { pickBackend } from '../llm/router';
import { resizeFit } from '../media/image';
import type { AppDeps } from '../http/deps';
import { isFakeDirector } from '../agent/fake-director';
import { createBoard, TERMINAL } from './board';
import { createBudget } from './budget';
import { createJobChains } from './chains';
import { createFakeCrew } from './fake-showrunner';
import { createId } from './ids';
import { createInbox, type Inbox } from './inbox';
import { createCrewPersist } from './persist';
import { createScheduler, type Scheduler } from './scheduler';
import { createShowrunner } from './showrunner';
import { newTurn, type CrewCtx } from './showrunner-tools';
import { runRegisteredWorker } from './workers';

export interface CrewSession {
  filmId: string;
  crew: CrewCtx;
  scheduler: Scheduler;
  /** Adds an item to the showrunner's inbox. */
  push(item: Omit<InboxItem, 'id' | 'at'> & Partial<Pick<InboxItem, 'id' | 'at'>>): InboxItem;
  /** Resolves when the session has ended. Never rejects. */
  done: Promise<void>;
  stop(): void;
}

export interface CrewOptions {
  /** The showrunner's model. Tests and the offline run supply a scripted one. */
  backend?: LlmBackend;
  model?: string;
  /** Overrides CREW_IDLE_END_MS. */
  idleEndMs?: number;
  /** Pause per fake job and turn when DIRECTOR_FAKE=1. */
  fakeDelayMs?: number;
}

export function createCrew(deps: AppDeps, o: CrewOptions = {}) {
  const sessions = new Map<string, CrewSession>();

  async function start(filmId: string, opts: { resume?: boolean } = {}): Promise<CrewSession> {
    const existing = sessions.get(filmId);
    if (existing) return existing;

    const env = loadEnv();
    const toolCtx = deps.makeToolCtx(filmId);
    const film = await deps.films.get(filmId);
    const persist = createCrewPersist(deps.dataDir ?? env.DATA_DIR, filmId);
    const events: FilmEvent[] = [];
    const unsubscribe = deps.bus.subscribe(filmId, (env2) => events.push(env2.event));

    const inbox: Inbox = createInbox({ debounceMs: env.CREW_INBOX_DEBOUNCE_MS });
    const push: CrewSession['push'] = (item) => {
      const full: InboxItem = { id: createId('i'), at: new Date().toISOString(), ...item };
      inbox.push(full);
      return full;
    };

    const fake = isFakeDirector() ? createFakeCrew({ delayMs: o.fakeDelayMs }) : undefined;
    // assigned once below, but the callbacks created first read them
    // eslint-disable-next-line prefer-const
    let crew!: CrewCtx;
    // eslint-disable-next-line prefer-const
    let board!: ReturnType<typeof createBoard>;
    const chains = createJobChains({
      board: () => board,
      scheduler: () => crew.scheduler,
      inbox,
      onError: (e) => toolCtx.emit({ type: 'error', where: 'crew.chain', message: e instanceof Error ? e.message : String(e) }),
    });
    board = createBoard({
      filmId,
      initial: opts.resume ? await persist.loadBoard() : [],
      emit: (e) => {
        toolCtx.emit(e);
        chains(e.job);
      },
      persist: (jobs) => persist.saveBoard(jobs),
    });
    const budget = createBudget({
      ledger: deps.ledger,
      filmId,
      childFilmIds: () => children,
      capUsd: env.CREW_FILM_BUDGET_USD,
      emit: (e) => toolCtx.emit(e),
      onLevel: (level, spent) => {
        if (level !== 'ok') push({ from: 'producer', text: `Budget ${level}: $${spent.toFixed(2)} of $${env.CREW_FILM_BUDGET_USD.toFixed(2)} spent.${level === 'warn' ? ' Prefer restyle and edit to rebuilds, and no takes.' : ' New jobs are refused.'}` });
      },
    });
    let children: string[] = [];
    void deps.films.list().then((all) => (children = all.filter((f) => f.parentId === filmId).map((f) => f.id))).catch(() => undefined);

    const scheduler = createScheduler({
      board,
      maxWorkers: env.CREW_MAX_WORKERS,
      runWorker: (job, signal) => (fake?.workers[job.kind] ?? ((j, sg, c) => runRegisteredWorker(j, sg, c)))(job, signal, crew),
      budget,
      films: deps.films,
      persist,
      log: (line) => console.log(line),
    });
    crew = { filmId, films: deps.films, board, scheduler, budget, inbox, emit: toolCtx.emit, source: 'showrunner', takesMax: env.CREW_TAKES_MAX, removedIds: new Set(), toolCtx, turn: newTurn() };

    const model = o.model ?? env.SHOWRUNNER_MODEL;
    const backend = o.backend ?? fake?.backend ?? pickBackend('showrunner', { onFallback: (i) => toolCtx.emit({ type: 'error', where: 'showrunner', message: `${i.from} unavailable (${i.reason}); this turn used ${i.to}` }) });
    let productImageUrl: string | undefined;
    try {
      productImageUrl = `data:image/jpeg;base64,${(await resizeFit(await deps.assets.read(film.brief.productAssetId), 768, 'jpeg')).toString('base64')}`;
    } catch {
      // the photo is optional context; the brief still says what the product is
    }
    const showrunner = createShowrunner({ crew, backend, model, productImageUrl, events: () => events, idleEndMs: o.idleEndMs ?? env.CREW_IDLE_END_MS });

    const ac = new AbortController();
    const status = async (value: 'planning' | 'building' | 'ready' | 'failed') => {
      await deps.films.update(filmId, { status: value });
      toolCtx.emit({ type: 'film.status', status: value });
    };

    const done = (async () => {
      try {
        if (!opts.resume) {
          await status('planning');
          push({ from: 'system', text: `New film. Brief: ${film.brief.text} Aspect ${film.aspect}.`, data: { brief: film.brief.text, aspect: film.aspect } });
        }
        await showrunner.run(ac.signal);
        // the session ended without a finish: keep what exists
        const now = await deps.films.get(filmId);
        if (now.status !== 'ready' && now.status !== 'failed') await status(now.composition ? 'ready' : 'failed');
      } catch (e) {
        toolCtx.emit({ type: 'error', where: 'showrunner', message: e instanceof Error ? e.message : String(e) });
        try {
          await status('failed');
        } catch {
          // keep the original failure
        }
      } finally {
        unsubscribe();
        inbox.close();
        ac.abort();
        for (const j of board.list()) if (!TERMINAL.includes(j.status)) await scheduler.cancel(j.id).catch(() => undefined);
        sessions.delete(filmId);
      }
    })();

    const session: CrewSession = { filmId, crew, scheduler, push, done, stop: () => ac.abort() };
    sessions.set(filmId, session);
    return session;
  }

  return {
    start,
    get: (filmId: string) => sessions.get(filmId),
    /** Runs a new film to the end of its session. Never rejects: a failure becomes status failed and an error event. */
    async runCrew(filmId: string): Promise<void> {
      try {
        await (await start(filmId)).done;
      } catch (e) {
        try {
          deps.makeToolCtx(filmId).emit({ type: 'error', where: 'showrunner', message: e instanceof Error ? e.message : String(e) });
          await deps.films.update(filmId, { status: 'failed' });
        } catch {
          // nothing more can be done
        }
      }
    },
  };
}

let bound: ReturnType<typeof createCrew> | undefined;
let boundDeps: AppDeps | undefined;

/** Binds the crew to the app's deps. Binding the same deps again keeps the running sessions. */
export function bindCrew(deps: AppDeps, o?: CrewOptions): void {
  if (bound && boundDeps === deps && !o) return;
  bound = createCrew(deps, o);
  boundDeps = deps;
}

export const getCrewSession = (filmId: string): CrewSession | undefined => bound?.get(filmId);

/** The session of a film, started if there is none (a chat message after the session went idle or the server restarted). */
export async function ensureCrewSession(filmId: string): Promise<CrewSession> {
  if (!bound) throw new Error('crew not bound');
  return bound.get(filmId) ?? bound.start(filmId, { resume: true });
}

export async function runCrew(filmId: string): Promise<void> {
  if (!bound) throw new Error('crew not bound');
  return bound.runCrew(filmId);
}

/** Sends a user message to a crew film's showrunner. `showrunner.heard` goes out first, so the UI shows it before any model call. */
export async function directShowrunner(deps: AppDeps, filmId: string, text: string, selection?: InboxItem['selection']): Promise<string> {
  const session = await ensureCrewSession(filmId);
  const inboxId = createId('i');
  deps.makeToolCtx(filmId).emit({ type: 'showrunner.heard', inboxId, from: 'user', text });
  session.push({ id: inboxId, from: 'user', text, ...(selection ? { selection } : {}) });
  return inboxId;
}
