import { describe, expect, it } from 'vitest';
import { mapBaseLayer, type AepBaseLayer } from './baseLayer';

function layer(overrides: Partial<AepBaseLayer> = {}): AepBaseLayer {
  return {
    id: 'layer-1',
    inPoint: 0,
    outPoint: 120,
    transform: {
      position: [960, 540],
      anchor: [960, 540],
      scale: [1, 1],
      rotation: 0,
      opacity: 1,
    },
    ...overrides,
  };
}

describe('mapBaseLayer', () => {
  it('converts inPoint/outPoint frames to seconds at the comp fps', () => {
    const { base } = mapBaseLayer(layer({ inPoint: 0, outPoint: 120 }), 30);
    expect(base.start).toBe(0);
    expect(base.end).toBe(4);
  });

  it('maps a constant transform with no tweens', () => {
    const { base, tweens } = mapBaseLayer(layer(), 30);
    expect(base.x).toBe(960);
    expect(base.y).toBe(540);
    expect(base.pivot).toEqual([960, 540]);
    expect(base.scale).toBe(1);
    expect(base.rotation).toBe(0);
    expect(base.alpha).toBe(1);
    expect(tweens).toHaveLength(0);
  });

  it('emits one tween on scale for a uniform keyframed scale', () => {
    const { tweens } = mapBaseLayer(
      layer({
        transform: {
          position: [960, 540],
          anchor: [960, 540],
          scale: [
            { t: 0, v: [0.9964, 0.9964] },
            { t: 30, v: [1.09604, 1.09604] },
          ],
          rotation: 0,
          opacity: 1,
        },
      }),
      30,
    );
    expect(tweens).toHaveLength(1);
    expect(tweens[0].from).toEqual({ scale: 0.9964 });
    expect(tweens[0].to).toEqual({ scale: 1.09604 });
  });

  it('emits scaleX/scaleY tweens for a non-uniform keyframed scale', () => {
    const { tweens } = mapBaseLayer(
      layer({
        transform: {
          position: [960, 540],
          anchor: [960, 540],
          scale: [
            { t: 0, v: [1, 1] },
            { t: 30, v: [2, 1.5] },
          ],
          rotation: 0,
          opacity: 1,
        },
      }),
      30,
    );
    expect(tweens).toHaveLength(1);
    expect(tweens[0].from).toEqual({ scaleX: 1, scaleY: 1 });
    expect(tweens[0].to).toEqual({ scaleX: 2, scaleY: 1.5 });
  });

  it("maps an unsupported blendMode to 'normal' with a warning naming the layer id", () => {
    const { base, warnings } = mapBaseLayer(layer({ blendMode: 'overlay' }), 30);
    expect(base.blendMode).toBe('normal');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('layer-1');
  });

  it('passes through a supported blendMode without warnings', () => {
    const { base, warnings } = mapBaseLayer(layer({ blendMode: 'multiply' }), 30);
    expect(base.blendMode).toBe('multiply');
    expect(warnings).toHaveLength(0);
  });
});
