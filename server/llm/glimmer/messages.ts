import type { ChatMessage } from '@shared/ports';

export const LOCAL_EDIT_ADDENDUM =
  '(Local model rules) Make every change the user asks for in ONE turn by calling all the tools you need together. Do not explain. Do not call tools you do not need.\nTimes are seconds from the start of the scene. Scale is a fraction (1 = 100%). z is depth: larger = further from the camera, so the background has the largest z.';
const PARALLEL_SENTENCE = 'You may call several tools in one turn.';

export type OllamaMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string; images?: string[]; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> }
  | { role: 'tool'; tool_name: string; content: string };

const text = (c: ChatMessage['content']): string => (typeof c === 'string' ? c : (c ?? []).map((p) => (p.type === 'text' ? p.text : '')).join(''));

export function toOllamaMessages(messages: ChatMessage[], opts: { task?: 'storyboard' | 'build' | 'edit' | 'review'; parallelHint?: boolean } = {}): OllamaMessage[] {
  const out: OllamaMessage[] = [];
  const names = new Map<string, string>();
  let pending: string[] = []; // call names of the latest assistant turn not yet answered, for results without a usable id

  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls?.length) {
      pending = [];
      for (const c of m.tool_calls) {
        names.set(c.id, c.function.name);
        pending.push(c.function.name);
      }
      out.push({
        role: 'assistant',
        content: text(m.content),
        tool_calls: m.tool_calls.map((c) => ({ function: { name: c.function.name, arguments: JSON.parse(c.function.arguments || '{}') as Record<string, unknown> } })),
      });
    } else if (m.role === 'tool') {
      const byId = m.tool_call_id ? names.get(m.tool_call_id) : undefined;
      const name = byId ?? pending[0] ?? 'unknown';
      pending = pending.filter((_, i) => i > pending.indexOf(name) || pending.indexOf(name) === -1);
      out.push({ role: 'tool', tool_name: name, content: text(m.content) });
    } else {
      out.push({ role: m.role as 'system' | 'user' | 'assistant', content: text(m.content) });
    }
  }

  const extra = [opts.task === 'edit' ? LOCAL_EDIT_ADDENDUM : '', opts.parallelHint ? PARALLEL_SENTENCE : ''].filter(Boolean);
  if (extra.length) {
    const i = out.findIndex((m) => m.role === 'system');
    if (i === -1) out.unshift({ role: 'system', content: extra.join('\n') });
    else {
      const sys = out[i] as { content: string };
      const add = extra.filter((e) => !sys.content.includes(e));
      if (add.length) sys.content = `${sys.content}\n${add.join('\n')}`;
    }
  }
  return out;
}
