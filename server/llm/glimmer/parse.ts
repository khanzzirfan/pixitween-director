import { GlimmerError } from './errors';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface ParsedChat {
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  content: string;
  ms: number;
  usage: { promptTokens?: number; outputTokens?: number; tokPerSec?: number };
  doneReason?: string;
}

/** Ollama's native /api/chat answer: arguments are an object, there is no call id, durations are nanoseconds. */
export function parseOllamaChat(raw: unknown, opts: { turn?: number; wallMs?: number } = {}): ParsedChat {
  if (!isObj(raw) || !isObj(raw.message)) throw new GlimmerError('http', undefined, 'response has no message');
  const message = raw.message;
  const turn = opts.turn ?? 0;

  const toolCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : []).map((c, i) => {
    const fn = isObj(c) && isObj(c.function) ? c.function : {};
    let args: unknown = fn.arguments ?? {};
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        throw new GlimmerError('tool-parse', undefined, `tool call '${String(fn.name)}' has arguments that are not JSON`);
      }
    }
    return { id: `glimmer-${turn}-${i}`, name: String(fn.name ?? ''), args: (isObj(args) ? args : {}) as Record<string, unknown> };
  });

  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const evalCount = num(raw.eval_count);
  const evalDuration = num(raw.eval_duration);
  const total = num(raw.total_duration);
  return {
    toolCalls,
    content: typeof message.content === 'string' ? message.content : '',
    ms: total !== undefined ? Math.round(total / 1e6) : (opts.wallMs ?? 0),
    usage: {
      ...(num(raw.prompt_eval_count) !== undefined ? { promptTokens: num(raw.prompt_eval_count) } : {}),
      ...(evalCount !== undefined ? { outputTokens: evalCount } : {}),
      ...(evalCount && evalDuration ? { tokPerSec: Math.round((evalCount / (evalDuration / 1e9)) * 10) / 10 } : {}),
    },
    ...(typeof raw.done_reason === 'string' ? { doneReason: raw.done_reason } : {}),
  };
}
