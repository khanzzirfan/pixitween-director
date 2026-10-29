import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { InboxItem } from '@shared/crew';
import { createInbox } from './inbox';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

let n = 0;
const item = (from: InboxItem['from'], text: string = from): InboxItem => ({ id: `i${++n}`, at: new Date().toISOString(), from, text });
/** A drain that records when it resolved, in ms after the test began. */
function watch(inbox: ReturnType<typeof createInbox>) {
  const t0 = Date.now();
  const out: { at?: number; items?: InboxItem[] } = {};
  void inbox.drain().then((items) => ((out.at = Date.now() - t0), (out.items = items)));
  return out;
}

it('delivers three job items together, 1500 ms after the third', async () => {
  const inbox = createInbox({ debounceMs: 1500 });
  const w = watch(inbox);
  for (let i = 0; i < 3; i++) {
    inbox.push(item('job'));
    if (i < 2) await vi.advanceTimersByTimeAsync(200);
  }
  await vi.advanceTimersByTimeAsync(1499);
  expect(w.items).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(w.items).toHaveLength(3);
  expect(w.at).toBe(400 + 1500);
});

it('a user item resolves a pending drain at once, with the job items already queued', async () => {
  const inbox = createInbox({ debounceMs: 1500 });
  inbox.push(item('job'));
  const w = watch(inbox);
  await vi.advanceTimersByTimeAsync(100);
  expect(w.items).toBeUndefined();
  inbox.push(item('user'));
  await vi.advanceTimersByTimeAsync(0);
  expect(w.items?.map((i) => i.from)).toEqual(['job', 'user']);
  expect(w.at).toBe(100);
});

it('a drain called when a user item is already waiting resolves without a timer', async () => {
  const inbox = createInbox({ debounceMs: 1500 });
  inbox.push(item('user'));
  const w = watch(inbox);
  await vi.advanceTimersByTimeAsync(0);
  expect(w.at).toBe(0);
});

it('a steady trickle is delivered no later than 5000 ms after the first item', async () => {
  const inbox = createInbox({ debounceMs: 1500 });
  const w = watch(inbox);
  for (let s = 0; s < 10; s++) {
    inbox.push(item('job'));
    await vi.advanceTimersByTimeAsync(1000);
  }
  expect(w.at).toBe(5000);
  expect(w.items!.length).toBe(5);
});

it('items that arrive after a delivery go to the next drain', async () => {
  const inbox = createInbox({ debounceMs: 100 });
  inbox.push(item('job', 'first'));
  const first = watch(inbox);
  await vi.advanceTimersByTimeAsync(100);
  expect(first.items?.map((i) => i.text)).toEqual(['first']);
  inbox.push(item('job', 'second'));
  const second = watch(inbox);
  await vi.advanceTimersByTimeAsync(100);
  expect(second.items?.map((i) => i.text)).toEqual(['second']);
});

it('a drain with nothing waiting stays pending until something arrives', async () => {
  const inbox = createInbox({ debounceMs: 100 });
  const w = watch(inbox);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(w.items).toBeUndefined();
  inbox.push(item('critic'));
  await vi.advanceTimersByTimeAsync(100);
  expect(w.items).toHaveLength(1);
});

it('close() releases a pending drain with nothing and ignores later pushes', async () => {
  const inbox = createInbox({ debounceMs: 100 });
  const w = watch(inbox);
  inbox.close();
  await vi.advanceTimersByTimeAsync(0);
  expect(w.items).toEqual([]);
  inbox.push(item('user'));
  expect(inbox.size()).toBe(0);
  expect(await inbox.drain()).toEqual([]);
});
