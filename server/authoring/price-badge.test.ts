import { describe, expect, it } from 'vitest';
import { addLayer, addScene, newFilmComposition } from './api';
import { runRules } from '../review/rules';
import { finishComposition } from './finish';
import { priceBadges, readPrices, withoutPrices } from './price-badge';
import type { Comp, Obj } from './types';

describe('readPrices', () => {
  it.each([
    ['NOW $14 — WAS $18 SALTLINE SUMMER SALE', { now: '$14', was: '$18' }],
    ['PACK THE CAR — $14 WAS $18', { now: '$14', was: '$18' }],
    ['$59 SUMMER SALE', { now: '$59' }],
    ['was $40, now $29.99', { now: '$29.99', was: '$40' }],
    ['$25 $19', { now: '$25' }],
  ])('%s', (text, want) => expect(readPrices(text)).toEqual(want));
  it('finds none in plain copy', () => expect(readPrices('PACK THE CAR')).toBeUndefined());
});

describe('withoutPrices', () => {
  it.each([
    ['NOW $14 — WAS $18 SALTLINE SUMMER SALE', 'SALTLINE SUMMER SALE'],
    ['PACK THE CAR — $14 WAS $18', 'PACK THE CAR'],
    ['SALTLINE — $59', 'SALTLINE'],
    ['$59\nSUMMER\nSALE', 'SUMMER SALE'],
  ])('%s', (text, want) => expect(withoutPrices(text)).toBe(want));
});

const film = (copy: string): Comp => {
  let c = newFilmComposition({ aspect: '9:16', title: 'T', palette: ['#1f2937'] });
  c = addScene(c, { id: 's1', durationSec: 4, mode: 'motion' });
  c = addLayer(c, { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#f4ead5' });
  return addLayer(c, { sceneId: 's1', role: 'headline', kind: 'text', text: copy, style: { size: 90 }, box: { x: 54, y: 200, w: 972, h: 220 } });
};
const layers = (c: Comp) => ((c.precomps as Record<string, Obj>).s1!.layers as Obj[]);
const byId = (c: Comp, id: string) => layers(c).find((l) => l.id === id);

describe('priceBadges', () => {
  it('turns the price into a badge and leaves the rest of the copy', () => {
    const out = priceBadges(film('PACK THE CAR — $14 WAS $18'), { accent: '#FF6B1A' });
    expect(byId(out, 's1:headline')!.source).toBe('PACK THE CAR');
    expect(byId(out, 'finish:s1:badge-now')!.source).toBe('$14');
    expect(byId(out, 'finish:s1:badge-was')!.source).toBe('WAS $18');
    expect(byId(out, 'finish:s1:badge-disc')!.fill).toBe('#FF6B1A');
    expect(byId(out, 'finish:s1:badge-burst')!.path.kind).toBe('polystar');
    // it pops in: from nothing, past full size, and settles at 1
    const scale = byId(out, 'finish:s1:badge-disc')!.transform.scale as Array<{ v: number[] }>;
    expect(scale.map((k) => k.v[0])).toEqual([0, 1.18, 0.95, 1]);
  });

  it('removes copy that was only the price', () => {
    const out = priceBadges(film('NOW $59'));
    expect(byId(out, 's1:headline')).toBeUndefined();
    expect(byId(out, 'finish:s1:badge-now')!.source).toBe('$59');
  });

  it('keeps the badge clear of the copy', () => {
    const out = priceBadges(film('PACK THE CAR — $14'));
    const [cx, cy] = (byId(out, 'finish:s1:badge-disc')!.transform.position as number[]);
    expect(cy! - 1080 * 0.34 / 2).toBeGreaterThan(420);
    expect(cx).toBeGreaterThan(0);
  });

  it('draws nothing where no price is named', () => {
    expect(layers(priceBadges(film('PACK THE CAR'))).some((l) => String(l.id).includes('badge'))).toBe(false);
  });

  it('survives a second finish: the badge is redrawn the same', () => {
    const once = finishComposition(film('PACK THE CAR — $14 WAS $18'), { accent: '#FF6B1A' });
    expect(byId(once, 'finish:s1:badge-now')!.source).toBe('$14');
    expect(finishComposition(once, { accent: '#FF6B1A' })).toEqual(once);
  });

  it('a finished film with a badge still goes through the review rules, which leave the badge alone', async () => {
    const once = finishComposition(film('PACK THE CAR — $14 WAS $18'), { accent: '#FF6B1A' });
    const { findings } = await runRules(once, null);
    expect(findings.filter((f) => f.layerId?.startsWith('finish:'))).toEqual([]);
  });
});
