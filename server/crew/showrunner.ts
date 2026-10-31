// Owned by S12b. The showrunner's loop (design.md 3.1 and 5.6): wake on the inbox, take one turn, act through the board tools.
// The turn machinery. The loop itself is the LangGraph engine (server/crew/engine/showrunner-graph.ts).
import { blockers } from '../cartoon/cast';
import { sceneHasStage } from '../cartoon/checks';
import type { FilmState } from '@shared/composition';
import type { Comp } from '../authoring/types';
import { createCartoonTools } from '../cartoon/showrunner-tools';
import { loadEnv } from '../env';
import type { InboxItem } from '@shared/crew';
import type { FilmEvent } from '@shared/events';
import type { ChatMessage, LlmBackend, ToolCall } from '@shared/ports';
import type { ToolDef } from '@shared/tools';
import { assistantMessageFrom, toolResultMessage } from '../llm/messages';
import { priceSpark } from '../pricing';
import type { Registry } from '../tools/registry';
import { compact, directorRequests, renderTurn, storySoFar, type Finding } from './history';
import { showrunnerSystem } from './prompts';
import { createBoardTools, finishFilm, finishGate, newTurn, type CrewCtx } from './showrunner-tools';
import { createId } from './ids';
import { TERMINAL } from './board';
import type { Deadline } from './deadline';

export interface ShowrunnerDeps {
  crew: CrewCtx;
  backend: LlmBackend;
  /** The model name the ledger prices the turns at (SHOWRUNNER_MODEL). */
  model: string;
  /** The product photo as a data URL. Sent only with the first turn. */
  productImageUrl?: string;
  tools?: ToolDef[];
  /** Open findings for the board table. */
  findings?: () => Finding[];
  /** The film's events so far, for the STORY SO FAR paragraph. */
  events?: () => FilmEvent[];
  /** How long to wait with an empty inbox before the session ends (CREW_IDLE_END_MS). */
  idleEndMs?: number;
  /** The film clock. Past the polish phase the showrunner takes no more turns. */
  deadline?: Deadline;
  /** A guard against a runaway loop. */
  maxTurns?: number;
  /** The S12f done nudge and auto-finish. Default true; tests can turn it off. */
  wrapUp?: boolean;
}

export const REPAIR = 'Every tool call in your last turn failed. Read the errors, fix the arguments and call the tools again.';
export const REPAIR_STALLED = 'Some tool calls in your last turn failed and no job is running, so nothing will wake you. Read the errors, fix the arguments and call those tools again.';
export const REPAIR_PLAN = 'Some of your planning calls failed (the storyboard or a dispatch), so the film is not what you meant. Read the errors, fix the arguments and call those tools again.';
export const PLAN_NUDGE = 'You have not planned any scenes yet. Call reviseStoryboard with the scenes, then dispatch a builder for each.';
export const BUILD_NUDGE = 'The storyboard has scenes but nothing is built and no job is running. Dispatch a builder for each scene.';
export const CAST_NUDGE = 'The scenes are planned but nothing is cast or dressed yet, and nothing will wake you. In one turn call castCharacter for every character, dressSet once per place, and requestMotion for every clip the cues use.';
export const BLOCK_NUDGE = 'The cast is ready but some scenes are not staged yet. Call blockShot for each scene that is not blocked.';
export const DONE_NUDGE = 'Everything is built and checked. Call finish with a one-line summary now, unless a director\'s request is not done yet.';
export const WRAPPING = 'Wrapping up: everything is built.';

export interface IdleProgress {
  nudged: boolean;
  idleTurns: number;
}

/** 'plan': nothing is planned or built and nothing runs, so the director is prompted to plan. 'fail': it was prompted twice already. */
export type IdleAction = 'none' | 'nudge' | 'finish' | 'plan' | 'fail';

/** Prompts for an idle crew that has not planned or built anything, before the session would sit out CREW_IDLE_END_MS. */
export const MAX_PLAN_NUDGES = 2;

/**
 * Decides what an idle board needs: nothing, the one done nudge, or auto-finish after two idle turns (S12f 3.7).
 * Reads the board and the gate, changes nothing. The graph routes on the action; the native loop calls idleFinishStep.
 */
export async function idleDecision(
  crew: CrewCtx,
  progress: IdleProgress,
  o: { autoFinish: boolean; hadUser: boolean; finished: boolean },
): Promise<IdleProgress & { finished: boolean; action: IdleAction }> {
  if (o.finished) return { ...progress, finished: true, action: 'none' };
  const open = crew.board.list().some((j) => !TERMINAL.includes(j.status));
  const turn = o.hadUser ? { nudged: false, idleTurns: 0 } : progress;
  if (open) return { nudged: false, idleTurns: 0, finished: false, action: 'none' };
  const film = await crew.films.get(crew.filmId);
  // An idle crew with nothing planned or built has nothing to wrap up, and nothing would wake it. Prompt it to plan, twice,
  // then fail fast instead of waiting out the idle end.
  if (!film.composition || !film.storyboard?.scenes.length || cartoonNeed(film)) {
    const attempts = turn.idleTurns + 1;
    if (attempts > MAX_PLAN_NUDGES) return { nudged: false, idleTurns: attempts, finished: false, action: 'fail' };
    return { nudged: false, idleTurns: attempts, finished: false, action: 'plan' };
  }
  const gate = await finishGate(crew, crew.toolCtx);
  if (!gate.pass) return { nudged: false, idleTurns: 0, finished: false, action: 'none' };
  if (!turn.nudged) return { nudged: true, idleTurns: 0, finished: false, action: 'nudge' };
  // Each director turn after the nudge that ends without finishing counts as an idle turn. With auto-finish on, the
  // director is prompted again after each one, so the second makes the film finish itself. Without a new batch, nothing
  // would wake the loop again (the board is terminal), so the counter could never reach two.
  const idleTurns = turn.idleTurns + 1;
  if (!o.autoFinish) return { nudged: true, idleTurns, finished: false, action: 'none' };
  if (idleTurns < 2) return { nudged: true, idleTurns, finished: false, action: 'nudge' };
  return { nudged: true, idleTurns, finished: false, action: 'finish' };
}

/** What a toy-studio film still needs from the director when nothing runs: its cast, or its shots. Undefined when it is not a cartoon or has both. */
export function cartoonNeed(film: FilmState): 'cast' | 'block' | undefined {
  if (!loadEnv().CARTOON_MODE || !film.storyboard?.scenes.length) return undefined;
  const cast = film.cast ?? [];
  if (!cast.some((m) => m.kind === 'character') || !cast.some((m) => m.kind === 'set')) return 'cast';
  const comp = film.composition as Comp | undefined;
  return film.storyboard.scenes.some((s) => !comp || !sceneHasStage(comp, s.id)) ? 'block' : undefined;
}

/** The nudge text for an idle crew that needs to plan, cast or block. */
export function planNudgeText(film: FilmState): string {
  if (!film.storyboard?.scenes.length) return PLAN_NUDGE;
  const need = cartoonNeed(film);
  return need === 'cast' ? CAST_NUDGE : need === 'block' ? BLOCK_NUDGE : BUILD_NUDGE;
}

/** The done nudge: one system item in the inbox. */
export function pushDoneNudge(crew: CrewCtx): void {
  crew.inbox.push({ id: createId('i'), at: new Date().toISOString(), from: 'system', text: DONE_NUDGE });
}

/** Auto-finish. Returns false when the gate refuses, so the caller keeps the session going. */
export async function autoFinish(crew: CrewCtx): Promise<boolean> {
  const film = await crew.films.get(crew.filmId);
  const r = await finishFilm(crew, crew.toolCtx, `${film.storyboard?.scenes.length ?? 0} scenes built and checked`);
  if (!r.ok) return false;
  crew.emit({ type: 'showrunner.say', kind: 'note', text: WRAPPING });
  return true;
}

/** Dispatches an 'auto' job for every scene that needs a builder and got none from the showrunner this turn (design 5.4). */
export async function autoDispatch(crew: CrewCtx, origin: 'auto' | 'user' = 'auto'): Promise<string[]> {
  const film = await crew.films.get(crew.filmId);
  const made: string[] = [];
  // a toy-studio shot is blocked, not built: it starts as soon as its cast, set and motions are ready, otherwise the showrunner is woken when they finish and calls blockShot
  if (loadEnv().CARTOON_MODE) {
    for (const id of crew.turn.needsBuilder) {
      if (crew.turn.dispatched.has(id) || blockers(film, id).length) continue;
      const scene = film.storyboard?.scenes.find((s) => s.id === id);
      if (scene) made.push((await crew.scheduler.dispatch({ kind: 'block-shot', sceneId: id, origin, brief: scene.beats ?? scene.intent, reason: 'the cast is ready' })).id);
    }
    return made;
  }
  for (const id of crew.turn.needsBuilder) {
    if (crew.turn.dispatched.has(id)) continue;
    const scene = film.storyboard?.scenes.find((s) => s.id === id);
    if (!scene) continue;
    const built = crew.board.list().some((j) => j.sceneId === id && j.status === 'done' && j.kind !== 'critique' && j.kind !== 'continuity');
    const job = await crew.scheduler.dispatch({ kind: built ? 'rebuild-scene' : 'build-scene', sceneId: id, origin, brief: scene.intent, reason: built ? 'the scene changed' : 'new scene' });
    made.push(job.id);
  }
  return made;
}

export interface ShowrunnerSnapshot {
  messages?: ChatMessage[];
  turns?: number;
  finished?: boolean;
  sentImage?: boolean;
}

export interface TurnResult {
  allFailed: boolean;
  anyFailed: boolean;
  /** A planning call (storyboard, dispatch, proposeGenerate) failed, so the film may not match what the director meant. */
  planFailed: boolean;
}

const PLAN_TOOLS = new Set(['reviseStoryboard', 'dispatch', 'proposeGenerate']);

export interface ShowrunnerAgent {
  history(): ChatMessage[];
  turns(): number;
  sentImage(): boolean;
  isFinished(): boolean;
  setFinished(value: boolean): void;
  agent(state: 'thinking' | 'idle'): void;
  resetTurn(hadUser: boolean): void;
  restoreTurn(hadUser: boolean, needsBuilder: readonly string[], dispatched: readonly string[]): void;
  view(items: InboxItem[]): Promise<string>;
  /** Adds the product photo to the first turn only. */
  compose(text: string): ChatMessage['content'];
  turn(content: ChatMessage['content'], signal: AbortSignal): Promise<TurnResult>;
  /** Waits for the next batch, or for the end of the session. Undefined means stop. */
  next(signal: AbortSignal): Promise<InboxItem[] | undefined>;
}

export function createShowrunnerAgent(deps: ShowrunnerDeps, snapshot: ShowrunnerSnapshot = {}): ShowrunnerAgent {
  const { crew, backend } = deps;
  const tools = deps.tools ?? [...createBoardTools(crew), ...(loadEnv().CARTOON_MODE ? createCartoonTools(crew) : [])];
  // loaded on first use: the registry pulls in every tool module, which a route registration does not need
  let registry: Registry | undefined;
  const getRegistry = async (): Promise<Registry> => (registry ??= (await import('../tools/registry')).createRegistry([tools]));
  const history: ChatMessage[] = snapshot.messages?.length ? [...snapshot.messages] : [{ role: 'system', content: showrunnerSystem() }];
  let turns = snapshot.turns ?? 0;
  let sentImage = snapshot.sentImage ?? false;
  let finished = snapshot.finished ?? false;

  const agent = (state: 'thinking' | 'idle') => crew.emit({ type: 'crew.agent', lane: 'showrunner', worker: 'showrunner', state, model: deps.model });

  async function view(items: InboxItem[]): Promise<string> {
    const film = await crew.films.get(crew.filmId);
    return renderTurn({
      storyboard: film.storyboard ?? { title: film.title ?? 'Untitled', aspect: film.aspect, durationSec: 0, palette: ['#1f2937'], scenes: [] },
      rev: film.storyboardRev ?? 0,
      jobs: crew.board.list(),
      findings: deps.findings?.() ?? [],
      budget: { spentUsd: crew.budget.spent(), capUsd: crew.budget.capUsd },
      inbox: items,
      requests: directorRequests(deps.events?.() ?? []),
      maxFixes: crew.maxFixes ?? loadEnv().CREW_MAX_FIXES_PER_SCENE,
    });
  }

  /** One model turn: send, run each call, record cost. Returns whether every call failed, and whether any did. */
  async function turn(content: ChatMessage['content'], signal: AbortSignal): Promise<TurnResult> {
    history.push({ role: 'user', content });
    turns++;
    const sent = compact(history, 8, storySoFar(deps.events?.() ?? []));
    const response = await backend.chatWithTools(sent, tools, { parallelHint: true, signal });
    crew.emit({ type: 'agent.turn', backend: backend.id, ms: response.ms, calls: response.toolCalls.length, ...(response.content ? { reply: response.content.slice(0, 500) } : {}) });
    const usage = response.usage as { promptTokens?: number; completionTokens?: number } | undefined;
    if (usage?.promptTokens !== undefined && usage.completionTokens !== undefined)
      crew.toolCtx.ledger.add(crew.filmId, deps.model, `${usage.promptTokens} in / ${usage.completionTokens} out tokens`, priceSpark(deps.model, usage.promptTokens, usage.completionTokens));

    const calls = response.toolCalls as ToolCall[];
    const results = [];
    for (const call of calls) {
      if (signal.aborted) break;
      results.push(await (await getRegistry()).run(crew.toolCtx, call.name, call.args));
    }
    history.push(assistantMessageFrom({ content: response.content, toolCalls: calls.slice(0, results.length) }));
    results.forEach((r, i) => history.push(toolResultMessage(calls[i]!, r)));
    if (!calls.length && response.content?.trim()) {
      // no tool call: whatever the model said is a note to the user
      await (await getRegistry()).run(crew.toolCtx, 'say', { text: response.content.trim().slice(0, 240) });
    }
    if (results.some((r, i) => r.ok && calls[i]!.name === 'finish')) finished = true;
    return { allFailed: results.length > 0 && results.every((r) => !r.ok), anyFailed: results.some((r) => !r.ok), planFailed: results.some((r, i) => !r.ok && PLAN_TOOLS.has(calls[i]!.name)) };
  }

  async function next(signal: AbortSignal): Promise<InboxItem[] | undefined> {
    const idleMs = deps.idleEndMs ?? loadEnv().CREW_IDLE_END_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const stop = new Promise<'stop'>((resolve) => {
      timer = setTimeout(() => resolve('stop'), idleMs);
      timer.unref?.();
      onAbort = () => resolve('stop');
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const got = await Promise.race([crew.inbox.drain(), stop]);
      return got === 'stop' ? undefined : Promise.resolve(got);
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  return {
    history: () => history,
    turns: () => turns,
    sentImage: () => sentImage,
    isFinished: () => finished,
    setFinished: (value) => void (finished = value),
    agent,
    resetTurn: (hadUser) => void (crew.turn = newTurn(hadUser)),
    restoreTurn: (hadUser, needsBuilder, dispatched) => {
      crew.turn = { hadUser, needsBuilder: new Set(needsBuilder), dispatched: new Set(dispatched) };
    },
    view,
    compose(text) {
      const first = !sentImage;
      sentImage = true;
      return first && deps.productImageUrl ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: deps.productImageUrl } }] : text;
    },
    turn,
    next,
  };
}
