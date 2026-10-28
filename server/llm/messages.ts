import type { ChatMessage, ToolCall } from '@shared/ports';

export function assistantMessageFrom(result: { content?: string; toolCalls: ToolCall[] }): ChatMessage {
  return {
    role: 'assistant',
    content: result.content ?? null,
    ...(result.toolCalls.length
      ? { tool_calls: result.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
      : {}),
  };
}

export function toolResultMessage(call: ToolCall, result: unknown): ChatMessage {
  return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) };
}
