import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { expect, it } from 'vitest';
import { getDb } from './open';
import { importLegacyData } from './import-legacy';

const F = 'film_aaaaaaaaaaaa';
const A = `ast_${'a'.repeat(32)}`;
const w = (file: string, body: unknown) => (
  mkdirSync(join(file, '..'), { recursive: true }),
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body))
);

function legacy() {
  const d = mkdtempSync(join(tmpdir(), 'legacy-'));
  const comp = { schema: 'x' };
  w(join(d, 'films', F, 'film.json'), {
    id: F,
    status: 'ready',
    createdAt: '2026-01-01T00:00:00Z',
    aspect: '9:16',
    brief: { text: 't', productAssetId: A },
    version: 2,
    assets: [],
    head: 2,
    maxVersion: 2,
    redo: [],
  });
  w(join(d, 'films', F, 'versions', '1.json'), { version: 1, composition: comp, source: 'agent', at: '2026-01-01T00:00:01Z', parent: null });
  w(join(d, 'films', F, 'versions', '2.json'), { version: 2, composition: comp, source: 'user', note: 'n', at: '2026-01-01T00:00:02Z', parent: 1 });
  w(
    join(d, 'films', F, 'events.jsonl'),
    `{"seq":1,"event":{"type":"film.status","status":"planning"}}\n{"seq":2,"event":{"type":"film.status","status":"ready"}}\n{"seq":3,"event":{"ty`,
  );
  w(join(d, 'films', F, 'ledger.jsonl'), `{"at":"t","model":"m","units":"1 image","usd":0.25}\n{"at":"t","model":"clippy","units":"x","usd":0,"credits":25}\n`);
  w(join(d, 'films', F, 'crew', 'board.json'), []);
  w(join(d, 'assets', `${A}.json`), { id: A, mime: 'image/png' });
  writeFileSync(join(d, 'assets', `${A}.png`), Buffer.alloc(10));
  w(join(d, 'lineups', 'lin_aaaaaaaa.json'), {
    id: 'lin_aaaaaaaa',
    aspect: '9:16',
    brief: '',
    createdAt: 't',
    items: [
      { product: { id: 'p1' }, filmId: F, state: 'done' },
      { product: { id: 'p2' }, state: 'making' },
    ],
  });
  return d;
}

it('imports films, versions, events, ledger, assets and line-ups once, and leaves the old files', () => {
  const d = legacy();
  const r = importLegacyData(d);
  expect(r).toMatchObject({ films: 1, versions: 2, events: 2, ledger: 2, assets: 1, lineups: 1 });
  const db = getDb(d);
  expect(db.prepare('SELECT head, status FROM films WHERE id = ?').get(F)).toEqual({ head: 2, status: 'ready' });
  expect(db.prepare('SELECT SUM(usd) AS usd, SUM(credits) AS c FROM ledger').get()).toEqual({ usd: 0.25, c: 25 });
  expect(db.prepare('SELECT state FROM lineup_items ORDER BY position').all()).toEqual([{ state: 'done' }, { state: 'failed' }]);
  expect(db.prepare('SELECT bytes FROM assets WHERE id = ?').get(A)).toEqual({ bytes: 10 });
  // idempotent: a second run imports nothing and changes nothing
  expect(importLegacyData(d)).toMatchObject({ films: 0, versions: 0, events: 0, ledger: 0, assets: 0, lineups: 0 });
  expect(db.prepare('SELECT COUNT(*) AS n FROM ledger').get()).toEqual({ n: 2 });
});

it('turns an old FileSaver checkpoint file into rows a SqliteSaver can resume', async () => {
  const { Annotation, END, MemorySaver, START, StateGraph } = await import('@langchain/langgraph');
  const { SqliteSaver } = await import('../crew/engine/sqlite-saver');
  const S = Annotation.Root({ n: Annotation<number>({ reducer: (_a, b) => b ?? 0, default: () => 0 }) });
  const make = (saver: BaseCheckpointSaver, stop: number) =>
    new StateGraph(S)
      .addNode('step', (s: typeof S.State) => ({ n: s.n + 1 }))
      .addEdge(START, 'step')
      .addConditionalEdges('step', (s: typeof S.State) => (s.n < stop ? 'step' : END))
      .compile({ checkpointer: saver });
  const mem = new MemorySaver();
  await make(mem, 3).invoke({}, { configurable: { thread_id: F } });
  // exactly what the removed FileSaver wrote
  const body = JSON.stringify({ storage: mem.storage, writes: mem.writes }, (_k, v) => (v instanceof Uint8Array ? { __lg_u8: Buffer.from(v).toString('base64') } : v));
  const d = legacy();
  w(join(d, 'films', F, 'crew', 'checkpoints', 'showrunner.json'), body);
  expect(importLegacyData(d).checkpoints).toBeGreaterThan(0);
  const resumed = await make(new SqliteSaver(getDb(d)), 5).invoke({}, { configurable: { thread_id: F } });
  expect(resumed.n).toBe(5);
});
