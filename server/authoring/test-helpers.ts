import type { Comp } from './types';
import { addScene } from './scenes';
import { newFilmComposition } from './composition';

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

/** A 16:9 film with scenes s1 (4 s), s2 (3 s), s3 (2 s). */
export function threeSceneFilm(): Comp {
  let c = newFilmComposition({ aspect: '16:9', title: 'Test', palette: ['#111827'] });
  c = addScene(c, { id: 's1', durationSec: 4, mode: 'motion' });
  c = addScene(c, { id: 's2', durationSec: 3, mode: 'motion' });
  c = addScene(c, { id: 's3', durationSec: 2, mode: 'generate' });
  return c;
}

import { registerAsset } from './composition';
import { addLayer } from './layers';

export const MUG = 'ast_0123456789abcdef0123456789abcdef';

/** 16:9 film, one 4 s scene s1, the 384x672 mug registered, and a bg shape, product and headline added. */
export function mugScene(): Comp {
  let c = newFilmComposition({ aspect: '16:9', title: 'Cold brew', palette: ['#111827'] });
  c = registerAsset(c, { id: MUG, kind: 'image', src: `/api/assets/${MUG}`, width: 384, height: 672 });
  c = addScene(c, { id: 's1', durationSec: 4, mode: 'motion', intent: 'Slow push-in' });
  c = addLayer(c, { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#111827' });
  c = addLayer(c, { sceneId: 's1', role: 'product', kind: 'image', assetId: MUG });
  c = addLayer(c, { sceneId: 's1', role: 'headline', kind: 'text', text: 'Slow mornings' });
  return c;
}
