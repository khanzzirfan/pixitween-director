import { describe, expect, it } from 'vitest';
import { loadTranscript, parseCallSummary, toOllamaResponse } from './transcripts';

describe('transcripts', () => {
  it('loads both seed transcripts', () => {
    const scene = loadTranscript('scene');
    expect(scene.map((t) => t.calls.length)).toEqual([1, 3, 2, 0]);
    expect(scene.map((t) => t.ms)).toEqual([17004, 20788, 24309, 4065]);
    expect(loadTranscript('edit-1').map((t) => t.calls.length)).toEqual([2, 0]);
  });

  it('parses a call summary', () => {
    const c = parseCallSummary('setKeyframes({"layerId":"mug","property":"scale","keys":[[0,1],[6,1.25]],"ease":"easeInOut"})');
    expect(c.name).toBe('setKeyframes');
    expect(c.args.keys).toEqual([[0, 1], [6, 1.25]]);
  });

  it('builds the documented response shape', () => {
    const last = toOllamaResponse(loadTranscript('scene').at(-1)!);
    expect(last.message.content).toBe('DONE');
    expect(last.message).not.toHaveProperty('tool_calls');
    expect(last.done).toBe(true);
    expect(last.total_duration).toBe(4065000000);
    const first = toOllamaResponse(loadTranscript('edit-1')[0]!);
    expect(first.message.tool_calls).toHaveLength(2);
    expect(typeof first.message.tool_calls![0]!.function.arguments).toBe('object');
  });
});
