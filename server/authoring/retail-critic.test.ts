import { describe, expect, it } from 'vitest';
import { buildVisualPrompt } from '../review/visual';
import { buildRetailClip } from './retail-clip';
import { retailFaultQuestions, retailPlateNote } from './retail-critic';

const map = {
  surfaces: [{ name: 'wooden table top', top: 0.634, bottom: 0.85, left: 0, right: 1 }],
  busy: new Array(144).fill(0.1),
  quadrants: { Q1: 'blurred wall, calm', Q2: 'curtain, busy', Q4: 'figs and leaves, busy' },
};
const input = (withMap: boolean) => ({
  aspect: '9:16' as const,
  plate: { id: 'ast_plate', src: '/p.png', width: 720, height: 1280, ...(withMap ? { map } : {}) },
  product: { id: 'ast_prod', src: '/c.png', width: 256, height: 752 },
  title: 'Cold Brew',
  price: 3.5,
});

describe('retailFaultQuestions', () => {
  it('names the surface and the busy quadrants the plate read found', () => {
    const q = retailFaultQuestions(buildRetailClip(input(true)));
    expect(q).toHaveLength(4);
    expect(q[0]).toMatch(/contact shadow.*the wooden table top/);
    expect(q[2]).toMatch(/Q2 \(curtain, busy\); Q4 \(figs and leaves, busy\)/);
  });

  it('still asks, in general terms, when the plate is unread', () => {
    const q = retailFaultQuestions(buildRetailClip(input(false)));
    expect(q[0]).toMatch(/the surface/);
    expect(q[2]).not.toMatch(/such as/);
  });

  it('asks nothing of a comp that is not a retail clip', () => {
    expect(retailPlateNote({ layers: [], precomps: {} } as never)).toBeUndefined();
    expect(retailFaultQuestions({ layers: [], precomps: {} } as never)).toEqual([]);
  });

  it('reaches the blind prompt as questions where a yes is a fault', () => {
    const prompt = buildVisualPrompt({ sceneId: 'clip', frameTimes: [1], findings: [], layerSummary: [], tools: [], blind: true, measured: [], faultQuestions: retailFaultQuestions(buildRetailClip(input(true))) });
    expect(prompt).toContain('Report one issue for each question whose answer is yes');
    expect(prompt).toContain('wooden table top');
  });
});
