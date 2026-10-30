import { describe, expect, it } from 'vitest';
import type { StyleBible } from '@shared/crew';
import type { Scene, Storyboard } from '@shared/storyboard';
import { addLayer, addScene, newFilmComposition, registerAsset } from '../authoring/api';
import type { Comp } from '../authoring/types';
import { runContinuity, runContinuityJob } from './continuity';
import { makeTestCrew } from './test-helpers';

const PRODUCT = 'ast_0123456789abcdef0123456789abcdef';
const bible: StyleBible = { palette: ['#1f2937', '#f59e0b'], light: 'warm', camera: 'slow', type: { font: 'sans', weight: 800, case: 'upper' }, productLine: 'a can', mood: 'calm' };
const scene = (id: string, shotType: Scene['shotType']): Scene => ({ id, durationSec: 4, intent: 'i', shotType, camera: 'static', layersWanted: ['bg', 'product'], mode: 'motion', modeReason: 'r' });
const board = (scenes: Scene[]): Storyboard => ({ title: 'T', aspect: '16:9', durationSec: scenes.length * 4, palette: ['#1f2937'], scenes });

/** Scenes whose product is `heights` of the frame high (1080 px frame, square product). */
function film(heights: number[], o: { fill?: string; textFill?: string; font?: string; weight?: number } = {}): Comp {
  let c = registerAsset(newFilmComposition({ aspect: '16:9', title: 'T', palette: ['#1f2937'] }), { id: PRODUCT, kind: 'image', src: '/p.png', width: 100, height: 100 });
  heights.forEach((h, i) => {
    const id = `s${i + 1}`;
    c = addScene(c, { id, durationSec: 4, mode: 'motion' });
    const side = Math.round(h * 1080);
    c = addLayer(c, { sceneId: id, role: 'product', kind: 'image', assetId: PRODUCT, box: { x: 700, y: 100, w: side, h: side } });
    if (o.fill) c = addLayer(c, { sceneId: id, role: 'bg', kind: 'shape', fill: o.fill });
    c = addLayer(c, { sceneId: id, role: 'headline', kind: 'text', text: 'Hello', style: { color: o.textFill ?? '#fde68a', font: o.font ?? 'Inter, system-ui, sans-serif', weight: o.weight ?? 800 } });
  });
  return c;
}
const kinds = (f: Array<{ kind: string }>) => f.map((x) => x.kind);
const heroes = board([scene('s1', 'hero'), scene('s2', 'hero')]);

describe('product-scale-drift', () => {
  it('flags two hero scenes at 0.40 and 0.60 once, on the later scene', async () => {
    const found = (await runContinuity(film([0.4, 0.6]), null, undefined, heroes)).filter((f) => f.kind === 'product-scale-drift');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ sceneId: 's2', severity: 'warn', rule: 'C1' });
    expect(found[0]!.evidence).toContain('s1');
  });

  it('does not flag 0.40 and 0.50', async () => {
    expect(kinds(await runContinuity(film([0.4, 0.5]), null, undefined, heroes))).not.toContain('product-scale-drift');
  });

  it('compares scenes of the same shot type only', async () => {
    const mixed = board([scene('s1', 'hero'), scene('s2', 'detail')]);
    expect(kinds(await runContinuity(film([0.3, 0.8]), null, undefined, mixed))).not.toContain('product-scale-drift');
  });

  it('needs the storyboard to know the shot types, and skips without one', async () => {
    expect(kinds(await runContinuity(film([0.3, 0.8]), null))).not.toContain('product-scale-drift');
  });
});

describe('palette-drift', () => {
  it('flags a red headline against an amber and slate palette, but not a near-amber one', async () => {
    expect(kinds(await runContinuity(film([0.4], { textFill: '#ff0000' }), null, bible))).toContain('palette-drift');
    expect(kinds(await runContinuity(film([0.4], { textFill: '#f5a00e' }), null, bible))).not.toContain('palette-drift');
  });

  it('flags a shape fill too, and never white or black', async () => {
    expect(kinds(await runContinuity(film([0.4], { fill: '#00ff00' }), null, bible))).toContain('palette-drift');
    expect(kinds(await runContinuity(film([0.4], { textFill: '#ffffff' }), null, bible))).not.toContain('palette-drift');
    expect(kinds(await runContinuity(film([0.4], { textFill: '#000000' }), null, bible))).not.toContain('palette-drift');
  });

  it('is not checked without a bible', async () => {
    expect(kinds(await runContinuity(film([0.4], { textFill: '#ff0000' }), null))).not.toContain('palette-drift');
  });
});

describe('type-drift', () => {
  it('flags a headline in another font or weight than the bible', async () => {
    expect(kinds(await runContinuity(film([0.4], { font: 'Georgia' }), null, bible))).toContain('type-drift');
    expect(kinds(await runContinuity(film([0.4], { weight: 400 }), null, bible))).toContain('type-drift');
    expect(kinds(await runContinuity(film([0.4]), null, bible))).not.toContain('type-drift');
  });
});

describe('runContinuityJob', () => {
  async function setup(heights: number[]) {
    const t = await makeTestCrew();
    await t.film.films.commit(t.film.filmId, film(heights), 'director');
    await t.film.films.update(t.film.filmId, { styleBible: bible, storyboard: heroes });
    return { ...t, job: () => t.board.add({ kind: 'continuity', origin: 'auto', sceneId: 's1', brief: 'check', reason: 'r' }) };
  }

  it('pushes new findings to the inbox from continuity, and nothing on a second run with no new ones', async () => {
    const t = await setup([0.4, 0.6]);
    await runContinuityJob(t.job(), new AbortController().signal, t.crew);
    expect(t.inbox.size()).toBe(1);
    const [item] = await t.inbox.drain();
    expect(item).toMatchObject({ from: 'continuity' });
    expect(item!.text).toContain('s2 product-scale-drift');
    const second = await runContinuityJob(t.job(), new AbortController().signal, t.crew);
    expect(second.summary).toMatch(/, 0 new$/);
    expect(t.inbox.size()).toBe(0);
  });

  it('a finding that went away and came back is news again', async () => {
    const t = await setup([0.4, 0.6]);
    await runContinuityJob(t.job(), new AbortController().signal, t.crew);
    await t.inbox.drain();
    await t.film.films.commit(t.film.filmId, film([0.4, 0.45]), 'director'); // the drift is gone
    await runContinuityJob(t.job(), new AbortController().signal, t.crew);
    expect(t.inbox.size()).toBe(0);
    await t.film.films.commit(t.film.filmId, film([0.4, 0.6]), 'director'); // and back
    await runContinuityJob(t.job(), new AbortController().signal, t.crew);
    const [again] = await t.inbox.drain();
    expect(again!.text).toBe('s2 product-scale-drift: ' + again!.text.split('product-scale-drift: ')[1]); // that finding and no other
  });

  it('says so when there is nothing to check, and announces itself on the continuity lane', async () => {
    const t = await makeTestCrew();
    const job = t.board.add({ kind: 'continuity', origin: 'auto', brief: 'b', reason: 'r' });
    expect((await runContinuityJob(job, new AbortController().signal, t.crew)).summary).toBe('no composition yet');
    await new Promise((r) => setTimeout(r, 30));
    expect(t.events.filter((e) => e.type === 'crew.agent').map((e) => (e as { lane: string; state: string }).lane + ':' + (e as { state: string }).state)).toEqual(['continuity:working', 'continuity:idle']);
  });
});
