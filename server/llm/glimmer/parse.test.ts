import { describe, expect, it } from 'vitest';
import { loadTranscript, toOllamaResponse } from '../../../fixtures/s09/transcripts';
import type { GlimmerError } from './errors';
import { parseOllamaChat } from './parse';

const scene = loadTranscript('scene');

describe('parseOllamaChat', () => {
  it('numbers calls by turn and reads ms and content', () => {
    const r = parseOllamaChat(toOllamaResponse(scene[1]!), { turn: 1 });
    expect(r.toolCalls.map((c) => c.id)).toEqual(['glimmer-1-0', 'glimmer-1-1', 'glimmer-1-2']);
    expect(r.content).toBe('');
    expect(r.ms).toBe(20788);
  });

  it('reports usage', () => {
    const r = parseOllamaChat(toOllamaResponse(scene[0]!));
    expect(r.usage.tokPerSec).toBe(21.2);
    expect(r.usage.promptTokens).toBe(71);
  });

  it('accepts string arguments and rejects bad ones', () => {
    const raw = (args: unknown) => ({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'x', arguments: args } }] } });
    expect(parseOllamaChat(raw('{"a":1}')).toolCalls[0]!.args).toEqual({ a: 1 });
    try {
      parseOllamaChat(raw('{bad'));
      expect.unreachable();
    } catch (e) {
      expect((e as GlimmerError).code).toBe('tool-parse');
    }
  });

  it('throws without a message and falls back to wall time', () => {
    expect(() => parseOllamaChat({})).toThrow(expect.objectContaining({ code: 'http' }));
    expect(parseOllamaChat({ message: { content: 'x' } }, { wallMs: 1234 }).ms).toBe(1234);
  });
});
