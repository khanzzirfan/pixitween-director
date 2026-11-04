import { describe, expect, it } from 'vitest';
import { addLayer, addScene, newFilmComposition, registerAsset } from '../authoring/api';
import type { Comp } from '../authoring/types';
import { runRulesCore } from './rules-core';

const TUB = 'ast_' + 'a'.repeat(32);
const BERRY = 'ast_' + 'b'.repeat(32);

/** A tall scene: the tub in the middle, and a berry picture drawn over it (or behind it) in `box`. */
function scene(berry: { x: number; y: number; w: number; h: number }, behind = false): Comp {
  let c = newFilmComposition({ aspect: '9:16', title: 'T', palette: ['#fff6e8'] });
  c = registerAsset(c, { id: TUB, kind: 'image', src: '/tub.png', width: 845, height: 948 });
  c = registerAsset(c, { id: BERRY, kind: 'image', src: '/berry.png', width: 106, height: 118 });
  c = addScene(c, { id: 's1', durationSec: 2, mode: 'motion', intent: 'hook' });
  c = addLayer(c, { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#f4c6d0' });
  c = addLayer(c, { sceneId: 's1', role: 'product', kind: 'image', assetId: TUB, box: { x: 240, y: 600, w: 600, h: 673 } });
  c = addLayer(c, { sceneId: 's1', role: 'subject', kind: 'image', assetId: BERRY, box: berry });
  // the role order draws a subject behind the product; the crew can raise it above, as it did in film_16f2214a45dd's hook
  if (behind) return c;
  const out = structuredClone(c) as Comp & { precomps: Record<string, { layers: Array<{ id: string }> }> };
  const layers = out.precomps.s1!.layers;
  const at = layers.findIndex((l) => l.id === 's1:subject');
  layers.push(...layers.splice(at, 1));
  return out;
}
const kinds = async (c: Comp) => (await runRulesCore(c as never)).findings.map((f) => f.kind);

describe('a picture over the product', () => {
  it('flags a berry scaled up over most of the tub', async () => {
    const r = await runRulesCore(scene({ x: 200, y: 550, w: 650, h: 720 }) as never);
    const f = r.findings.find((x) => x.kind === 'product-covered');
    expect(f?.layerId).toBe('s1:subject');
    expect(f?.severity).toBe('error');
  });

  it('lets a small berry falling past the tub, or a big one behind it, be', async () => {
    expect(await kinds(scene({ x: 60, y: 200, w: 120, h: 130 }))).not.toContain('product-covered');
    expect(await kinds(scene({ x: 200, y: 550, w: 650, h: 720 }, true))).not.toContain('product-covered');
  });
});
