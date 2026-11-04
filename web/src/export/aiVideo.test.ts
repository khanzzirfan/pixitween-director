import { describe, expect, it, vi } from 'vitest';
import type { AiVideoJob } from '@shared/api';
import { AiVideoError, fetchAiVideoQuote, pollAiVideo, startAiVideo } from './aiVideo';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const job = (o: Partial<AiVideoJob> = {}): AiVideoJob => ({ id: 'vid_1', filmId: 'film_aaaaaaaaaaaa', status: 'queued', resolution: '480P', durationSec: 6, costUsd: 0.3, ...o });

describe('quote and start', () => {
  it('asks for the quote of one resolution and starts with a JSON body', async () => {
    const f = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => (String(input).includes('/quote') ? json({ resolution: '768P', costUsd: 0.48 }) : json(job(), 202)));
    await fetchAiVideoQuote('film_aaaaaaaaaaaa', '768P', f as never);
    expect(f.mock.calls[0]![0]).toBe('/api/films/film_aaaaaaaaaaaa/ai-video/quote?resolution=768P');
    await startAiVideo('film_aaaaaaaaaaaa', '480P', f as never);
    const init = f.mock.calls[1]![1]!;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ resolution: '480P' });
  });

  it('turns a refusal into a message the owner can act on', async () => {
    const f = vi.fn(async () => json({ error: 'video_key_missing' }, 409));
    await expect(startAiVideo('film_aaaaaaaaaaaa', '480P', f as never)).rejects.toMatchObject({ message: 'Add your Fal key in Settings first.', code: 'video_key_missing' });
  });

  it("passes Fal's own message through", async () => {
    const f = vi.fn(async () => json({ error: 'http_error', message: 'Exhausted balance.' }, 403));
    await expect(startAiVideo('film_aaaaaaaaaaaa', '480P', f as never)).rejects.toThrow('Exhausted balance.');
  });
});

describe('pollAiVideo', () => {
  it('reports each view and stops at success', async () => {
    const views = [job({ status: 'queued' }), job({ status: 'running' }), job({ status: 'succeeded', videoUrl: '/x' })];
    const f = vi.fn(async () => json(views.shift()));
    const seen: string[] = [];
    const last = await pollAiVideo('vid_1', { onView: (v) => seen.push(v.status), intervalMs: 0, fetch: f as never });
    expect(seen).toEqual(['queued', 'running', 'succeeded']);
    expect(last.videoUrl).toBe('/x');
  });

  it('stops at a failed run too', async () => {
    const f = vi.fn(async () => json(job({ status: 'failed', error: 'no' })));
    expect((await pollAiVideo('vid_1', { onView: () => undefined, intervalMs: 0, fetch: f as never })).status).toBe('failed');
  });

  it('gives up on a lost server after five misses in a row, but rides out one', async () => {
    let n = 0;
    const flaky = vi.fn(async () => { if (++n === 1) throw new TypeError('network'); return json(job({ status: 'succeeded' })); });
    expect((await pollAiVideo('vid_1', { onView: () => undefined, intervalMs: 0, fetch: flaky as never })).status).toBe('succeeded');
    const dead = vi.fn(async () => { throw new TypeError('network'); });
    await expect(pollAiVideo('vid_1', { onView: () => undefined, intervalMs: 0, fetch: dead as never })).rejects.toThrow('network');
    expect(dead).toHaveBeenCalledTimes(5);
  });

  it('does not keep asking after a refusal', async () => {
    const f = vi.fn(async () => json({ error: 'video_key_missing' }, 409));
    await expect(pollAiVideo('vid_1', { onView: () => undefined, intervalMs: 0, fetch: f as never })).rejects.toBeInstanceOf(AiVideoError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('stops when told to', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(pollAiVideo('vid_1', { onView: () => undefined, signal: ctl.signal, fetch: vi.fn() as never })).rejects.toMatchObject({ code: 'aborted' });
  });
});
