import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';
import { FileSaver, crewCheckpointFile } from './checkpointer';

const CountState = Annotation.Root({
  n: Annotation<number>({ reducer: (_a, b) => b ?? 0, default: () => 0 }),
});

const graph = (saver: FileSaver, stopAt: number) =>
  new StateGraph(CountState)
    .addNode('step', (s: typeof CountState.State) => ({ n: s.n + 1 }))
    .addEdge(START, 'step')
    .addConditionalEdges('step', (s: typeof CountState.State) => (s.n < stopAt ? 'step' : END))
    .compile({ checkpointer: saver });

describe('FileSaver', () => {
  it('writes checkpoints to disk and resumes them in a fresh process-like saver', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crew-ckpt-'));
    const file = join(dir, 'checkpoints', 'showrunner.json');
    const thread = { configurable: { thread_id: 'film_aaaaaaaaaaaa' } };

    const first = await graph(new FileSaver(file), 3).invoke({}, thread);
    expect(first.n).toBe(3);
    expect(readFileSync(file, 'utf8')).toContain('film_aaaaaaaaaaaa');

    const second = await graph(new FileSaver(file), 5).invoke({}, thread);
    expect(second.n).toBe(5);
  });

  it('uses the film crew directory for its checkpointer file', () => {
    expect(crewCheckpointFile('/data', 'film_aaaaaaaaaaaa')).toBe('/data/films/film_aaaaaaaaaaaa/crew/checkpoints/showrunner.json');
    expect(() => crewCheckpointFile('/data', '../escape')).toThrow(/bad film id/);
  });
});
