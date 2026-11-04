import { describe, expect, it } from 'vitest';
import { addLayer, addScene, newFilmComposition } from '../authoring/api';
import { setKeyframes } from '../authoring/transform';
import type { Comp, Obj } from '../authoring/types';
import { layerBoxAt } from '../review/geometry';
import { runRulesCore } from '../review/rules-core';
import { estimateTextSize } from '../review/text-box';
import { settleTextBoxes } from './text-lane';

const layer = (c: Comp, id: string): Obj => Object.values(c.precomps as Record<string, Obj>).flatMap((p) => p.layers as Obj[]).find((l) => l.id === id)!;

// a tall frame with a light backdrop, a navy box the crew drew, and dark words that arrive a second in
const scene = (box: { x: number; y: number; w: number; h: number }, fill = '#123A52') => {
  let c = newFilmComposition({ aspect: '9:16', title: 'T', palette: ['#dbeafe'] });
  c = addScene(c, { id: 's1', durationSec: 4, mode: 'motion', intent: 'hero' });
  c = addLayer(c, { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#dbeafe' });
  c = addLayer(c, { sceneId: 's1', role: 'bg', kind: 'shape', fill, box });
  c = addLayer(c, { sceneId: 's1', role: 'headline', kind: 'text', text: 'Soak it up', box: { x: 140, y: 300, w: 800, h: 140 } });
  c = setKeyframes(c, 's1:headline', 'opacity', [[1, 0], [1.5, 1]], 'easeOut');
  layer(c, 's1:headline').style.fill = '#111111';
  return c;
};

describe('settleTextBoxes', () => {
  it('shows a box only while its words show, and makes the words read on it', () => {
    const c = scene({ x: 100, y: 260, w: 880, h: 220 });
    const { comp, fixed } = settleTextBoxes(c, 's1');
    expect(fixed).toEqual(['s1:bg-2']);
    const box = layer(comp, 's1:bg-2');
    const words = layer(comp, 's1:headline');
    expect(box.transform.opacity).toEqual(words.transform.opacity);
    expect(layerBoxAt(comp, 's1:bg-2', 15).opacity).toBe(0);
    expect(words.style.fill.toLowerCase()).toBe('#ffffff');
  });

  it('redraws a box round its words when they spill out of it', () => {
    const c = scene({ x: -200, y: 200, w: 800, h: 360 });
    const { comp } = settleTextBoxes(c, 's1');
    const words = layerBoxAt(comp, 's1:headline', 60).box;
    const box = layerBoxAt(comp, 's1:bg-2', 60).box;
    expect(box.left).toBeLessThanOrEqual(words.left);
    expect(box.right).toBeGreaterThanOrEqual(words.right);
    expect(box.top).toBeLessThanOrEqual(words.top);
    expect(box.bottom).toBeGreaterThanOrEqual(words.bottom);
  });

  it('leaves a shape no words sit on alone, and a scene with no boxes untouched', () => {
    const c = scene({ x: 100, y: 1400, w: 880, h: 200 });
    expect(settleTextBoxes(c, 's1')).toEqual({ comp: c, fixed: [] });
  });
});

describe('boxes in the review', () => {
  it('measures a shape by its own size, not the frame', () => {
    const c = scene({ x: 100, y: 260, w: 880, h: 220 });
    const b = layerBoxAt(c, 's1:bg-2', 0).box;
    expect([b.left, b.top, b.right, b.bottom].map(Math.round)).toEqual([100, 260, 980, 480]);
  });

  it('reads the contrast of words against the box under them', async () => {
    const before = await runRulesCore(scene({ x: 100, y: 260, w: 880, h: 220 }) as never);
    expect(before.findings.some((f) => f.kind === 'low-contrast')).toBe(true);
    const after = await runRulesCore(settleTextBoxes(scene({ x: 100, y: 260, w: 880, h: 220 }), 's1').comp as never);
    expect(after.findings.some((f) => f.kind === 'low-contrast')).toBe(false);
  });

  it('takes a wrapped paragraph as wide as its box', () => {
    const one = estimateTextSize({ source: 'Soft', style: { size: 88, weight: 800, boxWidth: 920 } });
    const two = estimateTextSize({ source: 'BOLD STRIPES. SOFT TERRY.', style: { size: 88, weight: 800, boxWidth: 920 } });
    expect(one.w).toBeLessThan(920);
    expect(two.w).toBe(920);
  });
});
