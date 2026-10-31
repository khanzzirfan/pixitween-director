import { describe, expect, it } from 'vitest';
import { finishComposition } from './finish';
import type { Comp } from './types';

const t = { position: [0, 0], anchor: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 };
const film = (): Comp =>
  ({
    version: '1.9.0', id: 'film', width: 1080, height: 1920, fps: 30, durationInFrames: 120, bgColor: '#000', assets: {},
    layers: [{ kind: 'precomp', id: 's1', inPoint: 0, outPoint: 120, compId: 's1', width: 1080, height: 1920, transform: t }],
    precomps: {
      s1: {
        version: '1.9.0', id: 's1', width: 1080, height: 1920, fps: 30, durationInFrames: 120, assets: {},
        layers: [
          { kind: 'image', id: 's1:product', inPoint: 0, outPoint: 120, assetId: 'a', transform: t },
          { kind: 'text', id: 's1:headline', inPoint: 0, outPoint: 120, source: '$4.50', style: { font: 'Inter', size: 100, fill: '#000' }, transform: t },
        ],
      },
    },
    meta: { director: { scenes: {}, layers: { 's1:product': { role: 'product' } } } },
  }) as unknown as Comp;

describe('finishComposition', () => {
  it('shades the product, grades under the type and adds the music bed', () => {
    const out = finishComposition(film(), { musicAssetId: 'bed' }) as any;
    const ls = out.precomps.s1.layers;
    expect(ls[0].effects[0].name).toBe('drop-shadow');
    expect(ls.map((l: any) => l.id)).toEqual(['s1:product', 'finish:s1:grade', 'finish:s1:flash', 's1:headline']);
    expect(ls[3].style.size).toBeGreaterThanOrEqual(168);
    expect(out.layers[0]).toMatchObject({ kind: 'audio', assetId: 'bed' });
  });

  it('is idempotent', () => {
    const once = finishComposition(film(), { musicAssetId: 'bed' });
    expect(finishComposition(once, { musicAssetId: 'bed' })).toEqual(once);
  });
});
