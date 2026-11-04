// The rotation unit rule (R8 US-001): a film's layer rotations are degrees when its
// `meta.rotationUnit` says so, and radians for a legacy film (no flag), which the converter
// turns into degrees so the engine reads them right.
import { describe, expect, it } from 'vitest';
import type { AepCompositionJson } from '@shared/aep/composition';
import type { AepAnimatable } from '@shared/aep/transform';
import { aepToMotion } from './index';

function comp(rotation: AepAnimatable<number>, meta?: Record<string, unknown>): AepCompositionJson {
  return {
    version: '1.12.0',
    id: 'film',
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 90,
    assets: {},
    layers: [
      {
        kind: 'shape',
        id: 'pack',
        inPoint: 0,
        outPoint: 90,
        path: { kind: 'rect', size: [100, 100] },
        transform: { position: [540, 960], anchor: [540, 960], scale: [1, 1], rotation, opacity: 1 },
      },
    ],
    ...(meta ? { meta } : {}),
  };
}

const KEYS = [
  { t: 0, v: -22 },
  { t: 30, v: 4 },
  { t: 60, v: 0 },
];

/** The rotation of every tween end, in order: the values a layer rotates through. */
function tweenRotations(layer: { tweens?: { from?: { rotation?: number }; to?: { rotation?: number } }[] }): (number | undefined)[] {
  return (layer.tweens ?? []).flatMap((tween) => [tween.from?.rotation, tween.to?.rotation]);
}

describe('aepToMotion rotation units', () => {
  it('keeps a degree rotation as degrees', () => {
    const { doc, warnings } = aepToMotion(comp(KEYS, { rotationUnit: 'deg' }));
    expect(warnings).toEqual([]);
    const layer = doc.layers[0];
    expect(layer.rotation).toBe(-22);
    expect(tweenRotations(layer)).toEqual([-22, 4, 4, 0]);
  });

  it('turns a legacy radian rotation into degrees', () => {
    const { doc, warnings } = aepToMotion(
      comp([
        { t: 0, v: -0.383972 },
        { t: 30, v: 0.069813 },
        { t: 60, v: 0 },
      ]),
    );
    expect(warnings).toEqual([]);
    const layer = doc.layers[0];
    expect(layer.rotation).toBeCloseTo(-22, 2);
    expect(tweenRotations(layer)).toEqual([expect.closeTo(-22, 2), expect.closeTo(4, 2), expect.closeTo(4, 2), expect.closeTo(0, 2)]);
  });

  it('reads a legacy static rotation as degrees too', () => {
    const { doc } = aepToMotion(comp(-0.383972));
    expect(doc.layers[0].rotation).toBeCloseTo(-22, 2);
  });

  it('names an unknown rotation unit instead of reading it silently', () => {
    const { warnings } = aepToMotion(comp(22, { rotationUnit: 'degrees' }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('rotationUnit');
  });
});
