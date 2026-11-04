import { describe, expect, it } from 'vitest';
import { addLayer, addScene, newFilmComposition } from '../authoring/api';
import type { Comp, Obj } from '../authoring/types';
import { runRules } from '../review/rules';
import { settleContrast } from './finish-film';

const film = (fill: string, color: string): Comp => {
  let c = newFilmComposition({ aspect: '9:16', title: 'T', palette: ['#1f2937'] });
  c = addScene(c, { id: 's1', durationSec: 3, mode: 'motion' });
  c = addLayer(c, { sceneId: 's1', role: 'bg', kind: 'shape', fill });
  return addLayer(c, { sceneId: 's1', role: 'headline', kind: 'text', text: 'PACK THE COLD IN', style: { size: 96, color }, box: { x: 54, y: 200, w: 972, h: 140 } });
};
const assets = { read: async () => Buffer.alloc(0) };
const headline = (c: Comp) => ((c.precomps as Record<string, Obj>).s1!.layers as Obj[]).find((l) => l.id === 's1:headline')!;
const lowContrast = async (c: Comp) => (await runRules(c, null)).findings.filter((f) => f.kind === 'low-contrast');

describe('settleContrast', () => {
  it('recolours text that the contrast rule fails, so the finished film passes it', async () => {
    const c = film('#f4ead5', '#ffffff');
    expect(await lowContrast(c)).toHaveLength(1);
    const r = await settleContrast(c, assets);
    expect(r.fixed).toEqual(['s1:headline']);
    expect(headline(r.comp).style.fill).toBe('#111111');
    expect(await lowContrast(r.comp)).toEqual([]);
  });

  it('adds an outline where no flat colour reaches 4.5:1 on a mid-tone plate', async () => {
    const r = await settleContrast(film('#7a7a7a', '#808080'), assets);
    expect(headline(r.comp).style.stroke?.width).toBeGreaterThanOrEqual(3);
    expect(await lowContrast(r.comp)).toEqual([]);
  });

  it('leaves readable text alone', async () => {
    const c = film('#f4ead5', '#111111');
    expect((await settleContrast(c, assets)).comp).toBe(c);
  });
});
