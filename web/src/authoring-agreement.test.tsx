import { AEP_SCHEMA_VERSION, parseAepCompositionSafe } from 'reacthub-pixitweenjs';
import { expect, it } from 'vitest';
import { addLayer, addScene, newFilmComposition, registerAsset, setCamera, setKeyframes } from '../../server/authoring/api';
import { AEP_VERSION } from '../../server/authoring/constants';
import { lightValidate } from '../../server/engine/light-validator';

const ASSET = 'ast_0123456789abcdef0123456789abcdef';

function film() {
  let c = registerAsset(newFilmComposition({ aspect: '16:9', title: 'Agreement', palette: ['#111827'] }), { id: ASSET, kind: 'image', src: `/api/assets/${ASSET}`, width: 384, height: 672 });
  for (const [id, move] of [['s1', 'dolly-in'], ['s2', 'pan'], ['s3', 'orbit']] as const) {
    c = addScene(c, { id, durationSec: 3, mode: 'motion', intent: id });
    c = addLayer(c, { sceneId: id, role: 'bg', kind: 'shape', fill: '#111827' });
    c = addLayer(c, { sceneId: id, role: 'product', kind: 'image', assetId: ASSET });
    c = addLayer(c, { sceneId: id, role: 'headline', kind: 'text', text: `Headline ${id}` });
    c = setKeyframes(c, `${id}:headline`, 'opacity', [[0, 0], [0.5, 1]], 'easeOut');
    c = setCamera(c, id, move);
  }
  return c;
}

it('a three-scene film built through the API passes the real engine schema and the light validator', () => {
  const c = film();
  const engine = parseAepCompositionSafe(c);
  expect(engine.success, engine.success ? '' : JSON.stringify(engine.error.issues.slice(0, 3))).toBe(true);
  expect(lightValidate(c).ok).toBe(true);
});

it('uses the engine schema version', () => expect(AEP_VERSION).toBe(AEP_SCHEMA_VERSION));
