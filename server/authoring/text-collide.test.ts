import { describe, expect, it } from 'vitest';
import { layerBoxAt } from '../review/geometry';
import { addLayer, addScene, newFilmComposition, registerAsset } from './api';
import { setCamera } from './camera';
import { finishComposition, WIPE_FRAMES } from './finish';
import { readDirector } from './meta';
import { separateText } from './text-collide';
import type { Comp, Obj } from './types';

const base = (): Comp => {
  let c = newFilmComposition({ aspect: '9:16', title: 'T', palette: ['#1f2937'] });
  c = addScene(c, { id: 's1', durationSec: 3, mode: 'motion' });
  c = addScene(c, { id: 's2', durationSec: 3, mode: 'motion' });
  c = addLayer(c, { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#f4ead5' });
  c = addLayer(c, { sceneId: 's2', role: 'bg', kind: 'shape', fill: '#f4ead5' });
  return c;
};
const ids = (c: Comp, scene: string) => (((c.precomps as Record<string, Obj>)[scene]!.layers as Obj[]).map((l) => l.id as string));
const overlap = (c: Comp, a: string, b: string, f = 45) => {
  const x = layerBoxAt(c, a, f).box;
  const y = layerBoxAt(c, b, f).box;
  return Math.min(x.bottom, y.bottom) > Math.max(x.top, y.top) && Math.min(x.right, y.right) > Math.max(x.left, y.left);
};

describe('separateText', () => {
  it('drops a second layer with the same words, keeping the original', () => {
    let c = addLayer(base(), { sceneId: 's1', role: 'headline', kind: 'text', text: 'SALTLINE GOGGLES', style: { size: 88 }, box: { x: 100, y: 200, w: 880, h: 110 } });
    c = addLayer(c, { sceneId: 's1', role: 'headline', kind: 'text', text: 'Saltline  goggles', style: { size: 84 }, box: { x: 110, y: 210, w: 880, h: 110 } });
    const r = separateText(c);
    expect(r.removed).toEqual(['s1:headline-2']);
    expect(ids(r.comp, 's1')).toContain('s1:headline');
    expect(ids(r.comp, 's1')).not.toContain('s1:headline-2');
  });

  it('moves the lower of two overlapping text blocks below the upper one', () => {
    let c = addLayer(base(), { sceneId: 's1', role: 'headline', kind: 'text', text: 'SEE CLEAR\nUNDERWATER', style: { size: 84 }, box: { x: 100, y: 200, w: 880, h: 200 } });
    c = addLayer(c, { sceneId: 's1', role: 'caption', kind: 'text', text: 'ANTI-FOG CLEAR VIEW', style: { size: 48 }, box: { x: 100, y: 300, w: 880, h: 60 } });
    expect(overlap(c, 's1:headline', 's1:caption')).toBe(true);
    const r = separateText(c);
    expect(r.moved).toEqual(['s1:caption']);
    expect(overlap(r.comp, 's1:headline', 's1:caption')).toBe(false);
    expect(separateText(r.comp).moved).toEqual([]);
  });

  it('leaves text that is never on screen at the same time', () => {
    let c = addLayer(base(), { sceneId: 's1', role: 'headline', kind: 'text', text: 'FIRST', style: { size: 84 }, box: { x: 100, y: 200, w: 880, h: 110 } });
    c = addLayer(c, { sceneId: 's1', role: 'caption', kind: 'text', text: 'SECOND', style: { size: 84 }, box: { x: 100, y: 220, w: 880, h: 110 } });
    const caption = ((c.precomps as Record<string, Obj>).s1!.layers as Obj[]).find((l) => l.id === 's1:caption')!;
    const headline = ((c.precomps as Record<string, Obj>).s1!.layers as Obj[]).find((l) => l.id === 's1:headline')!;
    headline.outPoint = 40;
    caption.inPoint = 45;
    expect(separateText(c).moved).toEqual([]);
  });
});

describe('text over the product', () => {
  it('moves text that sits on the product above or below where the product travels', () => {
    const PRODUCT = 'ast_0123456789abcdef0123456789abcdef';
    let c = registerAsset(base(), { id: PRODUCT, kind: 'image', src: '/p.png', width: 100, height: 100 });
    c = addLayer(c, { sceneId: 's1', role: 'product', kind: 'image', assetId: PRODUCT, box: { x: 240, y: 700, w: 600, h: 600 } });
    c = addLayer(c, { sceneId: 's1', role: 'headline', kind: 'text', text: 'PACK THE CAR', style: { size: 96 }, box: { x: 100, y: 900, w: 880, h: 120 } });
    const covered = (comp: Comp) => {
      const t = layerBoxAt(comp, 's1:headline', 45).box;
      const p = layerBoxAt(comp, 's1:product', 45).box;
      return Math.max(0, Math.min(t.bottom, p.bottom) - Math.max(t.top, p.top)) > 0;
    };
    expect(covered(c)).toBe(true);
    const r = separateText(c);
    expect(r.moved).toEqual(['s1:headline']);
    expect(covered(r.comp)).toBe(false);
  });
});

describe('finish motion', () => {
  it('carries every cut with a wipe: out at the end of a shot, in at the start of the next', () => {
    const out = finishComposition(base(), { accent: '#ff6b1a' });
    const wipes = (s: string) => ids(out, s).filter((id) => id.includes('wipe'));
    expect(wipes('s1')).toEqual(['finish:s1:wipe-out']);
    expect(wipes('s2')).toEqual(['finish:s2:wipe-in']);
    const w = ((out.precomps as Record<string, Obj>).s1!.layers as Obj[]).at(-1)!;
    expect(w.fill).toBe('#ff6b1a');
    expect(w.transform.position[1].t - w.transform.position[0].t).toBe(WIPE_FRAMES);
    expect(finishComposition(out, { accent: '#ff6b1a' })).toEqual(out);
  });

  it('gives a static shot a slow push, and leaves a hand-animated one alone', () => {
    const PRODUCT = 'ast_0123456789abcdef0123456789abcdef';
    let c = registerAsset(base(), { id: PRODUCT, kind: 'image', src: '/p.png', width: 100, height: 100 });
    c = addLayer(c, { sceneId: 's1', role: 'product', kind: 'image', assetId: PRODUCT, box: { x: 400, y: 800, w: 280, h: 280 } });
    c = addLayer(c, { sceneId: 's2', role: 'product', kind: 'image', assetId: PRODUCT, box: { x: 400, y: 800, w: 280, h: 280 } });
    c = setCamera(setCamera(c, 's1', 'static'), 's2', 'static');
    const hand = ((c.precomps as Record<string, Obj>).s2!.layers as Obj[]).find((l) => l.id === 's2:product')!;
    hand.transform.position = [{ t: 0, v: [540, 900] }, { t: 60, v: [540, 940] }];
    const out = finishComposition(c);
    expect(readDirector(out).scenes.s1!.camera?.move).toBe('dolly-in');
    expect(readDirector(out).scenes.s2!.camera?.move).toBe('static');
  });
});
