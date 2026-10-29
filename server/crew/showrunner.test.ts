import { describe, expect, it } from 'vitest';
import type { InboxItem } from '@shared/crew';
import type { ChatMessage, LlmBackend, ToolCall } from '@shared/ports';
import type { Scene } from '@shared/storyboard';
import { createJobChains } from './chains';
import { createBoard } from './board';
import { createScheduler } from './scheduler';
import { createShowrunner, autoDispatch } from './showrunner';
import { newTurn, reviseStoryboard } from './showrunner-tools';
import { makeTestCrew } from './test-helpers';

const scene: Omit<Scene, 'id'> = { durationSec: 4, intent: 'a scene', shotType: 'hero', camera: 'static', layersWanted: ['bg', 'product'], mode: 'motion', modeReason: 'a still is enough' };
const adds = (n: number) => Array.from({ length: n }, () => ({ op: 'add' as const, scene }));
const bible = { palette: ['#1f2937', '#f59e0b'], light: 'warm', camera: 'slow', type: { font: 'Inter', weight: 700, case: 'upper' as const }, productLine: 'a can', mood: 'calm' };
const settle = () => new Promise<void>((r) => setTimeout(r, 20));
let n = 0;
const item = (from: InboxItem['from'], text: string): InboxItem => ({ id: `i${++n}`, at: new Date().toISOString(), from, text });

type Entry = Array<{ name: string; args: unknown }>;
/** Answers each turn from a script and records the messages it was sent. */
function scripted(entries: Entry[]): LlmBackend & { sent: ChatMessage[][]; turns: () => number } {
  const queue = [...entries];
  const sent: ChatMessage[][] = [];
  let turn = 0;
  return {
    id: 'wonder',
    sent,
    turns: () => turn,
    async chatWithTools(messages) {
      sent.push(JSON.parse(JSON.stringify(messages)) as ChatMessage[]);
      const calls = queue.shift() ?? [];
      const t = turn++;
      return { toolCalls: calls.map((c, i): ToolCall => ({ id: `call_${t}_${i}`, name: c.name, args: c.args })), ms: 10, usage: { promptTokens: 8000, completionTokens: 1500 } };
    },
  };
}

const planning: Entry = [
  { name: 'setStyleBible', args: bible },
  { name: 'reviseStoryboard', args: { ops: adds(4) } },
  ...[1, 2, 3, 4].map((i) => ({ name: 'dispatch', args: { kind: 'build-scene', sceneId: `s${i}`, brief: `build s${i}`, reason: 'new scene' } })),
];

async function start(entries: Entry[], o: { image?: boolean; idleEndMs?: number; instant?: boolean } = {}) {
  const t = await makeTestCrew(o.instant ? {} : { runWorker: (_job, signal) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('stopped')))) });
  const backend = scripted(entries);
  const showrunner = createShowrunner({ crew: t.crew, backend, model: 'muse-wonder-1.0', idleEndMs: o.idleEndMs ?? 60, ...(o.image ? { productImageUrl: 'data:image/jpeg;base64,AAAA' } : {}) });
  const ac = new AbortController();
  const done = showrunner.run(ac.signal);
  return { ...t, backend, showrunner, done, ac };
}

describe('the loop', () => {
  it('one planning turn leaves four jobs on the board, and prices the turn', async () => {
    const s = await start([planning], { instant: true });
    s.inbox.push(item('system', 'New film: a cold-brew can'));
    await s.done;
    expect(s.board.list().map((j) => [j.kind, j.sceneId])).toEqual([1, 2, 3, 4].map((i) => ['build-scene', `s${i}`]));
    expect(s.backend.turns()).toBe(1);
    expect(s.film.ledger.total(s.film.filmId)).toBeCloseTo(0.062, 5);
  });

  it('each turn is thinking then idle, with one agent.turn naming the backend', async () => {
    const s = await start([[{ name: 'say', args: { text: 'Hi' } }]]);
    s.inbox.push(item('user', 'hello'));
    await s.done;
    await settle();
    const lane = s.events.filter((e) => e.type === 'crew.agent' || e.type === 'agent.turn');
    expect(lane.map((e) => (e.type === 'crew.agent' ? e.state : e.type))).toEqual(['thinking', 'agent.turn', 'idle']);
    expect(lane.find((e) => e.type === 'agent.turn')).toMatchObject({ backend: 'wonder', calls: 1 });
    expect(s.events.find((e) => e.type === 'showrunner.say')).toMatchObject({ kind: 'reply' });
  });

  it('a turn whose calls all fail gets exactly one repair turn, and a second failure gets none', async () => {
    const bad: Entry = [{ name: 'dispatch', args: { kind: 'build-scene', sceneId: 's9', brief: 'b', reason: 'r' } }, { name: 'cancel', args: { jobId: 'j9' } }];
    const s = await start([bad, bad, bad]);
    s.inbox.push(item('user', 'go'));
    await s.done;
    expect(s.backend.turns()).toBe(2);
    expect(JSON.stringify(s.backend.sent[1])).toContain('Every tool call in your last turn failed');
  });

  it('a repair turn that succeeds ends the repair, and the next inbox batch starts clean', async () => {
    const bad: Entry = [{ name: 'cancel', args: { jobId: 'j9' } }];
    const s = await start([bad, [{ name: 'say', args: { text: 'fixed' } }], [{ name: 'say', args: { text: 'later' } }]], { idleEndMs: 200 });
    s.inbox.push(item('user', 'first'));
    await settle();
    expect(s.backend.turns()).toBe(2);
    s.inbox.push(item('user', 'second'));
    await s.done;
    expect(s.backend.turns()).toBe(3);
  });

  it('only the first turn carries the product photo', async () => {
    const s = await start([[{ name: 'say', args: { text: 'one' } }], [{ name: 'say', args: { text: 'two' } }], [{ name: 'say', args: { text: 'three' } }]], { image: true, idleEndMs: 200 });
    s.inbox.push(item('system', 'New film'));
    await settle();
    s.inbox.push(item('user', 'again'));
    await settle();
    s.inbox.push(item('user', 'and again'));
    await s.done;
    const hasImage = s.backend.sent.map((m) => JSON.stringify(m).includes('image_url'));
    expect(hasImage).toEqual([true, false, false]);
  });

  it('shows the model the board and the new inbox items', async () => {
    const s = await start([[{ name: 'say', args: { text: 'ok' } }]]);
    s.inbox.push(item('user', 'warmer light'));
    await s.done;
    const last = s.backend.sent[0]!.at(-1)!;
    expect(String(last.content)).toContain('BOARD  rev 0');
    expect(String(last.content)).toContain('[user ');
    expect(String(last.content)).toContain('warmer light');
  });

  it('a reply with no tool calls becomes a note to the user', async () => {
    const t = await makeTestCrew();
    const talker: LlmBackend = { id: 'wonder', async chatWithTools() { return { toolCalls: [], content: 'I am thinking about it.', ms: 1 }; } };
    const sr = createShowrunner({ crew: t.crew, backend: talker, model: 'muse-wonder-1.0', idleEndMs: 40 });
    t.inbox.push(item('system', 'hi'));
    await sr.run(new AbortController().signal);
    await settle();
    expect(t.events.find((e) => e.type === 'showrunner.say')).toMatchObject({ text: 'I am thinking about it.' });
  });

  it('stops when its signal aborts', async () => {
    const s = await start([], { idleEndMs: 60_000 });
    s.ac.abort();
    await s.done;
    expect(s.backend.turns()).toBe(0);
  });

  it('waits while a job is still working when the idle time passes', async () => {
    const t = await makeTestCrew({ runWorker: (_j, signal) => new Promise((_r, rej) => signal.addEventListener('abort', () => rej(new Error('stopped')))) });
    await reviseStoryboard(t.crew, adds(2));
    await t.scheduler.dispatch({ kind: 'build-scene', sceneId: 's1', origin: 'auto', brief: 'b', reason: 'r' });
    const sr = createShowrunner({ crew: t.crew, backend: scripted([]), model: 'muse-wonder-1.0', idleEndMs: 30 });
    const ac = new AbortController();
    let ended = false;
    const run = sr.run(ac.signal).then(() => (ended = true));
    await new Promise((r) => setTimeout(r, 120));
    expect(ended).toBe(false);
    await t.scheduler.cancel('j1');
    await run;
  });

  it('a showrunner turn after finish by the user puts the film back to building', async () => {
    const t = await makeTestCrew();
    await reviseStoryboard(t.crew, adds(2));
    const sr = createShowrunner({ crew: t.crew, backend: scripted([[{ name: 'finish', args: { summary: 'done' } }], [{ name: 'say', args: { text: 'on it' } }]]), model: 'muse-wonder-1.0', idleEndMs: 150 });
    const run = sr.run(new AbortController().signal);
    t.inbox.push(item('system', 'go'));
    await settle();
    expect(sr.isFinished()).toBe(true);
    expect((await t.film.films.get(t.film.filmId)).status).toBe('ready');
    t.inbox.push(item('user', 'one more thing'));
    await run;
    expect(sr.isFinished()).toBe(false);
    expect((await t.film.films.get(t.film.filmId)).status).toBe('building');
  });
});

describe('auto-dispatch', () => {
  it('a turn that adds s5 but dispatches nothing leaves one auto build-scene for s5', async () => {
    const t = await makeTestCrew({ runWorker: (_j, signal) => new Promise((_r, rej) => signal.addEventListener('abort', () => rej(new Error('stopped')))) });
    await reviseStoryboard(t.crew, adds(4));
    const backend = scripted([[{ name: 'reviseStoryboard', args: { ops: adds(1) } }]]);
    const sr = createShowrunner({ crew: t.crew, backend, model: 'muse-wonder-1.0', idleEndMs: 40 });
    const run = sr.run(new AbortController().signal);
    t.inbox.push(item('user', 'add a scene'));
    await settle();
    expect(t.board.list().map((j) => [j.kind, j.sceneId, j.origin])).toEqual([['build-scene', 's5', 'auto']]);
    await t.scheduler.cancel('j1');
    await run;
  });

  it('a turn that adds s5 and dispatches its build itself leaves exactly one build for s5', async () => {
    const t = await makeTestCrew({ runWorker: (_j, signal) => new Promise((_r, rej) => signal.addEventListener('abort', () => rej(new Error('stopped')))) });
    await reviseStoryboard(t.crew, adds(4));
    const backend = scripted([[{ name: 'reviseStoryboard', args: { ops: adds(1) } }, { name: 'dispatch', args: { kind: 'build-scene', sceneId: 's5', brief: 'b', reason: 'r' } }]]);
    const sr = createShowrunner({ crew: t.crew, backend, model: 'muse-wonder-1.0', idleEndMs: 40 });
    const run = sr.run(new AbortController().signal);
    t.inbox.push(item('user', 'add a scene'));
    await settle();
    expect(t.board.list().filter((j) => j.sceneId === 's5')).toHaveLength(1);
    expect(t.board.list()[0]!.origin).toBe('showrunner');
    await t.scheduler.cancel('j1');
    await run;
  });

  it('an edit to a scene that was built before becomes a rebuild', async () => {
    const t = await makeTestCrew();
    await reviseStoryboard(t.crew, adds(2));
    const j = t.board.add({ kind: 'build-scene', origin: 'auto', sceneId: 's1' });
    t.board.update(j.id, { status: 'running' });
    t.board.update(j.id, { status: 'done' });
    t.crew.turn = newTurn();
    t.crew.turn.needsBuilder.add('s1');
    expect(await autoDispatch(t.crew)).toHaveLength(1);
    expect(t.board.list().at(-1)).toMatchObject({ kind: 'rebuild-scene', sceneId: 's1', brief: 'a scene' });
  });
});

describe('job chains', () => {
  it('a build on s2 ending done queues one continuity and one critique, and tells the inbox once', async () => {
    const pushed: InboxItem[] = [];
    const inbox = { push: (i: InboxItem) => pushed.push(i), drain: async () => [], size: () => 0, close: () => undefined };
    let board!: ReturnType<typeof createBoard>;
    let scheduler!: ReturnType<typeof createScheduler>;
    const onUpdate = createJobChains({ board: () => board, scheduler: () => scheduler, inbox });
    board = createBoard({ filmId: 'film_aaaaaaaaaaaa', emit: (e) => onUpdate(e.job), persist: () => undefined });
    const ran: string[] = [];
    scheduler = createScheduler({ board, maxWorkers: 4, runWorker: async (j) => { ran.push(j.kind); return j.kind === 'build-scene' ? { summary: '7 tool calls' } : undefined; } });
    await scheduler.dispatch({ kind: 'build-scene', sceneId: 's2', origin: 'auto', brief: 'b', reason: 'r' });
    await scheduler.idle();
    await settle();
    await scheduler.idle();
    expect(board.list().map((j) => [j.kind, j.sceneId])).toEqual([['build-scene', 's2'], ['continuity', 's2'], ['critique', 's2']]);
    // the build is news; the two checks report their own findings
    expect(pushed.map((p) => p.text)).toEqual(['build-scene s2 done: 7 tool calls']);
    expect(pushed[0]).toMatchObject({ from: 'job', jobId: 'j1' });
    expect(ran).toEqual(['build-scene', 'continuity', 'critique']);
  });

  it('a failed job is reported, and queues no checks', async () => {
    const pushed: InboxItem[] = [];
    const inbox = { push: (i: InboxItem) => pushed.push(i), drain: async () => [], size: () => 0, close: () => undefined };
    let board!: ReturnType<typeof createBoard>;
    let scheduler!: ReturnType<typeof createScheduler>;
    const onUpdate = createJobChains({ board: () => board, scheduler: () => scheduler, inbox });
    board = createBoard({ filmId: 'film_aaaaaaaaaaaa', emit: (e) => onUpdate(e.job), persist: () => undefined });
    scheduler = createScheduler({ board, maxWorkers: 4, runWorker: async () => { throw new Error('model said no'); } });
    await scheduler.dispatch({ kind: 'build-scene', sceneId: 's1', origin: 'auto', brief: 'b', reason: 'r' });
    await scheduler.idle();
    await settle();
    expect(board.list()).toHaveLength(1);
    expect(pushed.map((p) => p.text)).toEqual(['build-scene s1 failed: model said no']);
  });

  it('a late patch on a finished job does not chain again', async () => {
    const pushed: InboxItem[] = [];
    const inbox = { push: (i: InboxItem) => pushed.push(i), drain: async () => [], size: () => 0, close: () => undefined };
    let board!: ReturnType<typeof createBoard>;
    let scheduler!: ReturnType<typeof createScheduler>;
    const onUpdate = createJobChains({ board: () => board, scheduler: () => scheduler, inbox });
    board = createBoard({ filmId: 'film_aaaaaaaaaaaa', emit: (e) => onUpdate(e.job), persist: () => undefined });
    scheduler = createScheduler({ board, maxWorkers: 4, runWorker: async () => undefined });
    await scheduler.dispatch({ kind: 'restyle-scene', sceneId: 's1', origin: 'user', brief: 'b', reason: 'r' });
    await scheduler.idle();
    board.update('j1', { costUsd: 0.02 });
    await settle();
    expect(board.list().map((j) => j.kind)).toEqual(['restyle-scene', 'continuity', 'critique']);
    expect(pushed).toHaveLength(1);
  });
});
