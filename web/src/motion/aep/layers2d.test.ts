import { describe, expect, it } from 'vitest';
import type { AepLayer } from '@shared/aep/layer';
import { convertAssets } from './assets';
import { convertImage, convertShape } from './layers2d';
import { sanitizeId } from './sanitizeId';

type AepShapeLayer = Extract<AepLayer, { kind: 'shape' }>;
type AepImageLayer = Extract<AepLayer, { kind: 'image' }>;

// Copied from the stored film `film_1687b193e007` (precomp `s1`'s `s1:bg` / `s1:product`).
function wakeBgLayer(): AepShapeLayer {
  return {
    kind: 'shape',
    id: 'wake:bg',
    name: 'bg',
    inPoint: 0,
    outPoint: 120,
    path: { kind: 'rect', size: [1920, 1080] },
    fill: '#F2E6CC',
    transform: {
      position: [960, 540],
      anchor: [960, 540],
      scale: [1, 1],
      rotation: 0,
      opacity: 1,
    },
  };
}

function productImageLayer(assetId: string): AepImageLayer {
  return {
    kind: 'image',
    id: 's1:product',
    name: 'product',
    inPoint: 0,
    outPoint: 120,
    assetId,
    transform: {
      position: [960, 561.6],
      anchor: [192, 336],
      scale: [0.9964, 0.9964],
      rotation: 0,
      opacity: 1,
    },
  };
}

describe('convertShape', () => {
  it('converts the stored wake:bg rect to a shape rect with pivot from anchor', () => {
    const { layer, warnings } = convertShape(wakeBgLayer(), 30);
    expect(layer.type).toBe('shape');
    expect(layer.shape).toBe('rect');
    expect(layer.width).toBe(1920);
    expect(layer.height).toBe(1080);
    expect(layer.fill).toBe('#F2E6CC');
    expect(layer.pivot).toEqual([960, 540]);
    expect(warnings).toHaveLength(0);
  });
});

describe('convertImage + convertAssets', () => {
  const assetId = 'ast_87a5d210b1b66dc85f2bdef3cae928c0';

  it('converts an image layer whose asset exists in the converted assets, with the asset src as url', () => {
    const assetMap = { [assetId]: { type: 'image' as const, src: '/api/assets/ast_87a5d210b1b66dc85f2bdef3cae928c0', width: 384, height: 672 } };
    const { assets } = convertAssets(assetMap);
    const { layer, warnings } = convertImage(productImageLayer(assetId), 30);

    expect(layer.type).toBe('image');
    expect(assets[layer.asset]).toBeDefined();
    expect(assets[layer.asset]).toEqual({ type: 'image', url: '/api/assets/ast_87a5d210b1b66dc85f2bdef3cae928c0' });
    expect(warnings).toHaveLength(0);
  });

  it('sanitises an id that fails the engine IdSchema the same way in the asset table and the layer reference', () => {
    const invalidId = 'ast:87a5 weird id';
    const assetMap = { [invalidId]: { type: 'image' as const, src: '/api/assets/weird' } };
    const { assets } = convertAssets(assetMap);
    const { layer } = convertImage(productImageLayer(invalidId), 30);

    expect(layer.asset).toBe(sanitizeId(invalidId));
    expect(assets[sanitizeId(invalidId)]).toBeDefined();
    expect(assets[layer.asset]).toEqual({ type: 'image', url: '/api/assets/weird' });
  });

  it('does not include audio assets in the converted asset table', () => {
    const assetMap = {
      [assetId]: { type: 'image' as const, src: '/api/assets/image' },
      track: { type: 'audio' as const, src: '/api/assets/track.mp3' },
    };
    const { assets } = convertAssets(assetMap);

    expect(Object.keys(assets)).toEqual([assetId]);
    expect(assets['track']).toBeUndefined();
    expect(assets[sanitizeId('track')]).toBeUndefined();
  });
});
