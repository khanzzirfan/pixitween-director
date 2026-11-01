import { TTFLoader } from 'three/examples/jsm/loaders/TTFLoader.js';
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js';

// Typeface (JSON) loading with a per-url cache. The fetch is injectable so tests stay offline.

export type FontFetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer?(): Promise<ArrayBuffer> }>;

const cache = new Map<string, Promise<Font>>();

/** Load a typeface.json or .ttf font (by url extension); the same url is fetched once. A failed load is not cached. */
export function loadFont(url: string, fetchImpl: FontFetch = (u) => fetch(u)): Promise<Font> {
  let pending = cache.get(url);
  if (!pending) {
    pending = (async () => {
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`font ${url} failed to load (${response.status})`);
      if (/\.ttf(\?|#|$)/i.test(url)) {
        if (!response.arrayBuffer) throw new Error(`font ${url}: response has no arrayBuffer()`);
        return new FontLoader().parse(new TTFLoader().parse(await response.arrayBuffer()) as never);
      }
      return new FontLoader().parse((await response.json()) as never);
    })();
    cache.set(url, pending);
    pending.catch(() => {
      if (cache.get(url) === pending) cache.delete(url);
    });
  }
  return pending;
}

export function clearFontCache(): void {
  cache.clear();
}
