import { AEP_SCHEMA_VERSION, parseAepCompositionSafe } from 'reacthub-pixitweenjs';
import { expect, it } from 'vitest';
import { addLayer, addScene, newFilmComposition, registerAsset, setCamera, setKeyframes } from '../../server/authoring/api';
import { AEP_VERSION } from '../../server/authoring/constants';
import { defaultBeatSheet } from '../../server/authoring/beatsheet';
import { buildCinematicFilm } from '../../server/authoring/cinematic-film';
import { buildHero3DClip } from '../../server/authoring/hero3d-clip';
import { FLOOR, floorElements, glassAsset, type IngredientAsset } from '../../server/authoring/ingredients';
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

it('the 3D hero clip (animated camera fov, engine 0.3.4 or later) passes the real engine schema and the light validator', () => {
  const c = buildHero3DClip({
    aspect: '9:16',
    texture: { id: ASSET, src: `/api/assets/${ASSET}`, width: 2048, height: 1024, kind: 'label' },
    shape: 'can',
    side: '#e8e0ce',
    productAspect: 3,
    title: 'Coffee Co. Cold Brew',
    brand: 'Coffee Co.',
    price: 3.99,
    wasPrice: 4.75,
    currency: 'USD',
    accent: '#c27a3a',
  });
  const engine = parseAepCompositionSafe(c);
  expect(engine.success, engine.success ? '' : JSON.stringify(engine.error.issues.slice(0, 3))).toBe(true);
  expect(lightValidate(c).ok).toBe(true);
});

// The cinematic film needs the engine's aep-32 (schema 1.12.0). Until the installed engine has it this test is skipped, so the suite
// stays green; once it has it, the test checks the film against the real schema.
const engineHasCinematic = AEP_SCHEMA_VERSION.localeCompare('1.12.0', undefined, { numeric: true }) >= 0;
it.skipIf(!engineHasCinematic)('the cinematic film passes the real engine schema (aep-32, schema 1.12.0)', () => {
  const els = floorElements('Coffee Co. Cold Brew', 'drinks');
  const pic = (id: string, w = 128, h = 64) => ({ id, src: `/api/assets/${id}`, width: w, height: h });
  const ingredients: Record<string, IngredientAsset> = {
    bean: { kind: 'bean', use: 'solid', sizeM: 0.02, frames: [pic('ast_bean')], contour: [[0, 10], [60, 0], [120, 10], [60, 60]], side: '#3b2416' },
    ice: glassAsset(FLOOR.ice!),
    splash: { kind: 'splash', use: 'card', sizeM: 0.3, frames: [pic('ast_sp1', 512, 512), pic('ast_sp2', 512, 512)] },
    milk: { kind: 'milk', use: 'card', sizeM: 0.35, frames: [pic('ast_milk', 512, 512)] },
  };
  const c = buildCinematicFilm({
    aspect: '9:16',
    sheet: defaultBeatSheet(els),
    texture: { id: ASSET, src: `/api/assets/${ASSET}`, width: 2048, height: 1024, kind: 'label' },
    shape: 'can',
    side: '#e8e0ce',
    productAspect: 3,
    title: 'Coffee Co. Cold Brew',
    brand: 'Coffee Co.',
    price: 3.99,
    wasPrice: 4.75,
    currency: 'USD',
    accent: '#c27a3a',
    ingredients,
  });
  const engine = parseAepCompositionSafe(c);
  expect(engine.success, engine.success ? '' : JSON.stringify(engine.error.issues.slice(0, 3))).toBe(true);
  expect(lightValidate(c).ok).toBe(true);
});

it('uses the engine schema version', () => expect(AEP_VERSION).toBe(AEP_SCHEMA_VERSION));
