import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@shared/tools';
import { inScope, scopedRunTool } from './scope';

const ctx = {} as ToolCtx;

describe('scopedRunTool', () => {
  it('refuses a layer of another scene with the exact message, and runs nothing', async () => {
    const run = vi.fn(async () => ({ ok: true as const }));
    const r = await scopedRunTool('s2', run)(ctx, 'setText', { layerId: 's1:headline', text: 'x' });
    expect(r).toEqual({ ok: false, error: 'out of scope: this job owns scene s2 only' });
    expect(run).not.toHaveBeenCalled();
  });

  it('lets a call on its own scene reach the runner once', async () => {
    const run = vi.fn(async () => ({ ok: true as const }));
    await scopedRunTool('s2', run)(ctx, 'addLayer', { sceneId: 's2', role: 'bg', kind: 'shape' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('allows a tool with neither a sceneId nor a layerId', async () => {
    const run = vi.fn(async () => ({ ok: true as const }));
    await scopedRunTool('s2', run)(ctx, 'getProductNoun', {});
    await scopedRunTool('s2', run)(ctx, 'anything', undefined);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('refuses another scene id and a layer id with a prefix that only looks similar', () => {
    expect(inScope('s2', 'setCamera', { sceneId: 's1', move: 'pan' })).toBe(false);
    expect(inScope('s2', 'setText', { layerId: 's22:headline' })).toBe(false);
    expect(inScope('s2', 'setText', { layerId: 's2:headline' })).toBe(true);
  });

  it('never allows structure changes, even on its own scene', async () => {
    const run = vi.fn(async () => ({ ok: true as const }));
    for (const name of ['removeScene', 'swapScenes', 'addScene']) expect((await scopedRunTool('s2', run)(ctx, name, { sceneId: 's2' })).ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
