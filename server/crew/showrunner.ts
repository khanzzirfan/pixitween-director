// Owned by S12b. The showrunner's loop (design.md 3.1 and 5.6): wake on the inbox, take one turn, act through the board tools.
import { loadEnv } from '../env';
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

const REPAIR = 'Every tool call in your last turn failed. Read the errors, fix the arguments and call the tools again.';

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

export function createShowrunner(deps: ShowrunnerDeps) {
  const { crew, backend } = deps;
  const tools = deps.tools ?? createBoardTools(crew);
  // loaded on first use: the registry pulls in every tool module, which a route registration does not need
  let registry: Registry | undefined;
  const getRegistry = async (): Promise<Registry> => (registry ??= (await import('../tools/registry')).createRegistry([tools]));
  const history: ChatMessage[] = [{ role: 'system', content: showrunnerSystem() }];
  const maxTurns = deps.maxTurns ?? 40;
  let turns = 0;
  let sentImage = false;
  let finished = false;

  const agent = (state: 'thinking' | 'idle') => crew.emit({ type: 'crew.agent', lane: 'showrunner', worker: 'showrunner', state, model: deps.model });

  async function view(items: Parameters<typeof renderTurn>[0]['inbox']): Promise<string> {
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

  /** One model turn: send, run each call, record cost. Returns whether every call failed. */
  async function turn(userContent: ChatMessage['content'], signal: AbortSignal): Promise<{ allFailed: boolean }> {
    history.push({ role: 'user', content: userContent });
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
    return { allFailed: results.length > 0 && results.every((r) => !r.ok) };
  }

  /** Waits for the next batch, or for the end of the session. Undefined means stop. */
  async function next(signal: AbortSignal): Promise<ReturnType<typeof crew.inbox.drain> | undefined> {
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
    isFinished: () => finished,
    turns: () => turns,

    /** Runs until the session is idle for CREW_IDLE_END_MS, the signal aborts, or maxTurns is reached. */
    async run(signal: AbortSignal): Promise<void> {
      while (!signal.aborted && turns < maxTurns) {
        const batch = await next(signal);
        if (!batch) {
          // idle, or aborted: a job still working may yet report, so only an idle crew ends the session
          if (signal.aborted || crew.board.list().every((j) => TERMINAL.includes(j.status))) return;
          continue;
        }
        if (!batch.length) return; // the inbox was closed
        const hadUser = batch.some((i) => i.from === 'user');
        crew.turn = newTurn(hadUser);
        if (finished && hadUser) {
          finished = false;
          await crew.films.update(crew.filmId, { status: 'building' });
          crew.emit({ type: 'film.status', status: 'building' });
        }
        agent('thinking');
        try {
          const text = await view(batch);
          const first = !sentImage;
          sentImage = true;
          const content: ChatMessage['content'] = first && deps.productImageUrl ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: deps.productImageUrl } }] : text;
          let r = await turn(content, signal);
          // one repair turn, at once, when everything failed; a second failed turn waits for the inbox
          if (r.allFailed && !signal.aborted) r = await turn(REPAIR, signal);
          await autoDispatch(crew);
          if (crew.budget.level() === 'stop') {
            crew.emit({ type: 'error', where: 'showrunner', message: 'the film budget is spent; the crew stops here' });
            return;
          }
        } finally {
          agent('idle');
        }
      }
    },
  };
}

