import { describe, expect, it } from 'vitest';
import { addLayer, addScene, newFilmComposition, registerAsset } from '../authoring/api';
import { runRules } from './rules';

const base = () => {
  let comp = newFilmComposition({ aspect: '16:9', title: 'T', palette: ['#111827'] });
  comp = registerAsset(comp, { id: 'asset_p', kind: 'image', src: 'http://x/p.png', width: 800, height: 800 });
  comp = addScene(comp, { id: 's1', durationSec: 4, mode: 'motion', intent: 'hero' });
  comp = addLayer(comp, { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#111827' });
  comp = addLayer(comp, { sceneId: 's1', role: 'product', kind: 'image', assetId: 'asset_p', box: { x: 560, y: 140, w: 800, h: 800 } });
  return comp;
};

describe('runRules', () => {
  it('flags text that sits on the product', async () => {
    const comp = addLayer(base(), {
      sceneId: 's1',
      role: 'headline',
      kind: 'text',
      text: 'Slow mornings',
      box: { x: 700, y: 400, w: 520, h: 140 },
    });
    const { findings } = await runRules(comp, null);
    const hit = findings.find((f) => f.rule === 'R1');
    expect(hit).toBeDefined();
    expect(hit).toMatchObject({ sceneId: 's1', layerId: 's1:headline', severity: 'error' });
    expect(hit!.evidence).toMatch(/product/);
  });

  it('flags text outside the safe area', async () => {
    const comp = addLayer(base(), {
      sceneId: 's1',
      role: 'headline',
      kind: 'text',
      text: 'Slow mornings',
      box: { x: 10, y: 10, w: 520, h: 140 },
    });
    const { findings } = await runRules(comp, null);
    expect(findings.some((f) => f.rule === 'R2' && f.kind === 'outside-safe-area')).toBe(true);
  });

  it('reports nothing for text clear of the product and inside the safe area', async () => {
    const comp = addLayer(base(), {
      sceneId: 's1',
      role: 'headline',
      kind: 'text',
      text: 'Slow',
      box: { x: 100, y: 100, w: 400, h: 120 },
    });
    const { findings } = await runRules(comp, null);
    expect(findings.filter((f) => f.rule === 'R1' || f.rule === 'R2')).toEqual([]);
  });

  it('skips generate-mode scenes and records why', async () => {
    let comp = newFilmComposition({ aspect: '16:9', title: 'T', palette: ['#111827'] });
    comp = addScene(comp, { id: 's1', durationSec: 4, mode: 'generate', intent: 'pour' });
    const { findings, skipped } = await runRules(comp, null);
    expect(findings).toEqual([]);
    expect(skipped).toContainEqual({ rule: '*', sceneId: 's1', reason: 'generate-mode scene' });
  });
});
