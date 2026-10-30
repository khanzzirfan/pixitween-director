// Owned by S12b. The showrunner's loop (design.md 3.1 and 5.6): wake on the inbox, take one turn, act through the board tools.
// The turn machinery is shared by the native loop and the LangGraph engine (server/crew/engine/showrunner-graph.ts).
import { loadEnv } from '../env';
import type { InboxItem } from '@shared/crew';
import type { FilmEvent } from '@shared/events';
import type { ChatMessage, LlmBackend, ToolCall } from '@shared/ports';
import type { ToolDef } from '@shared/tools';
import { assistantMessageFrom, toolResultMessage } from '../llm/messages';
import { priceSpark } from '../pricing';
import type { Registry } from '../tools/registry';
import { compact, renderTurn, storySoFar, type Finding } from './history';
import { showrunnerSystem } from './prompts';
import { createBoardTools, newTurn, type CrewCtx } from './showrunner-tools';
import { TERMINAL } from './board';

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
  /** A guard against a runaway loop. */
  maxTurns?: number;
}

export const REPAIR = 'Every tool call in your last turn failed. Read the errors, fix the arguments and call the tools again.';
export const REPAIR_STALLED = 'Some tool calls in your last turn failed and no job is running, so nothing will wake you. Read the errors, fix the arguments and call those tools again.';

/** Dispatches an 'auto' job for every scene that needs a builder and got none from the showrunner this turn (design 5.4). */
export async function autoDispatch(crew: CrewCtx, origin: 'auto' | 'user' = 'auto'): Promise<string[]> {
  const film = await crew.films.get(crew.filmId);
  const made: string[] = [];
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
}

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
  const tools = deps.tools ?? createBoardTools(crew);
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
    return { allFailed: results.length > 0 && results.every((r) => !r.ok), anyFailed: results.some((r) => !r.ok) };
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

export function createShowrunner(deps: ShowrunnerDeps) {
  const maxTurns = deps.maxTurns ?? 40;
  const agent = createShowrunnerAgent(deps);
  const { crew } = deps;

  return {
    isFinished: agent.isFinished,
    turns: agent.turns,

    /** Runs until the session is idle for CREW_IDLE_END_MS, the signal aborts, or maxTurns is reached. */
    async run(signal: AbortSignal): Promise<void> {
      while (!signal.aborted && agent.turns() < maxTurns) {
        const batch = await agent.next(signal);
        if (!batch) {
          // idle, or aborted: a job still working may yet report, so only an idle crew ends the session
          if (signal.aborted || crew.board.list().every((j) => TERMINAL.includes(j.status))) return;
          continue;
        }
        if (!batch.length) return; // the inbox was closed
        const hadUser = batch.some((i) => i.from === 'user');
        agent.resetTurn(hadUser);
        if (agent.isFinished() && hadUser) {
          agent.setFinished(false);
          await crew.films.update(crew.filmId, { status: 'building' });
          crew.emit({ type: 'film.status', status: 'building' });
        }
        agent.agent('thinking');
        try {
          const text = await agent.view(batch);
          const content = agent.compose(text);
          let r = await agent.turn(content, signal);
          // one repair turn, at once, when everything failed, or when some calls failed and no job is left to wake the inbox;
          // a second failed turn waits for the inbox
          const stalled = r.anyFailed && crew.board.list().every((j) => TERMINAL.includes(j.status));
          if ((r.allFailed || stalled) && !signal.aborted) r = await agent.turn(r.allFailed ? REPAIR : REPAIR_STALLED, signal);
          await autoDispatch(crew);
          if (crew.budget.level() === 'stop') {
            crew.emit({ type: 'error', where: 'showrunner', message: 'the film budget is spent; the crew stops here' });
            return;
          }
        } finally {
          agent.agent('idle');
        }
      }
    },
  };
}
