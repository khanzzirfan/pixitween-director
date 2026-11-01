import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { clearFontCache, loadFont } from './font';

const data = JSON.parse(readFileSync(resolve(process.cwd(), 'web/public/fonts/helvetiker_bold.typeface.json'), 'utf8'));
const makeFetch = () => vi.fn(async () => ({ ok: true, status: 200, json: async () => data }));

describe('loadFont', () => {
  it('fetches a url once until the cache is cleared', async () => {
    clearFontCache();
    const fetchImpl = makeFetch();
    const a = await loadFont('/f.json', fetchImpl);
    const b = await loadFont('/f.json', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    clearFontCache();
    await loadFont('/f.json', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed load', async () => {
    clearFontCache();
    const bad = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    await expect(loadFont('/x.json', bad)).rejects.toThrow('404');
    await expect(loadFont('/x.json', bad)).rejects.toThrow('404');
    expect(bad).toHaveBeenCalledTimes(2);
  });

  it('loads a .ttf through TTFLoader and still loads typeface.json', async () => {
    clearFontCache();
    const buf = readFileSync(resolve(process.cwd(), 'web/public/fonts/kenpixel.ttf'));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const ttf = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => ab }));
    const font = await loadFont('/x.ttf', ttf);
    expect(Object.keys(font.data.glyphs).length).toBeGreaterThan(0);
    const json = await loadFont('/y.typeface.json', makeFetch());
    expect(Object.keys(json.data.glyphs).length).toBeGreaterThan(0);
  });
});
