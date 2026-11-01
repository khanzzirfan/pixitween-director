// Rebuilds raw Ollama /api/chat responses from the S1 per-turn summaries in fixtures/seed, so backend tests replay real shapes without a model.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type TranscriptTurn = { ms: number; status: number; calls: string[]; content: string };

// tests and scripts run from the repository root (the fixture tests run under jsdom, where import.meta.url is not a file URL)
const SEED = join(process.cwd(), 'fixtures', 'seed');

/** 'name({"a":1})' -> { name, args }. The name is the text before the first '(', the args the JSON up to the last ')'. */
export function parseCallSummary(s: string): { name: string; args: Record<string, unknown> } {
  const open = s.indexOf('(');
  const close = s.lastIndexOf(')');
  return { name: s.slice(0, open), args: JSON.parse(s.slice(open + 1, close)) as Record<string, unknown> };
}

export function loadTranscript(name: 'scene' | 'edit-1'): TranscriptTurn[] {
  const file = name === 'scene' ? 'glimmer-scene-turns.json' : 'glimmer-edit-1-turns.json';
  return JSON.parse(readFileSync(join(SEED, file), 'utf8')) as TranscriptTurn[];
}

/** The size and eval figures are shape-only sample values from the S1 throughput sample, not measurements of any run. */
export function toOllamaResponse(turn: TranscriptTurn, model = 'muse-glimmer:30b-mlx') {
  const calls = turn.calls.map(parseCallSummary);
  return {
    model,
    created_at: '2026-10-27T00:00:00Z',
    message: {
      role: 'assistant',
      content: turn.content,
      ...(calls.length ? { tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: c.args } })) } : {}),
    },
    done: true,
    done_reason: 'stop',
    total_duration: turn.ms * 1e6,
    load_duration: 10000000,
    prompt_eval_count: 71,
    prompt_eval_duration: 590000000,
    eval_count: 104,
    eval_duration: 4900000000,
  };
}
