import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ToolDef } from '@shared/tools';
import { ConfigError } from '../errors';
import { sendJson, startTestServer } from '../meta/test-server';
import { editCostUsd, isPriced } from '../agent/edit-cost';
import { createSparkOpenBackend, SPARK_OPEN_MAX_TOKENS, SPARK_OPEN_MODEL } from './spark-open-backend';

let srv: Awaited<ReturnType<typeof startTestServer>> | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
});

const scaleLayer: ToolDef = {
  name: 'scaleLayer',
  description: 'Scale a layer',
  params: z.object({ layerId: z.string(), factor: z.number() }),
  run: async () => ({ ok: true }),
};

describe('createSparkOpenBackend', () => {
  it('calls the hackathon model with the Baseten key and parses a reasoning model tool call', async () => {
    srv = await startTestServer((_r, res) =>
      sendJson(res, 200, {
        choices: [
          {
            message: {
              content: null,
              reasoning_content: 'thinking...',
              tool_calls: [{ id: 'c1', type: 'function', function: { name: 'scaleLayer', arguments: '{"layerId": "s1:headline", "factor": 1.5}' } }],
            },
          },
        ],
        usage: { prompt_tokens: 646, completion_tokens: 587 },
      }),
    );
    const backend = createSparkOpenBackend({ BASETEN_API_KEY: 'sk-baseten', META_MAX_INFLIGHT: 2 }, { baseUrl: srv.baseUrl });
    expect(backend.id).toBe('spark-open');
    const r = await backend.chatWithTools([{ role: 'user', content: 'bigger' }], [scaleLayer], { parallelHint: true });
    expect(r.toolCalls).toEqual([{ id: 'c1', name: 'scaleLayer', args: { layerId: 's1:headline', factor: 1.5 } }]);
    expect(r.usage).toEqual({ promptTokens: 646, completionTokens: 587 });

    const seen = srv.seen[0]!;
    expect(seen.url).toBe('/v1/chat/completions');
    expect(seen.headers.authorization).toBe('Bearer sk-baseten');
    const body = JSON.parse(seen.body);
    expect(body.model).toBe(SPARK_OPEN_MODEL);
    expect(body.max_tokens).toBe(SPARK_OPEN_MAX_TOKENS);
    expect(body.tools[0].function.name).toBe('scaleLayer');
  });

  it('refuses to start without a key and names the variable', () => {
    expect(() => createSparkOpenBackend({ BASETEN_API_KEY: undefined, META_MAX_INFLIGHT: 2 })).toThrow(ConfigError);
    expect(() => createSparkOpenBackend({ BASETEN_API_KEY: undefined, META_MAX_INFLIGHT: 2 })).toThrow(/BASETEN_API_KEY/);
  });

  it('surfaces a rejected key as an error that carries the status', async () => {
    srv = await startTestServer((_r, res) => sendJson(res, 401, { error: { message: 'bad key' } }));
    const backend = createSparkOpenBackend({ BASETEN_API_KEY: 'nope', META_MAX_INFLIGHT: 2 }, { baseUrl: srv.baseUrl });
    await expect(backend.chatWithTools([{ role: 'user', content: 'x' }], [])).rejects.toMatchObject({ status: 401 });
  });
});

describe('edit cost', () => {
  it('prices the Baseten model at zero while credits cover it, so the edit is still recorded', () => {
    expect(isPriced(SPARK_OPEN_MODEL)).toBe(true);
    expect(editCostUsd(SPARK_OPEN_MODEL, { prompt_tokens: 646, completion_tokens: 587 })).toBe(0);
  });
});
