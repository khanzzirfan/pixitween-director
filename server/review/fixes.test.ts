import { describe, expect, it } from 'vitest';
import { addLayer, addScene, newFilmComposition, setTransform } from '../authoring/api';
import { suggestFix } from './fixes';
import type { Finding } from './types';

const finding = (layerId: string): Finding =>
  ({ id: `R2:${layerId}`, rule: 'R2', kind: 'outside-safe-area', severity: 'error', sceneId: 's1', layerId, evidence: 'x', metrics: {} }) as Finding;

function textScene(x: number) {
  let c = newFilmComposition({ aspect: '9:16', title: 'T', palette: ['#111827'] });
  c = addScene(c, { id: 's1', durationSec: 4, mode: 'motion' });
  c = addLayer(c, { sceneId: 's1', role: 'headline', kind: 'text', text: 'Cold Brew' });
  return setTransform(c, 's1:headline', { x, y: 300 });
}

describe('suggestFix: outside-safe-area, sideways', () => {
  it('shifts a text that sticks out on the left by exactly the overflow, and keeps y', () => {
    const comp = textScene(100);
    const fix = suggestFix(finding('s1:headline'), { comp, sceneId: 's1', boxes: { 's1:headline': { left: -20, right: 300, top: 250, bottom: 350 } } });
    // the safe edge is 5% of 1080 = 54 px: the text must move 74 px right
    expect(fix).toEqual({ tool: 'setTransform', args: { layerId: 's1:headline', x: 174 } });
  });
  it('shifts a text that sticks out on the right back by the overflow', () => {
    const comp = textScene(900);
    const fix = suggestFix(finding('s1:headline'), { comp, sceneId: 's1', boxes: { 's1:headline': { left: 700, right: 1100, top: 250, bottom: 350 } } });
    expect(fix).toEqual({ tool: 'setTransform', args: { layerId: 's1:headline', x: 826 } });
  });
});
