import type { LlmBackend } from '@shared/ports';

export type FakeScriptEntry = { toolCalls?: Array<{ name: string; args: unknown }>; content?: string };

/** Scripted LlmBackend: each call consumes one entry; when exhausted it answers DONE with no tool calls. */
export function makeFakeBackend(script: FakeScriptEntry[]): LlmBackend & { turns: number } {
  const queue = [...script];
  const backend: LlmBackend & { turns: number } = {
    id: 'spark',
    turns: 0,
    async chatWithTools() {
      const turn = backend.turns++;
      const entry = queue.shift();
      if (!entry) return { toolCalls: [], content: 'DONE', ms: 0 };
      return {
        toolCalls: (entry.toolCalls ?? []).map((c, i) => ({ id: `call_${turn}_${i}`, name: c.name, args: c.args })),
        ...(entry.content !== undefined ? { content: entry.content } : {}),
        ms: 0,
      };
    },
  };
  return backend;
}
