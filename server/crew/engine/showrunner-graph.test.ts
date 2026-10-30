import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';
import type { InboxItem } from '@shared/crew';
import type { ChatMessage, LlmBackend, ToolCall } from '@shared/ports';
import type { Scene } from '@shared/storyboard';
import { makeTestCrew, waitFor } from '../test-helpers';
import { FileSaver } from './checkpointer';
import { TERMINAL } from '../board';
import { DONE_NUDGE, WRAPPING } from '../showrunner';
import { createShowrunnerGraph } from './showrunner-graph';

const scene: Omit<Scene, 'id'> = { durationSec: 4, intent: 'a scene', shotType: 'hero', camera: 'static', layersWanted: ['bg', 'product'], mode: 'motion', modeReason: 'a still is enough' };
const adds = (n: number) => Array.from({ length: n }, () => ({ op: 'add' as const, scene }));
const bible = { palette: ['#1f2937', '#f59e0b'], light: 'warm', camera: 'slow', type: { font: 'sans', weight: 700, case: 'upper' as const }, productLine: 'a can', mood: 'calm' };
const planning = [
  { name: 'setStyleBible', args: bible },
  { name: 'reviseStoryboard', args: { ops: adds(4) } },
  ...[1, 2, 3, 4].map((i) => ({ name: 'dispatch', args: { kind: 'build-scene', sceneId: `s${i}`, brief: `build s${i}`, reason: 'new scene' } })),
];
const running = (_job: unknown, signal: AbortSignal) => new Promise<void>((_res, rej) => signal.addEventListener('abort', () => rej(new Error('stopped'))));
/** The test crew has no job-end chain, so this is the system note a finished build would send. */
const afterBuilds = async (t: Awaited<ReturnType<typeof makeTestCrew>>) => {
  await waitFor(() => t.board.list().length === 2 && t.board.list().every((j) => TERMINAL.includes(j.status)));
  t.inbox.push(item('system', 'both builds are done'));
};
const settle = () => new Promise<void>((r) => setTimeout(r, 20));
let n = 0;
/** Sets an env var for one test and returns the function that puts the old value back. */
const setEnv = (key: string, value: string) => {
  const prev = process.env[key];
  process.env[key] = value;
  return () => (prev === undefined ? delete process.env[key] : (process.env[key] = prev));
};
const item = (from: InboxItem['from'], text: string): InboxItem => ({ id: `i${++n}`, at: new Date().toISOString(), from, text });

type Entry = Array<{ name: string; args: unknown }>;
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

describe('the showrunner graph', () => {
  it('takes exactly one repair turn after every call fails', async () => {
    const t = await makeTestCrew();
    const bad: Entry = [{ name: 'dispatch', args: { kind: 'build-scene', sceneId: 's9', brief: 'b', reason: 'r' } }, { name: 'cancel', args: { jobId: 'j9' } }];
    const backend = scripted([bad, bad, bad]);
    const graph = createShowrunnerGraph({ crew: t.crew, backend, model: 'muse-wonder-1.0', wrapUp: false, idleEndMs: 30, checkpointer: new MemorySaver() });
    const run = graph.run(new AbortController().signal);
    t.inbox.push(item('user', 'go'));
    await run;
    expect(backend.turns()).toBe(2);
    expect(JSON.stringify(backend.sent[1])).toContain('Every tool call in your last turn failed');
  });



  it('puts a finished film back to building when the user speaks again', async () => {
    const t = await makeTestCrew();
    const backend = scripted([[{ name: 'reviseStoryboard', args: { ops: [{ op: 'add', scene: { durationSec: 4, intent: 'a scene', shotType: 'hero', camera: 'static', layersWanted: ['bg'], mode: 'motion', modeReason: 'a still is enough' } }, { op: 'add', scene: { durationSec: 4, intent: 'a scene', shotType: 'hero', camera: 'static', layersWanted: ['bg'], mode: 'motion', modeReason: 'a still is enough' } }] } }, { name: 'finish', args: { summary: 'done' } }], [{ name: 'say', args: { text: 'on it' } }]]);
    const graph = createShowrunnerGraph({ crew: t.crew, backend, model: 'muse-wonder-1.0', wrapUp: false, idleEndMs: 100, checkpointer: new MemorySaver() });
    const run = graph.run(new AbortController().signal);
    t.inbox.push(item('system', 'go'));
    await waitFor(async () => (await t.film.films.get(t.film.filmId)).status === 'ready');
    t.inbox.push(item('user', 'one more thing'));
    await run;
    expect((await t.film.films.get(t.film.filmId)).status).toBe('building');
  });

  it('resumes a run that was stopped mid-turn', async () => {
    const t = await makeTestCrew();
    const dir = mkdtempSync(join(tmpdir(), 'crew-graph-abort-'));
    const file = join(dir, 'showrunner.json');
    const first = createShowrunnerGraph({ crew: t.crew, backend: scripted([planning]), model: 'muse-wonder-1.0', wrapUp: false, idleEndMs: 200, checkpointer: new FileSaver(file) });
    const ac = new AbortController();
    const run = first.run(ac.signal);
    t.inbox.push(item('system', 'New film: a cold-brew can'));
    await waitFor(() => t.board.list().length === 4);
    ac.abort();
    await run;

    const second = scripted([[{ name: 'say', args: { text: 'picked up' } }]]);
    const resumed = createShowrunnerGraph({ crew: t.crew, backend: second, model: 'muse-wonder-1.0', wrapUp: false, idleEndMs: 40, checkpointer: new FileSaver(file) });
    const resumedRun = resumed.run(new AbortController().signal);
    await new Promise((r) => setTimeout(r, 10));
    t.inbox.push(item('user', 'carry on'));
    await resumedRun;
    await settle();
    expect(t.events.some((e) => e.type === 'showrunner.say' && e.text === 'picked up')).toBe(true);
  });

  it('resumes the same thread with its history after a restart', async () => {
    const t = await makeTestCrew();
    const dir = mkdtempSync(join(tmpdir(), 'crew-graph-'));
    const file = join(dir, 'showrunner.json');
    const first = createShowrunnerGraph({ crew: t.crew, backend: scripted([planning]), model: 'muse-wonder-1.0', wrapUp: false, idleEndMs: 40, checkpointer: new FileSaver(file) });
    t.inbox.push(item('system', 'New film: a cold-brew can'));
    await first.run(new AbortController().signal);
    expect(existsSync(file)).toBe(true);

    const second = scripted([[{ name: 'say', args: { text: 'still here' } }]]);
    const resumed = createShowrunnerGraph({ crew: t.crew, backend: second, model: 'muse-wonder-1.0', wrapUp: false, idleEndMs: 30, checkpointer: new FileSaver(file) });
    const resumedRun = resumed.run(new AbortController().signal);
    await new Promise((r) => setTimeout(r, 10));
    t.inbox.push(item('user', 'one more thing'));
    await resumedRun;
    await settle();
    expect(second.turns()).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(second.sent[0])).toContain('New film: a cold-brew can');
    expect(t.events.some((e) => e.type === 'showrunner.say' && e.text === 'still here')).toBe(true);
  });

  it('pushes the done nudge once when the built film is idle, and the director sees it on a later turn', async () => {
    const t = await makeTestCrew();
    const restore = setEnv('CREW_AUTO_FINISH', '0');
    try {
      const backend = scripted([[{ name: 'reviseStoryboard', args: { ops: adds(2) } }]]);
      const graph = createShowrunnerGraph({ crew: t.crew, backend, model: 'muse-wonder-1.0', idleEndMs: 40, checkpointer: new MemorySaver() });
      const run = graph.run(new AbortController().signal);
      t.inbox.push(item('user', 'go'));
      await afterBuilds(t);
      await run;
      await settle();
      const nudged = backend.sent.filter((m) => JSON.stringify(m.at(-1)).includes(DONE_NUDGE));
      expect(nudged).toHaveLength(1);
      expect(JSON.stringify(backend.sent[0].at(-1))).not.toContain(DONE_NUDGE);
    } finally {
      restore();
    }
  });

  it('auto-finishes after two idle turns when CREW_AUTO_FINISH is on', async () => {
    const restore = setEnv('CREW_AUTO_FINISH', '1');
    try {
      const t = await makeTestCrew();
      const backend = scripted([[{ name: 'reviseStoryboard', args: { ops: adds(2) } }]]);
      const graph = createShowrunnerGraph({ crew: t.crew, backend, model: 'muse-wonder-1.0', idleEndMs: 40, checkpointer: new MemorySaver() });
      const run = graph.run(new AbortController().signal);
      t.inbox.push(item('user', 'go'));
      await afterBuilds(t);
      await run;
      await settle();
      expect((await t.film.films.get(t.film.filmId)).status).toBe('ready');
      expect(t.events.some((e) => e.type === 'showrunner.say' && e.text === WRAPPING)).toBe(true);
    } finally {
      restore();
    }
  });
});
