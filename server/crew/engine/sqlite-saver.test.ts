import { Annotation, END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import type { BaseCheckpointSaver, CheckpointTuple } from '@langchain/langgraph-checkpoint';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../db/open';
import { SqliteSaver } from './sqlite-saver';

const CountState = Annotation.Root({ n: Annotation<number>({ reducer: (_a, b) => b ?? 0, default: () => 0 }) });
const graph = (saver: BaseCheckpointSaver, stopAt: number) =>
  new StateGraph(CountState)
    .addNode('step', (s: typeof CountState.State) => ({ n: s.n + 1 }))
    .addEdge(START, 'step')
    .addConditionalEdges('step', (s: typeof CountState.State) => (s.n < stopAt ? 'step' : END))
    .compile({ checkpointer: saver });

const thread = (id: string) => ({ configurable: { thread_id: id } });
const collect = async (it: AsyncGenerator<CheckpointTuple>) => {
  const out: CheckpointTuple[] = [];
  for await (const t of it) out.push(t);
  return out;
};
/** Checkpoint ids are random per run, so compare the shape: values, metadata step/source, parent presence, writes. */
const shape = (t: CheckpointTuple) => ({
  values: t.checkpoint.channel_values,
  step: t.metadata?.step,
  source: t.metadata?.source,
  hasParent: !!t.parentConfig,
  writes: (t.pendingWrites ?? []).map(([, ch, v]) => [ch, v]),
});

describe('SqliteSaver', () => {
  it('resumes a thread through a fresh saver over the same database', async () => {
    const db = openDatabase(':memory:');
    const first = await graph(new SqliteSaver(db), 3).invoke({}, thread('film_aaaaaaaaaaaa'));
    expect(first.n).toBe(3);
    const second = await graph(new SqliteSaver(db), 5).invoke({}, thread('film_aaaaaaaaaaaa'));
    expect(second.n).toBe(5);
  });

  it('matches MemorySaver on getTuple and list (before, limit, filter)', async () => {
    const mem = new MemorySaver();
    const sql = new SqliteSaver(openDatabase(':memory:'));
    for (const saver of [mem, sql]) await graph(saver, 4).invoke({}, thread('t1'));
    const [m, s] = [await mem.getTuple(thread('t1')), await sql.getTuple(thread('t1'))];
    expect(shape(s!)).toEqual(shape(m!));

    const [ml, sl] = [await collect(mem.list(thread('t1'))), await collect(sql.list(thread('t1')))];
    expect(sl.map(shape)).toEqual(ml.map(shape));
    expect(sl.length).toBeGreaterThan(2);

    const lim = (x: BaseCheckpointSaver) => collect(x.list(thread('t1'), { limit: 2 }));
    expect((await lim(sql)).map(shape)).toEqual((await lim(mem)).map(shape));

    const filt = (x: BaseCheckpointSaver) => collect(x.list(thread('t1'), { filter: { source: 'loop' } }));
    expect((await filt(sql)).map(shape)).toEqual((await filt(mem)).map(shape));

    // `before` is by checkpoint id, which differs per run: ask each saver for what precedes its own second-newest
    const prior = (x: BaseCheckpointSaver, l: CheckpointTuple[]) => collect(x.list(thread('t1'), { before: l[1]!.config }));
    expect((await prior(sql, sl)).map(shape)).toEqual((await prior(mem, ml)).map(shape));
  });

  it('keeps threads apart and deleteThread removes one thread only', async () => {
    const saver = new SqliteSaver(openDatabase(':memory:'));
    await graph(saver, 2).invoke({}, thread('a'));
    await graph(saver, 2).invoke({}, thread('b'));
    await saver.deleteThread('a');
    expect(await saver.getTuple(thread('a'))).toBeUndefined();
    expect((await saver.getTuple(thread('b')))?.checkpoint.channel_values.n).toBe(2);
  });

  it('keeps the first write of a task and replaces special-channel writes', async () => {
    const saver = new SqliteSaver(openDatabase(':memory:'));
    await graph(saver, 1).invoke({}, thread('w'));
    const tuple = (await saver.getTuple(thread('w')))!;
    await saver.putWrites(tuple.config, [['n', 1]], 'task1');
    await saver.putWrites(tuple.config, [['n', 2]], 'task1');
    await saver.putWrites(tuple.config, [['__error__', 'a']], 'task1');
    await saver.putWrites(tuple.config, [['__error__', 'b']], 'task1');
    const writes = (await saver.getTuple(tuple.config))!.pendingWrites!.map(([, ch, v]) => [ch, v]);
    expect(writes).toContainEqual(['n', 1]);
    expect(writes).not.toContainEqual(['n', 2]);
    expect(writes).toContainEqual(['__error__', 'b']);
    expect(writes).not.toContainEqual(['__error__', 'a']);
  });
});
