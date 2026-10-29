import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@shared/ports';
import { LOCAL_EDIT_ADDENDUM, toOllamaMessages } from './messages';

const convo: ChatMessage[] = [
  { role: 'system', content: 'You edit films.' },
  { role: 'user', content: 'Make it bigger' },
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      { id: 'glimmer-0-0', type: 'function', function: { name: 'addScene', arguments: '{"id":"s1"}' } },
      { id: 'glimmer-0-1', type: 'function', function: { name: 'addLayer', arguments: '{"sceneId":"s1"}' } },
    ],
  },
  { role: 'tool', tool_call_id: 'glimmer-0-0', content: '{"ok":true}' },
  { role: 'tool', tool_call_id: 'glimmer-0-1', content: '{"ok":true}' },
];

describe('toOllamaMessages', () => {
  it('matches tool results to their calls by name, with object arguments', () => {
    const out = toOllamaMessages(convo);
    expect(out).toHaveLength(5);
    expect(out.filter((m) => m.role === 'tool').map((m) => (m as { tool_name: string }).tool_name)).toEqual(['addScene', 'addLayer']);
    const assistant = out[2] as { tool_calls: Array<{ function: { arguments: unknown } }> };
    expect(typeof assistant.tool_calls[0]!.function.arguments).toBe('object');
  });

  it('falls back to call order when ids are missing', () => {
    const noIds = convo.map((m) => (m.role === 'tool' ? { ...m, tool_call_id: undefined } : m));
    expect(toOllamaMessages(noIds).filter((m) => m.role === 'tool').map((m) => (m as { tool_name: string }).tool_name)).toEqual(['addScene', 'addLayer']);
  });

  it('adds the local rules only for edits', () => {
    expect((toOllamaMessages(convo, { task: 'edit' })[0] as { content: string }).content.endsWith(LOCAL_EDIT_ADDENDUM)).toBe(true);
    expect((toOllamaMessages(convo, { task: 'storyboard' })[0] as { content: string }).content).toBe('You edit films.');
  });

  it('adds the parallel sentence once', () => {
    const sys = (toOllamaMessages(convo, { task: 'edit', parallelHint: true })[0] as { content: string }).content;
    expect(sys.split('You may call several tools in one turn.')).toHaveLength(2);
  });
});
