import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../server/env';
import { BASETEN_BASE_URL, BASETEN_MODEL, run } from './baseten-smoke';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

afterEach(() => {
  vi.unstubAllGlobals();
  process.exitCode = undefined;
});

describe('baseten-smoke', () => {
  it('sends the hackathon model with the key as a bearer token and never logs the key', async () => {
    const calls: Array<{ url: string; auth: string; model: string }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { model: string; tools?: unknown };
      calls.push({ url, auth: (init.headers as Record<string, string>).Authorization!, model: body.model });
      if (body.tools)
        return reply(200, { choices: [{ message: { tool_calls: [{ function: { name: 'scaleLayer', arguments: '{"layerId":"s1:headline","factor":1.2}' } }] } }] });
      return reply(200, { choices: [{ message: { content: 'ready', reasoning_content: 'thinking' } }], usage: { prompt_tokens: 5, completion_tokens: 7 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const lines: string[] = [];
    await run({ env: loadEnv({ BASETEN_API_KEY: 'sk-secret-123' }), log: (l) => lines.push(l) });
    expect(calls.map((c) => c.url)).toEqual([`${BASETEN_BASE_URL}/chat/completions`, `${BASETEN_BASE_URL}/chat/completions`]);
    expect(calls.every((c) => c.model === BASETEN_MODEL && c.auth === 'Bearer sk-secret-123')).toBe(true);
    expect(lines.join('\n')).not.toContain('sk-secret-123');
    expect(lines[0]).toContain('plain ok');
    expect(lines[1]).toContain('call=scaleLayer');
    expect(process.exitCode).toBeUndefined();
  });

  it('explains a rejected key and stops after the first call', async () => {
    const fetchMock = vi.fn(async () => reply(401, { error: { message: 'bad key' } }));
    vi.stubGlobal('fetch', fetchMock);
    const lines: string[] = [];
    await run({ env: loadEnv({ BASETEN_API_KEY: 'k' }), log: (l) => lines.push(l) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lines[0]).toContain('key rejected');
    expect(process.exitCode).toBe(1);
  });

  it('makes no call when the key is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const lines: string[] = [];
    await run({ env: loadEnv({}), log: (l) => lines.push(l) });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lines[0]).toContain('BASETEN_API_KEY is not set');
    expect(process.exitCode).toBe(1);
  });
});
