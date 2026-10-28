import { expect, it } from 'vitest';
import { addLayer } from './layers';
import { markPlaceholder } from './read';
import { setCamera } from './camera';
import { newFilmComposition, registerAsset } from './composition';
import { addScene } from './scenes';
import { summariseComposition } from './summarise';
import { setKeyframes } from './transform';
import { MUG } from './test-helpers';

function film() {
  let c = newFilmComposition({ aspect: '16:9', title: 'Cold brew', palette: ['#111827'] });
  c = registerAsset(c, { id: MUG, kind: 'image', src: `/api/assets/${MUG}`, width: 384, height: 672 });
  c = addScene(c, { id: 's1', durationSec: 4, mode: 'motion', intent: 'Slow push-in on the mug at sunrise' });
  c = addLayer(c, { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#111827' });
  c = addLayer(c, { sceneId: 's1', role: 'product', kind: 'image', assetId: MUG });
  c = addLayer(c, { sceneId: 's1', role: 'headline', kind: 'text', text: 'Slow mornings' });
  c = setKeyframes(c, 's1:headline', 'opacity', [[0, 0], [0.6, 1]], 'easeOut');
  c = setCamera(c, 's1', 'dolly-in');
  c = addScene(c, { id: 's2', durationSec: 4, mode: 'generate', intent: 'Pour into the mug' });
  c = addLayer(c, { sceneId: 's2', role: 'bg', kind: 'shape', fill: '#111827' });
  c = addLayer(c, { sceneId: 's2', role: 'caption', kind: 'text', text: 'Clip pending approval' });
  return markPlaceholder(c, 's2:caption', true);
}

it('matches the design example', () => {
  expect(summariseComposition(film())).toBe(
    [
      'film "Cold brew" 16:9 1920x1080 @30fps 8.0s, 2 scenes',
      'scene s1 0.0-4.0s motion camera=dolly-in "Slow push-in on the mug at sunrise"',
      '  s1:bg shape #111827 z10 anim:scale',
      `  s1:product image ${MUG} z1 at 960,562 scale 1.00 anim:position,scale`,
      '  s1:headline text "Slow mornings" z0 at 960,173 size 76 anim:opacity',
      'scene s2 4.0-8.0s generate "Pour into the mug"',
      '  s2:bg shape #111827 z10',
      '  s2:caption text "Clip pending approval" z0 at 960,961 size 43 [placeholder]',
    ].join('\n'),
  );
});
it('prints the exact empty-film line', () => {
  expect(summariseComposition(newFilmComposition({ aspect: '16:9', title: 'Cold brew' }))).toBe('film "Cold brew" 16:9 1920x1080 @30fps 0.0s, no scenes yet');
});
it('truncates long text with an ellipsis', () => {
  let c = addScene(newFilmComposition({ aspect: '16:9', title: 'T' }), { id: 's1', durationSec: 2, mode: 'motion' });
  c = addLayer(c, { sceneId: 's1', role: 'caption', kind: 'text', text: 'x'.repeat(60) });
  expect(summariseComposition(c)).toContain(`"${'x'.repeat(40)}…"`);
});
it('stays compact for six scenes of six layers', () => {
  let c = registerAsset(newFilmComposition({ aspect: '16:9', title: 'Big' }), { id: MUG, kind: 'image', src: `/api/assets/${MUG}`, width: 384, height: 672 });
  for (let i = 1; i <= 6; i++) {
    c = addScene(c, { id: `s${i}`, durationSec: 4, mode: 'motion', intent: 'Short intent' });
    c = addLayer(c, { sceneId: `s${i}`, role: 'bg', kind: 'shape', fill: '#111827' });
    c = addLayer(c, { sceneId: `s${i}`, role: 'product', kind: 'image', assetId: MUG });
    c = addLayer(c, { sceneId: `s${i}`, role: 'headline', kind: 'text', text: 'Headline text here' });
    c = addLayer(c, { sceneId: `s${i}`, role: 'headline', kind: 'text', text: 'Second headline' });
    c = addLayer(c, { sceneId: `s${i}`, role: 'caption', kind: 'text', text: 'Caption text here' });
    c = addLayer(c, { sceneId: `s${i}`, role: 'caption', kind: 'text', text: 'Second caption' });
  }
  expect(summariseComposition(c).length).toBeLessThan(2500);
});
