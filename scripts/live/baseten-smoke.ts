import type { LiveScript } from './run';

export const BASETEN_BASE_URL = 'https://inference.baseten.co/v1';
// The hackathon key only works with this model, not the docs' `meta-models/muse-spark-open`.
export const BASETEN_MODEL = 'meta-models/muse-spark-open-1026';

export const describe: LiveScript['describe'] = () =>
  `Two small calls to ${BASETEN_MODEL} on Baseten: a plain reply, then a tool call (the shape the edit backend will need). The key is read from the environment and never printed.`;

export const estimateUsd: LiveScript['estimateUsd'] = () => 0.01;

interface ChatResponse {
  choices?: Array<{
    message?: { content?: string | null; reasoning_content?: string | null; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

async function chat(key: string, body: Record<string, unknown>): Promise<{ status: number; ms: number; json: ChatResponse }> {
  const t0 = Date.now();
  const res = await fetch(`${BASETEN_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: BASETEN_MODEL, ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as ChatResponse;
  return { status: res.status, ms: Date.now() - t0, json };
}

const usageOf = (r: ChatResponse) => `${r.usage?.prompt_tokens ?? '?'}+${r.usage?.completion_tokens ?? '?'} tokens`;

export const run: LiveScript['run'] = async ({ env, log }) => {
  const key = env.BASETEN_API_KEY;
  if (!key) {
    log('BASETEN_API_KEY is not set. Put it in .env.dev or .env (both are gitignored) and run again.');
    process.exitCode = 1;
    return;
  }

  const plain = await chat(key, { messages: [{ role: 'user', content: 'Reply with the single word: ready' }], max_tokens: 512 });
  if (plain.status !== 200) {
    const hint = plain.status === 401 ? ' (key rejected: wrong or revoked)' : plain.status === 404 ? ' (model not found: check the model name)' : '';
    log(`plain FAILED status ${plain.status}${hint} ${plain.json.error?.message ?? ''} ${plain.ms}ms`);
    process.exitCode = 1;
    return;
  }
  const msg = plain.json.choices?.[0]?.message;
  log(`plain ok ${plain.ms}ms ${usageOf(plain.json)} reasoning=${msg?.reasoning_content ? 'yes' : 'no'} reply=${JSON.stringify((msg?.content ?? '').trim().slice(0, 80))}`);

  const tool = await chat(key, {
    messages: [{ role: 'user', content: 'Make the headline bigger. Use the tool.' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'scaleLayer',
          description: 'Scale a layer by a factor',
          parameters: {
            type: 'object',
            properties: { layerId: { type: 'string' }, factor: { type: 'number' } },
            required: ['layerId', 'factor'],
          },
        },
      },
    ],
    tool_choice: 'auto',
    max_tokens: 1024,
  });
  const call = tool.json.choices?.[0]?.message?.tool_calls?.[0]?.function;
  if (tool.status === 200 && call?.name) log(`tool ok ${tool.ms}ms ${usageOf(tool.json)} call=${call.name}(${(call.arguments ?? '').slice(0, 80)})`);
  else {
    log(`tool FAILED status ${tool.status} finish=${tool.json.choices?.[0]?.finish_reason ?? '?'} ${tool.json.error?.message ?? 'no tool call returned'} ${tool.ms}ms`);
    process.exitCode = 1;
  }
};
