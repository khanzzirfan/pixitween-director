import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Node 26 exposes a localStorage getter that is undefined unless --localstorage-file is set,
// and that getter blocks jsdom's storage. Give tests a memory store when the real one is missing.
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage?.setItem !== 'function') {
  const mem = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return mem.size;
    },
    clear: () => mem.clear(),
    getItem: (key) => (mem.has(key) ? mem.get(key)! : null),
    key: (index) => [...mem.keys()][index] ?? null,
    removeItem: (key) => {
      mem.delete(key);
    },
    setItem: (key, value) => {
      mem.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  if (typeof window !== 'undefined') Object.defineProperty(window, 'localStorage', { value: storage, configurable: true, writable: true });
}

afterEach(cleanup);

// jsdom has no canvas 2D context; lottie-web touches one at import time.
vi.mock('lottie-web', () => ({ default: { loadAnimation: vi.fn(), setQuality: vi.fn() } }));
// A test that runs in the node environment (the stored-film test reads data/films with node:fs)
// has no HTMLCanvasElement.
if (typeof HTMLCanvasElement !== 'undefined') HTMLCanvasElement.prototype.getContext = (() => null) as never;
