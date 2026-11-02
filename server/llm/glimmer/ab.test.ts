import { describe, expect, it } from 'vitest';
import { removeLayer, sceneInfo, setKeyframes, setSceneDuration, setTransform, swapScenes, type Comp } from '../../authoring/api';
import { lightValidator } from '../../engine/validate';
import { SCRIPTED_EDITS, buildSampleFilm, scoreEdit } from './ab';

const sample = buildSampleFilm();

/** What a correct edit does, in authoring-core calls. */
const EXPECTED: Record<string, (c: Comp) => Comp> = {
  'bigger-product-last-scene': (c) => setKeyframes(c, 's3:product', 'scale', [[0, 1], [3, 1.4]]),
  'longer-intro': (c) => setSceneDuration(c, 's1', 6),
  'headline-up': (c) => setTransform(c, 's2:headline', { y: 100 }),
  'swap-scenes': (c) => swapScenes(c, 's2', 's3'),
  'fade-headline-out': (c) => setKeyframes(c, 's1:headline', 'opacity', [[3, 1], [4, 0]]),
  'remove-caption': (c) => removeLayer(c, 's3:caption'),
};

describe('buildSampleFilm', () => {
  it('is a valid film of three four-second scenes', () => {
    expect(lightValidator.validate(sample)).toMatchObject({ ok: true });
    expect(sceneInfo(sample).map((s) => [s.id, s.durationSec])).toEqual([['s1', 4], ['s2', 4], ['s3', 4]]);
  });
});

describe('scoreEdit', () => {
  it('has the six edits', () => {
    expect(SCRIPTED_EDITS.map((e) => e.id).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(SCRIPTED_EDITS.map((e) => e.id))('passes the expected change for %s', (id) => {
    const r = scoreEdit(id, sample, EXPECTED[id]!(sample));
    expect(r.reasons).toEqual([]);
    expect(r.pass).toBe(true);
  });

  it.each(SCRIPTED_EDITS.map((e) => e.id))('fails %s when nothing changed', (id) => {
    const r = scoreEdit(id, sample, sample);
    expect(r.pass).toBe(false);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('fails longer-intro when scene 1 grows by only one second', () => {
    expect(scoreEdit('longer-intro', sample, setSceneDuration(sample, 's1', 5)).pass).toBe(false);
  });
});
