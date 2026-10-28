import { describe, expect, expectTypeOf, it } from 'vitest';
import * as api from './api';
import type { Comp } from './api';

const CONTRACT = [
  'secToFrames', 'framesToSec', 'newFilmComposition', 'registerAsset', 'addScene', 'setSceneDuration', 'swapScenes', 'removeScene',
  'addLayer', 'removeLayer', 'setLayerHidden', 'reorderLayer', 'setTransform', 'setKeyframes', 'setText', 'setCamera',
  'sceneInfo', 'layerInfo', 'layerIdsByRole', 'summariseComposition',
];

describe('authoring api barrel', () => {
  it('exports all 20 contract functions, the extras and STUB_OWNER', () => {
    expect(CONTRACT).toHaveLength(20);
    for (const name of CONTRACT) expect(typeof (api as Record<string, unknown>)[name], name).toBe('function');
    for (const name of ['setAssetSrc', 'markPlaceholder', 'applyCameraIfSet', 'setProductNoun', 'getProductNoun', 'AuthoringError']) {
      expect(typeof (api as Record<string, unknown>)[name], name).toBe('function');
    }
    expect(api.STUB_OWNER).toBe('S3a');
  });

  it('matches the contract types', () => {
    expectTypeOf(api.addScene).parameters.toEqualTypeOf<[Comp, { id: string; durationSec: number; mode: 'motion' | 'generate'; intent?: string }]>();
    expectTypeOf(api.addScene).returns.toEqualTypeOf<Comp>();
    expectTypeOf(api.layerIdsByRole).returns.toEqualTypeOf<string[]>();
    expectTypeOf(api.setKeyframes).parameter(3).toEqualTypeOf<Array<[number, number]>>();
    expectTypeOf(api.summariseComposition).returns.toEqualTypeOf<string>();
    expectTypeOf(api.secToFrames).returns.toEqualTypeOf<number>();
    expectTypeOf(api.sceneInfo).returns.toExtend<Array<{ id: string; startSec: number; durationSec: number }>>();
  });
});
