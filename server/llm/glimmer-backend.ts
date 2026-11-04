// Owned by S9. Muse Glimmer through Ollama's native /api/chat (think off, tool calls as objects).
import type { ChatMessage, LlmBackend } from '@shared/ports';
import type { ToolDef } from '@shared/tools';
import { GlimmerError } from './glimmer/errors';
import { postChat } from './glimmer/http';
import { toOllamaMessages } from './glimmer/messages';
import { parseOllamaChat } from './glimmer/parse';
import { toOllamaTools } from './glimmer/schema';

export const STUB_OWNER = 'S9';

export type GlimmerTask = 'storyboard' | 'build' | 'edit' | 'review';

export interface GlimmerOptions {
  baseUrl: string;
  model: string;
  task?: GlimmerTask;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  keepAlive?: string;
  numCtx?: number;
  /** Skip the closing "DONE" turn when every tool result said ok (the router sets this for edits). */
  skipClosingTurn?: boolean;
  onWarning?: (message: string) => void;
}

export type GlimmerBackend = LlmBackend & {
  chatJson<T = unknown>(messages: ChatMessage[], schema: object, validate?: (v: unknown) => T): Promise<T>;
};

const allOk = (results: ChatMessage[]): boolean =>
  results.every((m) => {
    try {
      return (JSON.parse(String(m.content)) as { ok?: unknown }).ok === true;
    } catch {
      return false;
    }
  });

/** True when the conversation ends with tool results that all succeeded, so the model would only answer "DONE". */
function isClosingTurn(messages: ChatMessage[]): boolean {
  let i = messages.length;
  while (i > 0 && messages[i - 1]!.role === 'tool') i--;
  if (i === messages.length || i === 0) return false;
  const before = messages[i - 1]!;
  return before.role === 'assistant' && (before.tool_calls?.length ?? 0) > 0 && allOk(messages.slice(i));
}

export function makeGlimmerBackend(o: GlimmerOptions): GlimmerBackend {
  const conn = { baseUrl: o.baseUrl, fetchImpl: o.fetchImpl, timeoutMs: o.timeoutMs ?? 300000 };
  const keepAlive = o.keepAlive ?? '30m';
  let tail: Promise<unknown> = Promise.resolve(); // one request at a time: a 30B model on one machine gains nothing from overlap

  const queued = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = tail.then(fn);
    tail = p.catch(() => undefined);
    return p;
  };

  const warn = (m: string) => {
    console.warn(m);
    o.onWarning?.(m);
  };

  return {
    id: 'glimmer',

    chatWithTools(messages: ChatMessage[], tools: ToolDef[], opts) {
      return queued(async () => {
        if (o.skipClosingTurn && isClosingTurn(messages)) return { toolCalls: [], content: 'DONE', ms: 0, skipped: true } as Awaited<ReturnType<LlmBackend['chatWithTools']>>;

        const ollamaMessages = toOllamaMessages(messages, { task: o.task, parallelHint: opts?.parallelHint });
        const ollamaTools = toOllamaTools(tools);
        const body = {
          model: o.model,
          stream: false,
          think: false,
          keep_alive: keepAlive,
          messages: ollamaMessages,
          tools: ollamaTools,
          ...(o.numCtx ? { options: { num_ctx: o.numCtx } } : {}),
        };
        const { raw, wallMs } = await postChat(conn, body);
        const turn = messages.filter((m) => m.role === 'assistant').length;
        const parsed = parseOllamaChat(raw, { turn, wallMs });

        // a prompt that Ollama counted as much shorter than what we sent was probably cut to fit the context window
        const estimate = Math.round(JSON.stringify({ messages: ollamaMessages, tools: ollamaTools }).length / 4);
        if (parsed.usage.promptTokens !== undefined && parsed.usage.promptTokens < estimate * 0.6) {
          warn(`context truncation suspected (prompt_eval_count=${parsed.usage.promptTokens} estimate=${estimate})`);
        }
        return { toolCalls: parsed.toolCalls, content: parsed.content, ms: parsed.ms, usage: parsed.usage };
      });
    },

    chatJson<T>(messages: ChatMessage[], schema: object, validate?: (v: unknown) => T) {
      return queued(async () => {
        const { raw } = await postChat(conn, {
          model: o.model,
          stream: false,
          think: false,
          keep_alive: keepAlive,
          messages: toOllamaMessages(messages, { task: o.task }),
          format: schema,
          ...(o.numCtx ? { options: { num_ctx: o.numCtx } } : {}),
        });
        const content = (raw as { message?: { content?: unknown } }).message?.content;
        let value: unknown;
        try {
          value = JSON.parse(typeof content === 'string' ? content : '');
        } catch {
          throw new GlimmerError('invalid-json', undefined, 'Glimmer did not answer with JSON');
        }
        return validate ? validate(value) : (value as T);
      });
    },
  };
}
