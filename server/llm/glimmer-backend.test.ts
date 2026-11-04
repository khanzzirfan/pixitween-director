import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ChatMessage } from '@shared/ports';
import type { ToolDef } from '@shared/tools';
import { loadTranscript, toOllamaResponse } from '../../fixtures/s09/transcripts';
import { makeGlimmerBackend } from './glimmer-backend';
import { GlimmerError } from './glimmer/errors';
import { startMockOllama, type MockOllama } from './glimmer/mock-server';

const MODEL = 'muse-glimmer:30b-mlx';
const tools: ToolDef[] = [{ name: 'addScene', description: 'add', params: z.object({ id: z.string() }), run: async () => ({ ok: true }) }];
let mock: MockOllama | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
  vi.restoreAllMocks();
});

const replies = (name: 'scene' | 'edit-1') => loadTranscript(name).map((t) => ({ body: toOllamaResponse(t) }));
const user: ChatMessage[] = [{ role: 'system', content: 's' }, { role: 'user', content: 'go' }];
const assistantWith = (n: number): ChatMessage => ({
  role: 'assistant', content: null,
  tool_calls: Array.from({ length: n }, (_, i) => ({ id: `glimmer-0-${i}`, type: 'function' as const, function: { name: 'addScene', arguments: '{"id":"s"}' } })),
});
const results = (...bodies: string[]): ChatMessage[] => bodies.map((content, i) => ({ role: 'tool' as const, tool_call_id: `glimmer-0-${i}`, content }));

describe('makeGlimmerBackend', () => {
  it('drives the scene transcript and sends the documented request', async () => {
    mock = await startMockOllama(replies('scene'));
    const b = makeGlimmerBackend({ baseUrl: mock.baseUrl, model: MODEL });
    expect(b.id).toBe('glimmer');
    const got: Array<{ n: number; ms: number; content?: string }> = [];
    let convo = [...user];
    for (let i = 0; i < 4; i++) {
      const r = await b.chatWithTools(convo, tools);
      got.push({ n: r.toolCalls.length, ms: r.ms, content: r.content });
      convo = [...convo, assistantWith(r.toolCalls.length)];
    }
    expect(got.map((g) => g.n)).toEqual([1, 3, 2, 0]);
    expect(got.map((g) => g.ms)).toEqual([17004, 20788, 24309, 4065]);
    expect(got[3]!.content).toBe('DONE');
    for (const r of mock.requests) {
      expect(r.path).toBe('/api/chat');
      expect(r.body).toMatchObject({ model: MODEL, think: false, stream: false, keep_alive: '30m' });
      expect((r.body.tools as Array<{ type: string }>)[0]!.type).toBe('function');
      expect(r.body).not.toHaveProperty('response_format');
      expect(r.body).not.toHaveProperty('options');
    }
  });

  it('sends num_ctx only when asked', async () => {
    mock = await startMockOllama(replies('edit-1'));
    await makeGlimmerBackend({ baseUrl: mock.baseUrl, model: MODEL, numCtx: 8192 }).chatWithTools(user, tools);
    expect(mock.requests[0]!.body.options).toEqual({ num_ctx: 8192 });
  });

  it('maps failures to typed errors', async () => {
    mock = await startMockOllama([
      { status: 404, body: { error: "model 'x' not found" } },
      { status: 500, body: 'parse Glimmer call to addLayer: missing ATEM function_calls wrapper' },
    ]);
    const b = makeGlimmerBackend({ baseUrl: mock.baseUrl, model: MODEL });
    await expect(b.chatWithTools(user, tools)).rejects.toMatchObject({ code: 'model-missing' });
    await expect(b.chatWithTools(user, tools)).rejects.toMatchObject({ code: 'tool-parse' });
    await mock.close();
    mock = undefined;
    await expect(makeGlimmerBackend({ baseUrl: 'http://127.0.0.1:1', model: MODEL }).chatWithTools(user, tools)).rejects.toMatchObject({ code: 'unreachable' });
  });

  describe('closing turn', () => {
    const afterTools = (...bodies: string[]) => [...user, assistantWith(bodies.length), ...results(...bodies)];

    it('skips the request when every result is ok', async () => {
      mock = await startMockOllama(replies('edit-1'));
      const b = makeGlimmerBackend({ baseUrl: mock.baseUrl, model: MODEL, skipClosingTurn: true });
      const first = await b.chatWithTools(user, tools);
      expect(first.toolCalls).toHaveLength(2);
      const second = await b.chatWithTools(afterTools('{"ok":true}', '{"ok":true}'), tools);
      expect(second).toMatchObject({ content: 'DONE', skipped: true, toolCalls: [] });
      expect(mock.requests).toHaveLength(1);
    });

    it('still asks the model when a result failed, or when skipping is off', async () => {
      mock = await startMockOllama(replies('edit-1'));
      const b = makeGlimmerBackend({ baseUrl: mock.baseUrl, model: MODEL, skipClosingTurn: true });
      await b.chatWithTools(user, tools);
      await b.chatWithTools(afterTools('{"ok":true}', '{"ok":false,"error":"x"}'), tools);
      expect(mock.requests).toHaveLength(2);

      await mock.close();
      mock = await startMockOllama(replies('edit-1'));
      const off = makeGlimmerBackend({ baseUrl: mock.baseUrl, model: MODEL });
      await off.chatWithTools(afterTools('{"ok":true}'), tools);
      expect(mock.requests).toHaveLength(1);
    });
  });

  it('runs requests one at a time and a failure does not block the next', async () => {
    mock = await startMockOllama([
      { body: toOllamaResponse({ ms: 1, status: 200, calls: [], content: 'a' }), delayMs: 50 },
      { status: 500, body: { error: 'boom' } },
      { body: toOllamaResponse({ ms: 1, status: 200, calls: [], content: 'c' }) },
    ]);
    const b = makeGlimmerBackend({ baseUrl: mock.baseUrl, model: MODEL });
    const [a, bad, c] = await Promise.allSettled([b.chatWithTools(user, tools), b.chatWithTools(user, tools), b.chatWithTools(user, tools)]);
    expect(a.status).toBe('fulfilled');
    expect(bad.status).toBe('rejected');
    expect(c.status).toBe('fulfilled');
    expect(mock.requests[1]!.at).toBeGreaterThanOrEqual(mock.repliedAt[0]! - 5);
  });

  it('warns when the prompt looks truncated', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const big: ChatMessage[] = [{ role: 'user', content: 'x'.repeat(4000) }];
    const turn = (count: number) => ({ body: { ...toOllamaResponse({ ms: 1, status: 200, calls: [], content: '' }), prompt_eval_count: count } });
    mock = await startMockOllama([turn(10), turn(1000)]);
    const onWarning = vi.fn();
    const b = makeGlimmerBackend({ baseUrl: mock.baseUrl, model: MODEL, onWarning });
    await b.chatWithTools(big, tools);
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('context truncation suspected'));
    onWarning.mockClear();
    await b.chatWithTools(big, tools);
    expect(onWarning).not.toHaveBeenCalled();
  });

  describe('chatJson', () => {
    it('sends format, not response_format, and returns the parsed object', async () => {
      mock = await startMockOllama([{ body: { message: { role: 'assistant', content: '{"pass":true}' } } }]);
      const schema = { type: 'object', properties: { pass: { type: 'boolean' } } };
      const out = await makeGlimmerBackend({ baseUrl: mock.baseUrl, model: MODEL }).chatJson(user, schema);
      expect(out).toEqual({ pass: true });
      expect(mock.requests[0]!.body).toMatchObject({ format: schema, think: false, stream: false });
      expect(mock.requests[0]!.body).not.toHaveProperty('response_format');
    });

    it('rejects non-JSON content', async () => {
      mock = await startMockOllama([{ body: { message: { role: 'assistant', content: '12s{' } } }]);
      const err = await makeGlimmerBackend({ baseUrl: mock.baseUrl, model: MODEL }).chatJson(user, {}).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(GlimmerError);
      expect((err as GlimmerError).code).toBe('invalid-json');
    });
  });
});
