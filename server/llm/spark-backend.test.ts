import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ChatMessage, ChatRequest, MetaClients } from '@shared/ports';
import type { ToolDef } from '@shared/tools';
import { assistantMessageFrom, toolResultMessage } from './messages';
import { PARALLEL_HINT, createSparkBackend } from './spark-backend';

const tool: ToolDef = {
  name: 'addScene',
  description: 'Add a scene',
  params: z.object({ id: z.string(), durationSec: z.number().min(2).max(8), mode: z.enum(['motion', 'generate']) }),
  run: async () => ({ ok: true }),
};

const fake = () => {
  const reqs: ChatRequest[] = [];
  const spark = {
    chat: async (req: ChatRequest) => (reqs.push(req), { toolCalls: [{ id: 'c1', name: 'addScene', args: { id: 's' } }], content: 'hi', ms: 5, model: 'm' }),
  } as unknown as MetaClients['spark'];
  return { reqs, backend: createSparkBackend(spark) };
};

it('converts zod tools to specs without $schema, keeping bounds and enums', async () => {
  const { reqs, backend } = fake();
  const r = await backend.chatWithTools([{ role: 'user', content: 'go' }], [tool]);
  const spec = reqs[0]!.tools![0]!;
  const params = spec.function.parameters as { properties: Record<string, Record<string, unknown>>; $schema?: unknown };
  expect(params.$schema).toBeUndefined();
  expect(params.properties.durationSec).toMatchObject({ minimum: 2, maximum: 8 });
  expect(params.properties.mode!.enum).toEqual(['motion', 'generate']);
  expect(reqs[0]!.tool_choice).toBe('auto');
  expect(r).toMatchObject({ content: 'hi', ms: 5, toolCalls: [{ name: 'addScene' }] });
});

it('appends the parallel hint once to the first system message, only when asked', async () => {
  const { reqs, backend } = fake();
  const messages: ChatMessage[] = [{ role: 'system', content: 'You are the director.' }, { role: 'user', content: 'go' }];
  const snapshot = JSON.stringify(messages);
  await backend.chatWithTools(messages, [tool], { parallelHint: true });
  await backend.chatWithTools(messages, [tool], { parallelHint: false });
  const sys = reqs[0]!.messages[0]!.content as string;
  expect(sys.endsWith(PARALLEL_HINT)).toBe(true);
  expect(sys.split(PARALLEL_HINT)).toHaveLength(2);
  expect(reqs[1]!.messages[0]!.content).toBe('You are the director.');
  expect(JSON.stringify(messages)).toBe(snapshot);
});

it('prepends a system message when there is none', async () => {
  const { reqs, backend } = fake();
  await backend.chatWithTools([{ role: 'user', content: 'go' }], [tool], { parallelHint: true });
  expect(reqs[0]!.messages[0]).toEqual({ role: 'system', content: PARALLEL_HINT });
  expect(reqs[0]!.messages).toHaveLength(2);
});

it('builds the OpenAI-shaped assistant and tool messages', () => {
  const call = { id: 'c1', name: 'addScene', args: { id: 's1' } };
  const a = assistantMessageFrom({ content: 'ok', toolCalls: [call] });
  expect(a.tool_calls![0]!.function.arguments).toBe('{"id":"s1"}');
  expect(assistantMessageFrom({ toolCalls: [] })).toEqual({ role: 'assistant', content: null });
  expect(toolResultMessage(call, { ok: true })).toEqual({ role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' });
});

it('passes the abort signal to chat() as an option, never in the request', async () => {
  const chat = vi.fn(async () => ({ toolCalls: [], ms: 1, model: 'm' }));
  const ac = new AbortController();
  await createSparkBackend({ chat } as unknown as MetaClients['spark']).chatWithTools([{ role: 'user', content: 'hi' }], [], { signal: ac.signal });
  const [req, opts] = chat.mock.calls[0] as unknown as [Record<string, unknown>, { signal?: AbortSignal }];
  expect(opts.signal).toBe(ac.signal);
  expect(JSON.stringify(req)).not.toContain('signal');
});
