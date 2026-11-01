// Owned by S12a. The per-film inbox (design.md 5.6): a user item wakes the showrunner at once,
// job results are batched so four builders finishing together cost one turn.
import type { InboxItem } from '@shared/crew';

export interface InboxOptions {
  /** Wait after the last arrival before a batch of non-user items is delivered. */
  debounceMs: number;
  /** A batch is never held longer than this after its first arrival. */
  maxWaitMs?: number;
  now?: () => number;
}

export interface Inbox {
  push(item: InboxItem): void;
  /** Resolves with the next batch. Resolves with [] after close(). A second call while one is pending shares its promise. */
  drain(): Promise<InboxItem[]>;
  /** Items waiting for a drain. */
  size(): number;
  close(): void;
}

export function createInbox(opts: InboxOptions): Inbox {
  const maxWaitMs = opts.maxWaitMs ?? 5000;
  const now = opts.now ?? Date.now;
  let items: InboxItem[] = [];
  let firstAt = 0;
  let lastAt = 0;
  let closed = false;
  let waiting: { promise: Promise<InboxItem[]>; resolve: (v: InboxItem[]) => void } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const w = waiting;
    waiting = undefined;
    const batch = items;
    items = [];
    w?.resolve(batch);
  }

  function evaluate(): void {
    if (!waiting || !items.length) return;
    if (items.some((i) => i.from === 'user')) return flush();
    const delay = Math.min(lastAt + opts.debounceMs, firstAt + maxWaitMs) - now();
    if (delay <= 0) return flush();
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(evaluate, delay);
    timer.unref?.();
  }

  return {
    push(item) {
      if (closed) return;
      if (!items.length) firstAt = now();
      lastAt = now();
      items.push(item);
      evaluate();
    },
    drain() {
      if (closed) return Promise.resolve([]);
      if (!waiting) {
        let resolve!: (v: InboxItem[]) => void;
        const promise = new Promise<InboxItem[]>((r) => (resolve = r));
        waiting = { promise, resolve };
      }
      const promise = waiting.promise;
      evaluate();
      return promise;
    },
    size: () => items.length,
    close() {
      closed = true;
      flush();
    },
  };
}
