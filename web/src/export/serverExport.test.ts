import { describe, expect, it, vi } from 'vitest';
import { checkMp4OnServer, exportMp4ViaServer, NO_FFMPEG_MESSAGE } from './serverExport';

const canvas = { width: 64, height: 64 } as HTMLCanvasElement;
const driver = () => ({ play: vi.fn(), pause: vi.fn(), seek: vi.fn(), getTime: vi.fn(() => 0) });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const deps = (fetchImpl: typeof fetch) => ({ fetch: fetchImpl, settle: async () => undefined, toJpeg: async () => new Blob(['jpg']) });

describe('exportMp4ViaServer', () => {
  it('starts once, PUTs every frame as image/jpeg with at most 4 in flight, then finishes', async () => {
    let live = 0;
    let peak = 0;
    const log: string[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      log.push(`${init?.method} ${url}`);
      if (url === '/api/exports') return json(201, { id: 'abc' });
      if (url.endsWith('/finish')) return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'x-export-problems': '["frames 5, expected 6"]' } });
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      expect((init?.headers as Record<string, string>)['content-type']).toBe('image/jpeg');
      return new Response(null, { status: 204 });
    });
    const r = await exportMp4ViaServer({ canvas, driver: driver(), durationSec: 1, fps: 6 }, deps(f as never));
    expect(log.filter((l) => l.startsWith('POST /api/exports abc') || l === 'POST /api/exports')).toHaveLength(1);
    expect(log.filter((l) => l.startsWith('PUT'))).toHaveLength(6);
    expect(log.at(-1)).toBe('POST /api/exports/abc/finish');
    expect(peak).toBeLessThanOrEqual(4);
    expect(r.problems).toEqual(['frames 5, expected 6']);
    expect(r.blob.type).toBe('video/mp4');
    expect(r.blob.size).toBe(3);
  });

  it('turns a 503 on start into the unsupported error', async () => {
    const f = vi.fn(async () => json(503, { error: 'ffmpeg_missing' }));
    await expect(exportMp4ViaServer({ canvas, driver: driver(), durationSec: 1, fps: 6 }, deps(f as never))).rejects.toMatchObject({ code: 'unsupported', message: NO_FFMPEG_MESSAGE });
  });

  it('stops when a frame upload fails', async () => {
    const f = vi.fn(async (url: string) => (url === '/api/exports' ? json(201, { id: 'abc' }) : json(413, { error: 'payload_too_large' })));
    await expect(exportMp4ViaServer({ canvas, driver: driver(), durationSec: 1, fps: 6 }, deps(f as never))).rejects.toBeTruthy();
  });
});

describe('checkMp4OnServer', () => {
  const want = { durationSec: 2, fps: 30, width: 64, height: 64 };
  it('returns [] on a 503 and the problems on a 200', async () => {
    expect(await checkMp4OnServer(new Blob(['x']), want, { fetch: (async () => json(503, { error: 'ffmpeg_missing' })) as never })).toEqual([]);
    expect(await checkMp4OnServer(new Blob(['x']), want, { fetch: (async () => json(200, { problems: ['size 1x1, expected 64x64'] })) as never })).toEqual(['size 1x1, expected 64x64']);
  });
});
