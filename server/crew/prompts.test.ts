import { describe, expect, it } from 'vitest';
import type { StyleBible } from '@shared/crew';
import { SHOWRUNNER_SYSTEM, renderBibleBlock, renderJobBlock, showrunnerSystem } from './prompts';

const bible: StyleBible = {
  palette: ['#1f2937', '#f59e0b', '#fde68a'],
  light: 'low warm morning sun from the left',
  camera: 'slow dolly-ins, no fast cuts',
  type: { font: 'Inter', weight: 800, case: 'upper' },
  productLine: 'a matte black cold-brew can with a cream band',
  mood: 'calm, early',
};

describe('SHOWRUNNER_SYSTEM', () => {
  it('lets the model call several tools and bans real brand names', () => {
    expect(SHOWRUNNER_SYSTEM).toContain('You may call several tools in one turn');
    expect(SHOWRUNNER_SYSTEM).toContain('Never use real brand names');
  });
  it('holds the pass gate sentence and the user-first rule', () => {
    expect(SHOWRUNNER_SYSTEM).toContain('Call finish only when every scene is built, nothing is running and continuity reports no errors.');
    expect(SHOWRUNNER_SYSTEM).toContain('Their newest message outranks your plan.');
  });
  it('names every board tool', () => {
    for (const tool of ['setStyleBible', 'reviseStoryboard', 'dispatch', 'cancel', 'pickTake', 'proposeGenerate', 'say', 'ask', 'finish']) expect(SHOWRUNNER_SYSTEM).toContain(tool);
  });
});

describe('builder prompt blocks', () => {
  it('renders the bible exactly as design 6.4', () => {
    expect(renderBibleBlock(bible)).toMatchInlineSnapshot(`
      "STYLE BIBLE (every scene follows it)
      palette: #1f2937 #f59e0b #fde68a · light: low warm morning sun from the left · camera: slow dolly-ins, no fast cuts
      type: Inter 800, UPPER · product: a matte black cold-brew can with a cream band · mood: calm, early"
    `);
  });
  it('names the job, its kind and the one scene it owns', () => {
    const block = renderJobBlock({ id: 'j7', kind: 'restyle-scene', sceneId: 's1', brief: 'Warmer light: golden hour from the left.' });
    expect(block).toContain('YOUR JOB (j7, restyle-scene, scene s1)');
    expect(block).toContain('Warmer light: golden hour from the left.');
    expect(block).toContain('You own scene s1 only.');
  });
  it('a job with no scene does not claim one', () => {
    expect(renderJobBlock({ id: 'j2', kind: 'continuity', brief: 'check' })).not.toContain('You own scene');
  });
  it('renders the other type cases', () => {
    expect(renderBibleBlock({ ...bible, type: { ...bible.type, case: 'title' } })).toContain('Inter 800, Title');
    expect(renderBibleBlock({ ...bible, type: { ...bible.type, case: 'sentence' } })).toContain('Inter 800, Sentence');
  });
});

describe('showrunnerSystem (S13b)', () => {
  it("with PRODUCT_3D on, rule 3 is the three-way choice", () => {
    const s = showrunnerSystem(true);
    expect(s).toContain('Pick the cheapest technique that tells the shot');
    expect(s).toContain('"3d"');
    expect(s).not.toContain('3. A scene is motion unless');
    // every other rule is the same text
    expect(s.split('\n').filter((l) => /^[1-8]\. /.test(l) && !l.startsWith('3.'))).toEqual(SHOWRUNNER_SYSTEM.split('\n').filter((l) => /^[1-8]\. /.test(l) && !l.startsWith('3.')));
  });

  it('with PRODUCT_3D off, rule 3 is exactly the S12b text and the prompt is the old constant', () => {
    const s = showrunnerSystem(false);
    expect(s).toContain('3. A scene is motion unless it needs physical motion a still cannot fake (pouring, walking, fabric, hands using the product).\n   Then call proposeGenerate with the reason. At most 2 generate scenes.');
    expect(s).toBe(SHOWRUNNER_SYSTEM);
    expect(s).not.toMatch(/3d/i);
  });

  it('reads the switch when the caller does not say', () => {
    const saved = process.env.PRODUCT_3D;
    try {
      process.env.PRODUCT_3D = 'true';
      expect(showrunnerSystem()).toContain('Pick the cheapest technique');
      delete process.env.PRODUCT_3D;
      expect(showrunnerSystem()).toBe(SHOWRUNNER_SYSTEM);
    } finally {
      if (saved === undefined) delete process.env.PRODUCT_3D;
      else process.env.PRODUCT_3D = saved;
    }
  });
});
