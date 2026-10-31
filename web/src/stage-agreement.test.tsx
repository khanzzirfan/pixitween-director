// The stage tools' output must be accepted by the engine's own schema parser (the server tests only have the light validator).
import { parseAepCompositionSafe } from 'reacthub-pixitweenjs';
import { expect, it } from 'vitest';
import { addLayer, addScene, newFilmComposition, registerAsset } from '../../server/authoring/api';
import { addStage, cueClip, moveActor, placeActor, placeProduct3D, placeProp, setLightCue } from '../../server/cartoon/stage-api';

function film() {
  let c = newFilmComposition({ aspect: '16:9', title: 'Pip', palette: ['#111827'] });
  for (const id of ['hero', 'walk', 'crate']) c = registerAsset(c, { id, kind: 'model', src: `/cartoon/${id}.glb` });
  c = registerAsset(c, { id: 'backdrop', kind: 'image', src: '/cartoon/backdrop.png', width: 1024, height: 512 });
  c = addScene(c, { id: 's1', durationSec: 4, mode: 'motion' });
  c = addLayer(c, { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#f4ead5' });
  c = addLayer(c, { sceneId: 's1', role: 'headline', kind: 'text', text: 'Pip' });
  c = addStage(c, 's1', { backdropAssetId: 'backdrop' });
  c = placeActor(c, 's1', 'hero', 'hero', [-0.5, 0, 90]);
  c = placeActor(c, 's1', 'pal', 'hero', [2, 0, -90], { inFrame: 10, height: 0.8 });
  c = cueClip(c, 's1', 'hero', { name: 'Wave' }, 30);
  c = cueClip(c, 's1', 'pal', { assetId: 'walk' }, 40, { loop: true });
  c = moveActor(c, 's1', 'pal', [0.5, 0, -90], 10, 50);
  c = placeProp(c, 's1', 'crate', { assetId: 'crate', size: 0.3, position: [-1.5, 0, 0.3] });
  c = placeProduct3D(c, 's1', 'can', { shape: 'can', size: 0.18, attach: { actor: 'hero', bone: 'RightHand' } });
  return c;
}

it('the engine accepts a full shot written by the stage tools', () => {
  const r = parseAepCompositionSafe(film());
  expect(r.success, JSON.stringify((r as { error?: { issues?: unknown[] } }).error?.issues?.slice(0, 3))).toBe(true);
});

it.each(['dawn', 'studio', 'spotlight', 'night'] as const)('the engine accepts the %s light', (cue) => {
  expect(parseAepCompositionSafe(setLightCue(film(), 's1', cue)).success).toBe(true);
});

it('the engine rejects a keyframed stage camera', () => {
  const c = structuredClone(film()) as any;
  c.precomps.s1.layers.find((l: any) => l.kind === 'stage3d').camera.position = [{ t: 0, v: [0, 1, 6] }];
  expect(parseAepCompositionSafe(c).success).toBe(false);
});
