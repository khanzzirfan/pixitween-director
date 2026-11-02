import { describe, expect, it } from 'vitest';
import { softLightBlend, softLightComposite } from './softLight';

// softLight (engine/src/core/softLight.ts): the W3C soft-light formula and the composite the
// engine's soft-light material draws.

describe('softLightBlend', () => {
  it('leaves the base where it is for a blend of 0.5 (the W3C result)', () => {
    // W3C soft light: Cs <= 0.5 -> Cb - (1 - 2 * Cs) * Cb * (1 - Cb), which is Cb at Cs = 0.5.
    expect(softLightBlend(0.2, 0.5)).toBeCloseTo(0.2, 12);
    expect(softLightBlend(0.5, 0.5)).toBeCloseTo(0.5, 12);
    expect(softLightBlend(0.8, 0.5)).toBeCloseTo(0.8, 12);
  });

  it('darkens with a dark blend and lifts with a light one', () => {
    // Cs <= 0.5 -> Cb - (1 - 2 * Cs) * Cb * (1 - Cb).
    expect(softLightBlend(0.5, 0)).toBeCloseTo(0.25, 12);
    expect(softLightBlend(0.2, 0)).toBeCloseTo(0.04, 12);
    expect(softLightBlend(0.5, 0.25)).toBeCloseTo(0.375, 12);
    // Cs > 0.5 -> Cb + (2 * Cs - 1) * (D(Cb) - 0.5), and D(0.5) = sqrt(0.5).
    expect(softLightBlend(0.5, 1)).toBeCloseTo(0.5 + (Math.sqrt(0.5) - 0.5), 12);
    expect(softLightBlend(0.8, 1)).toBeCloseTo(0.8 + (Math.sqrt(0.8) - 0.5), 12);
  });

  it('uses the polynomial D(Cb) below a quarter and the root above it', () => {
    // Cb <= 0.25: D(Cb) = ((16 * Cb - 12) * Cb + 4) * Cb.
    expect(softLightBlend(0.25, 1)).toBeCloseTo(0.25 + (((16 * 0.25 - 12) * 0.25 + 4) * 0.25 - 0.5), 12);
    expect(softLightBlend(0.2, 1)).toBeCloseTo(0.2 + (((16 * 0.2 - 12) * 0.2 + 4) * 0.2 - 0.5), 12);
  });
});

describe('softLightComposite', () => {
  it('leaves a mid-grey plate within 3 % under a white layer at half opacity', () => {
    // A white layer at opacity 0.5 is a half-grey blend (the engine blends in premultiplied
    // alpha), and soft light at 0.5 is the identity, so the plate stays where it was.
    const plate = 0.5;
    const result = softLightComposite(plate, 1, 0.5);

    expect(result).toBeCloseTo(plate, 12);
    expect(Math.abs(result - plate) / plate).toBeLessThan(0.03);
  });

  it('scales the layer colour by the opacity before the formula', () => {
    // The same blend at full opacity lifts the plate; at half opacity it barely moves it.
    expect(softLightComposite(0.5, 1, 1)).toBeCloseTo(0.5 + (Math.sqrt(0.5) - 0.5), 12);
    expect(softLightComposite(0.5, 1, 0.5)).toBeCloseTo(0.5, 12);
  });

  it('tones the frame with a coloured grade instead of covering it', () => {
    // A warm grade at 12 % keeps the plate's contrast: it moves a little, and the red channel
    // moves further than the blue one, so the frame reads warm rather than washed flat.
    const red = softLightComposite(0.5, 1, 0.12);
    const blue = softLightComposite(0.5, 0.44, 0.12);

    expect(red).toBeGreaterThan(blue);
    expect(Math.abs(red - 0.5)).toBeLessThan(0.05);
    expect(Math.abs(blue - 0.5)).toBeLessThan(0.05);
  });
});
