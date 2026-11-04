import { describe, expect, it } from 'vitest';
import type { ChatMessage, LlmBackend, ToolCall } from '@shared/ports';
import type { Scene } from '@shared/storyboard';
import type { ToolDef } from '@shared/tools';
import { addScene, newFilmComposition } from '../authoring/api';
import { makeTestFilm } from '../test-utils/film';
import { buildScene } from './build-scene';

const scene: Scene = { id: 's1', durationSec: 4, intent: 'hero', shotType: 'hero', camera: 'static', layersWanted: ['bg'], mode: 'motion', modeReason: 'r' };
const base = { scene, canvas: { width: 1920, height: 1080, aspect: '16:9' as const }, palette: ['#111111'], product: { assetId: 'ast_' + '0'.repeat(32), width: 10, height: 10 } };

async function film() {
  const comp = addScene(newFilmComposition({ aspect: '16:9', title: 't', palette: ['#111111'] }), { id: 's1', durationSec: 4, mode: 'motion' });
  return makeTestFilm({ composition: comp });
}

/** Answers each turn from `turns`, and records the messages and tool names it was offered. */
function backend(turns: Array<Array<{ name: string; args: unknown }>>) {
  const sent: ChatMessage[][] = [];
  const offered: string[][] = [];
  const signals: Array<AbortSignal | undefined> = [];
  const queue = [...turns];
  let n = 0;
  const b: LlmBackend = {
    id: 'spark',
    async chatWithTools(messages, tools, opts) {
      sent.push(JSON.parse(JSON.stringify(messages)) as ChatMessage[]);
      offered.push(tools.map((t) => t.name));
      signals.push(opts?.signal);
      const calls = queue.shift() ?? [];
      const t = n++;
      return { toolCalls: calls.map((c, i): ToolCall => ({ id: `c${t}_${i}`, name: c.name, args: c.args })), ms: 1 };
    },
  };
  return { b, sent, offered, signals };
}
const layer = (i: number) => ({ name: 'addLayer', args: { sceneId: 's1', role: 'caption', kind: 'text', text: `t${i}` } });

describe('buildScene options', () => {
  it('extraSystem reaches the system message', async () => {
    const t = await film();
    const { b, sent } = backend([[layer(1)]]);
    await buildScene({ ...base, ctx: t.ctx, backend: b, extraSystem: 'STYLE BIBLE x' });
    expect(String(sent[0]![0]!.content)).toContain('STYLE BIBLE x');
  });

  it('a signal aborted after the first turn stops before the second model call', async () => {
    const t = await film();
    const ac = new AbortController();
    const { b, sent } = backend([[layer(1)], [layer(2)], [layer(3)]]);
    const wrapped: LlmBackend = {
      id: 'spark',
      async chatWithTools(...args) {
        const r = await b.chatWithTools(...args);
        ac.abort(); // the user's newer job arrives while this turn's calls are about to run
        return r;
      },
    };
    const r = await buildScene({ ...base, ctx: t.ctx, backend: wrapped, signal: ac.signal });
    expect(sent).toHaveLength(1);
    expect(r.aborted).toBe(true);
    expect(r.stalled).toBe(false);
  });

  it('an abort stops before the next tool call within a turn', async () => {
    const t = await film();
    const ac = new AbortController();
    const { b } = backend([[layer(1), layer(2), layer(3)]]);
    const ran: string[] = [];
    const r = await buildScene({
      ...base,
      ctx: t.ctx,
      backend: b,
      signal: ac.signal,
      run: async (_c, name) => {
        ran.push(name);
        ac.abort();
        return { ok: true };
      },
    });
    expect(ran).toHaveLength(1);
    expect(r.aborted).toBe(true);
  });

  it('passes the signal to the model call', async () => {
    const t = await film();
    const ac = new AbortController();
    const { b, signals } = backend([[layer(1)]]);
    await buildScene({ ...base, ctx: t.ctx, backend: b, signal: ac.signal, maxTurns: 1 });
    expect(signals[0]).toBe(ac.signal);
  });

  it('toolFilter replaces the edit-only filter, and run replaces runTool', async () => {
    const t = await film();
    const only = (tool: ToolDef) => tool.name === 'addLayer' || tool.name === 'removeLayer';
    const { b, offered } = backend([[layer(1)]]);
    const calls: string[] = [];
    await buildScene({ ...base, ctx: t.ctx, backend: b, toolFilter: only, run: async (_c, name) => (calls.push(name), { ok: true }), maxTurns: 1 });
    expect(offered[0]!.sort()).toEqual(['addLayer', 'removeLayer']);
    expect(calls).toEqual(['addLayer']);
  });

  it('with none of the options it still drops the edit-only tools and is not aborted', async () => {
    const t = await film();
    const { b, offered } = backend([[layer(1)]]);
    const r = await buildScene({ ...base, ctx: t.ctx, backend: b, maxTurns: 1 });
    expect(offered[0]).not.toContain('removeLayer');
    expect(offered[0]).toContain('addLayer');
    expect(r.aborted).toBeUndefined();
  });
});
