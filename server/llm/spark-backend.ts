import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ChatMessage, LlmBackend, MetaClients, ToolSpec } from '@shared/ports';
import type { ToolDef } from '@shared/tools';

export const PARALLEL_HINT = 'You may call several tools in one turn. Prefer calling every tool needed for the whole step in a single turn.';

function toolSpec(def: ToolDef): ToolSpec {
  const { $schema: _drop, ...parameters } = zodToJsonSchema(def.params, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>;
  return { type: 'function', function: { name: def.name, description: def.description, parameters } };
}

function withHint(messages: ChatMessage[]): ChatMessage[] {
  const i = messages.findIndex((m) => m.role === 'system');
  if (i === -1) return [{ role: 'system', content: PARALLEL_HINT }, ...messages];
  const first = messages[i]!;
  const content = typeof first.content === 'string' ? `${first.content}\n\n${PARALLEL_HINT}` : [...(first.content ?? []), { type: 'text' as const, text: PARALLEL_HINT }];
  return messages.map((m, j) => (j === i ? { ...m, content } : m));
}

export function createSparkBackend(
  spark: MetaClients['spark'],
  o: { id?: LlmBackend['id']; maxTokens?: number } = {},
): LlmBackend {
  return {
    id: o.id ?? 'spark',
    async chatWithTools(messages, tools, opts) {
      const r = await spark.chat(
        {
          messages: opts?.parallelHint ? withHint(messages) : [...messages],
          tools: tools.map(toolSpec),
          tool_choice: 'auto',
          ...(o.maxTokens ? { max_tokens: o.maxTokens } : {}),
        },
        opts?.signal ? { signal: opts.signal } : undefined,
      );
      return { toolCalls: r.toolCalls, ...(r.content !== undefined ? { content: r.content } : {}), ms: r.ms, ...(r.usage ? { usage: r.usage } : {}) };
    },
  };
}
