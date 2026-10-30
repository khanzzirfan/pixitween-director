// The showrunner's control flow as a LangGraph graph (Phase 2). The scheduler, board and workers stay outside the graph:
// a turn only dispatches jobs and returns, so a user message never waits for a builder superstep.
import { Annotation, END, START, StateGraph, type LangGraphRunnableConfig } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import type { InboxItem } from '@shared/crew';
import type { ChatMessage } from '@shared/ports';
import { loadEnv } from '../../env';
import { TERMINAL } from '../board';
import {
  REPAIR,
  REPAIR_STALLED,
  autoDispatch,
  createShowrunnerAgent,
  autoFinish,
  idleDecision,
  pushDoneNudge,
  type IdleAction,
  type ShowrunnerAgent,
  type ShowrunnerDeps,
} from '../showrunner';

const last = <T>(fallback: () => T) => ({ value: (a: T, b: T) => b ?? a, default: fallback });

const CrewState = Annotation.Root({
  messages: Annotation<ChatMessage[]>(last<ChatMessage[]>(() => [])),
  batch: Annotation<InboxItem[]>(last<InboxItem[]>(() => [])),
  turns: Annotation<number>(last<number>(() => 0)),
  finished: Annotation<boolean>(last<boolean>(() => false)),
  sentImage: Annotation<boolean>(last<boolean>(() => false)),
  hadUser: Annotation<boolean>(last<boolean>(() => false)),
  needsBuilder: Annotation<string[]>(last<string[]>(() => [])),
  dispatched: Annotation<string[]>(last<string[]>(() => [])),
  /** 'none' on a normal turn; 'all' or 'stalled' when the next turn is the single repair turn. */
  repair: Annotation<'none' | 'all' | 'stalled'>(last<'none' | 'all' | 'stalled'>(() => 'none')),
  nudged: Annotation<boolean>(last<boolean>(() => false)),
  idleTurns: Annotation<number>(last<number>(() => 0)),
  idleAction: Annotation<IdleAction>(last<IdleAction>(() => 'none')),
  stop: Annotation<boolean>(last<boolean>(() => false)),
});

type State = typeof CrewState.State;

export interface ShowrunnerGraphOptions extends ShowrunnerDeps {
  checkpointer?: BaseCheckpointSaver;
  /** The checkpoint namespace. One film is one thread. */
  threadId?: string;
  /** LangGraph's runaway guard; the loop's own maxTurns is the real limit. */
  recursionLimit?: number;
}

const signalOf = (config: LangGraphRunnableConfig): AbortSignal => config.signal ?? new AbortController().signal;

const snapshot = (state: State) => ({
  messages: state.messages,
  turns: state.turns,
  finished: state.finished,
  sentImage: state.sentImage,
});

const restoreTurn = (crew: ShowrunnerDeps['crew'], state: State) => {
  crew.turn = { hadUser: state.hadUser, needsBuilder: new Set(state.needsBuilder), dispatched: new Set(state.dispatched) };
};

export function createShowrunnerGraph(opts: ShowrunnerGraphOptions) {
  const { crew, checkpointer, threadId = crew.filmId, recursionLimit } = opts;
  const maxTurns = opts.maxTurns ?? 40;
  let thinking = false;
  const agentState = (state: 'thinking' | 'idle') => {
    if (state === 'thinking') thinking = true;
    else if (!thinking) return;
    else thinking = false;
    crew.emit({ type: 'crew.agent', lane: 'showrunner', worker: 'showrunner', state, model: opts.model });
  };

  /** Waits for the next inbox batch. Idle with a live job loops back to waiting, like the native loop. */
  async function wake(state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> {
    if (state.turns >= maxTurns) return { stop: true };
    const signal = signalOf(config);
    const agent: ShowrunnerAgent = createShowrunnerAgent(opts, snapshot(state));
    for (;;) {
      const batch = await agent.next(signal);
      if (batch === undefined) {
        if (signal.aborted || crew.board.list().every((j) => TERMINAL.includes(j.status))) return { stop: true };
        continue;
      }
      if (!batch.length) return { stop: true };
      const hadUser = batch.some((i) => i.from === 'user');
      if (state.finished && hadUser) {
        await crew.films.update(crew.filmId, { status: 'building' });
        crew.emit({ type: 'film.status', status: 'building' });
      }
      agentState('thinking');
      return {
        batch,
        hadUser,
        finished: hadUser ? false : state.finished,
        repair: 'none',
        stop: false,
        needsBuilder: [],
        dispatched: [],
      };
    }
  }

  /** One model turn, including the one repair turn that may follow it. */
  async function turn(state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> {
    const signal = signalOf(config);
    const agent = createShowrunnerAgent(opts, snapshot(state));
    agent.restoreTurn(state.hadUser, state.needsBuilder, state.dispatched);
    const content =
      state.repair === 'none'
        ? agent.compose(await agent.view(state.batch))
        : state.repair === 'all'
          ? REPAIR
          : REPAIR_STALLED;
    const r = await agent.turn(content, signal);
    const stalled = r.anyFailed && crew.board.list().every((j) => TERMINAL.includes(j.status));
    const repair = state.repair === 'none' && !signal.aborted && (r.allFailed || stalled) ? (r.allFailed ? 'all' : 'stalled') : 'none';
    if (signal.aborted) agentState('idle');
    return {
      messages: agent.history(),
      turns: agent.turns(),
      finished: agent.isFinished(),
      sentImage: agent.sentImage(),
      needsBuilder: [...crew.turn.needsBuilder],
      dispatched: [...crew.turn.dispatched],
      repair,
      stop: signal.aborted,
    };
  }

  /** Auto-dispatch and the budget stop. Then decides, without side effects, whether the idle board needs a nudge or an auto-finish. */
  async function idleCheck(state: State): Promise<Partial<State>> {
    restoreTurn(crew, state);
    await autoDispatch(crew);
    const base = { repair: 'none' as const, batch: [], hadUser: false, needsBuilder: [], dispatched: [], idleAction: 'none' as IdleAction };
    if (crew.budget.level() === 'stop') {
      crew.emit({ type: 'error', where: 'showrunner', message: 'the film budget is spent; the crew stops here' });
      agentState('idle');
      return { ...base, stop: true };
    }
    if (opts.wrapUp === false) {
      agentState('idle');
      return { ...base, stop: false };
    }
    const d = await idleDecision(crew, { nudged: state.nudged, idleTurns: state.idleTurns }, { autoFinish: loadEnv().CREW_AUTO_FINISH, hadUser: state.hadUser, finished: state.finished });
    agentState('idle');
    return { ...base, stop: false, idleAction: d.action, nudged: d.nudged, idleTurns: d.idleTurns };
  }

  /** The done nudge (or a reminder after an idle turn) goes into the inbox; the wake node picks it up on the next pass. */
  async function nudge(): Promise<Partial<State>> {
    pushDoneNudge(crew);
    return {};
  }

  /** Auto-finish. A refused gate keeps the session open with the idle counter reset, as the native loop does. */
  async function finish(state: State): Promise<Partial<State>> {
    if (await autoFinish(crew)) return { finished: true, stop: true, idleAction: 'none' };
    return { finished: state.finished, stop: false, idleTurns: 0, nudged: true, idleAction: 'none' };
  }

  const graph = new StateGraph(CrewState)
    .addNode('wake', wake)
    .addNode('turn', turn)
    .addNode('idle_check', idleCheck)
    .addNode('nudge', nudge)
    .addNode('finish', finish)
    .addEdge(START, 'wake')
    .addConditionalEdges('wake', (s: State) => (s.stop ? END : 'turn'))
    .addConditionalEdges('turn', (s: State) => (s.stop ? END : s.repair !== 'none' ? 'turn' : 'idle_check'))
    .addConditionalEdges('idle_check', (s: State) => {
      if (s.stop) return END;
      if (s.idleAction === 'nudge') return 'nudge';
      if (s.idleAction === 'finish') return 'finish';
      return 'wake';
    })
    .addEdge('nudge', 'wake')
    .addConditionalEdges('finish', (s: State) => (s.stop ? END : 'wake'))
    .compile({ ...(checkpointer ? { checkpointer } : {}) });

  return {
    graph,
    /** Runs (or resumes) one session. A completed thread starts a new session with its history and counters intact. */
    async run(signal: AbortSignal): Promise<void> {
      try {
        await graph.invoke(
          { stop: false, nudged: false, idleTurns: 0 },
          {
            configurable: { thread_id: threadId },
            signal,
            recursionLimit: recursionLimit ?? Math.max(50, maxTurns * 8 + 10),
          },
        );
      } catch (e) {
        // stopping a session is not a failure, and the native loop already behaves this way
        if (!(signal.aborted && e instanceof Error && e.name === 'AbortError')) throw e;
      } finally {
        if (thinking) agentState('idle');
      }
    },
  };
}

export type ShowrunnerGraph = ReturnType<typeof createShowrunnerGraph>;
