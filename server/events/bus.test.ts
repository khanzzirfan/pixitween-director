import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { makeEvent, type EventEnvelope } from '@shared/events';
import { createEventBus } from './bus';
import { readEvents } from './log';

const A = 'film_aaaaaaaaaaaa';
const B = 'film_bbbbbbbbbbbb';
const tmp = () => mkdtempSync(join(tmpdir(), 'bus-'));
const status = (id: string) => makeEvent(id, { type: 'film.status', status: 'planning' });

it('increments seq from 1', async () => {
  const bus = createEventBus(tmp());
  expect(await bus.emit(A, status(A))).toBe(1);
  expect(await bus.emit(A, status(A))).toBe(2);
});

it('20 concurrent emits give seq 1..20 in order with no duplicates', async () => {
  const bus = createEventBus(tmp());
  const seqs = await Promise.all(Array.from({ length: 20 }, () => bus.emit(A, status(A))));
  expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
});

it('replay returns only seq > after', async () => {
  const bus = createEventBus(tmp());
  for (let i = 0; i < 8; i++) await bus.emit(A, status(A));
  expect((await bus.replay(A, 5)).map((e) => e.seq)).toEqual([6, 7, 8]);
});

it('unsubscribe stops delivery and films are isolated', async () => {
  const bus = createEventBus(tmp());
  const got: EventEnvelope[] = [];
  const off = bus.subscribe(A, (e) => got.push(e));
  await bus.emit(A, status(A));
  await bus.emit(B, status(B));
  expect(got).toHaveLength(1);
  off();
  await bus.emit(A, status(A));
  expect(got).toHaveLength(1);
});

it('keeps seq gapless under concurrent emits and replays after a seq', async () => {
  const dir = tmp();
  const bus = createEventBus(dir);
  const seqs = await Promise.all([1, 2, 3, 4, 5].map(() => bus.emit(A, status(A))));
  expect([...seqs].sort()).toEqual([1, 2, 3, 4, 5]);
  expect((await readEvents(dir, A, 3)).map((e) => e.seq)).toEqual([4, 5]);
  expect(await readEvents(dir, B)).toEqual([]);
});

it('survives a new bus over the same dir (restart)', async () => {
  const dir = tmp();
  await createEventBus(dir).emit(A, status(A));
  expect(await createEventBus(dir).emit(A, status(A))).toBe(2);
});

it('rejects an invalid event', async () => {
  const bus = createEventBus(tmp());
  await expect(bus.emit(A, { type: 'nope' } as never)).rejects.toThrow();
});
