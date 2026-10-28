import { describe, expect, it, vi } from 'vitest';
import { DownloadError, downloadClip, redactUrl } from './download';

const URL_OK = 'https://cdn.example.test/out.mp4?sig=SECRET123';
const mp4 = (n = 2048) => {
  const b = Buffer.alloc(n);
  b.write('ftyp', 4, 'latin1');
  return b;
};
const resp = (body: Buffer | string, init: ResponseInit & { headers?: Record<string, string> } = {}) =>
  new Response(typeof body === 'string' ? body : new Uint8Array(body), { status: 200, ...init, headers: { 'content-type': 'video/mp4', ...init.headers } });
const fetchOf = (...rs: Array<Response | Error>) => {
  const f = vi.fn(async () => {
    const r = rs.shift()!;
    if (r instanceof Error) throw r;
    return r;
  });
  return f as unknown as typeof fetch & ReturnType<typeof vi.fn>;
};

describe('downloadClip', () => {
  it('returns a valid mp4', async () => {
    const body = mp4();
    expect(await downloadClip(URL_OK, { fetchImpl: fetchOf(resp(body)) })).toEqual(body);
  });

  it('rejects bad scheme, private host, content type, magic bytes and oversize', async () => {
    const ok = (r: Response, url = URL_OK, maxBytes?: number) => downloadClip(url, { fetchImpl: fetchOf(r), maxBytes });
    await expect(ok(resp(mp4()), 'http://cdn.example.test/a.mp4')).rejects.toBeInstanceOf(DownloadError);
    await expect(ok(resp(mp4()), 'https://10.0.0.1/a.mp4')).rejects.toBeInstanceOf(DownloadError);
    await expect(ok(resp(mp4(), { headers: { 'content-type': 'text/html' } }))).rejects.toBeInstanceOf(DownloadError);
    await expect(ok(resp(Buffer.alloc(2048)))).rejects.toBeInstanceOf(DownloadError);
    await expect(ok(resp(mp4(2000)), URL_OK, 1000)).rejects.toBeInstanceOf(DownloadError);
  });

  it('rejects on content-length without reading the body', async () => {
    const read = vi.fn();
    const body = new ReadableStream({ pull: () => { read(); } }, { highWaterMark: 0 });
    const r = new Response(body, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(300 * 1024 * 1024) } });
    await expect(downloadClip(URL_OK, { fetchImpl: fetchOf(r) })).rejects.toBeInstanceOf(DownloadError);
    expect(read).not.toHaveBeenCalled();
  });

  it('retries 5xx and network errors but not 4xx', async () => {
    const sleep = vi.fn(async () => undefined);
    const f1 = fetchOf(resp('', { status: 503 }), resp(mp4()));
    expect((await downloadClip(URL_OK, { fetchImpl: f1, sleep })).length).toBe(2048);
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(5000);

    const f2 = fetchOf(resp('', { status: 404 }));
    await expect(downloadClip(URL_OK, { fetchImpl: f2, sleep })).rejects.toMatchObject({ retryable: false });
    expect(f2).toHaveBeenCalledTimes(1);

    const f3 = fetchOf(resp('', { status: 503 }), resp('', { status: 503 }), resp('', { status: 503 }), resp('', { status: 503 }));
    await expect(downloadClip(URL_OK, { fetchImpl: f3, sleep })).rejects.toMatchObject({ retryable: true });
    expect(f3).toHaveBeenCalledTimes(4);
  });

  it('never leaks the query string and re-validates redirects', async () => {
    const err = await downloadClip(URL_OK, { fetchImpl: fetchOf(resp('', { status: 404 })) }).catch((e: Error) => e);
    expect((err as Error).message).toContain('cdn.example.test/out.mp4');
    expect((err as Error).message).not.toContain('SECRET123');
    const redirect = new Response(null, { status: 302, headers: { location: 'http://cdn.example.test/x.mp4?sig=SECRET123' } });
    const e2 = await downloadClip(URL_OK, { fetchImpl: fetchOf(redirect) }).catch((e: Error) => e);
    expect(e2).toBeInstanceOf(DownloadError);
    expect((e2 as Error).message).not.toContain('SECRET123');
  });

  it('redactUrl drops query and hash', () => {
    expect(redactUrl('https://a.test/p.mp4?x=1#h')).toBe('https://a.test/p.mp4');
  });
});
