import { describe, expect, it } from 'vitest';
import type { AepLayer } from '@shared/aep/layer';
import { convertText } from './text';

type AepTextLayer = Extract<AepLayer, { kind: 'text' }>;

function headlineLayer(overrides: Partial<AepTextLayer> = {}): AepTextLayer {
  return {
    kind: 'text',
    id: 'headline',
    inPoint: 0,
    outPoint: 120,
    source: 'Slow mornings',
    style: {
      font: 'Inter, system-ui, sans-serif',
      size: 76,
      fill: '#ffffff',
      weight: 700,
      align: 'center',
      boxWidth: 1536,
    },
    transform: {
      position: [960, 540],
      anchor: [0, 0],
      scale: [1, 1],
      rotation: 0,
      opacity: 1,
    },
    ...overrides,
  };
}

describe('convertText', () => {
  it('converts source, font, size, weight, align and boxWidth', () => {
    const { layer, warnings } = convertText(headlineLayer(), 30);
    expect(layer.type).toBe('text');
    expect(layer.text).toBe('Slow mornings');
    expect(layer.style.fontFamily).toBe('Inter, system-ui, sans-serif');
    expect(layer.style.fontSize).toBe(76);
    expect(layer.style.fontWeight).toBe('700');
    expect(layer.style.align).toBe('center');
    expect(layer.style.wordWrapWidth).toBe(1536);
    expect(layer.style.fill).toBe('#ffffff');
    expect(warnings).toHaveLength(0);
  });

  it('converts a drop-shadow effect to style.dropShadow, falling the way the AEP direction says', () => {
    const layer = headlineLayer({
      effects: [
        {
          name: 'drop-shadow',
          params: { distance: 4, direction: 180, softness: 8, opacity: 0.35, color: '#000000' },
        },
      ],
    });
    const { layer: converted, warnings } = convertText(layer, 30);
    expect(converted.style.dropShadow).toEqual({
      distance: 4,
      // The AEP direction 180 is straight down; the engine's angle is the same vector from the right.
      angle: 90,
      blur: 8,
      alpha: 0.35,
      color: '#000000',
    });
    expect(warnings).toHaveLength(0);
  });

  it('scales the text shadow distance from the player stage to the comp', () => {
    const layer = headlineLayer({
      effects: [{ name: 'drop-shadow', params: { distance: 4, direction: 180, softness: 8, opacity: 0.35, color: '#000000' } }],
    });
    const { layer: converted } = convertText(layer, 30, undefined, { width: 1080, height: 1920 });
    expect(converted.style.dropShadow?.distance).toBe(8);
  });

  it('puts the other effects of a text layer in the layer effects', () => {
    const layer = headlineLayer({ effects: [{ name: 'gaussian-blur', params: { blurriness: 9 } }] });
    const { layer: converted, warnings } = convertText(layer, 30, undefined, { width: 1080, height: 1920 });
    expect(converted.effects).toEqual([{ id: 'fx0', type: 'gaussianBlur', enabled: true, params: { strength: 18 } }]);
    expect(warnings).toHaveLength(0);
  });

  it('warns on an effect the engine has no counterpart for, without throwing', () => {
    const layer = headlineLayer({
      effects: [{ name: 'levels', params: {} }],
    });
    expect(() => convertText(layer, 30)).not.toThrow();
    const { warnings } = convertText(layer, 30);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('headline');
    expect(warnings[0]).toContain('levels');
  });

  it("reads the anchor against the composition: [W/2, H/2] centres the text on its position", () => {
    const layer = headlineLayer({ transform: { position: [540, 320], anchor: [540, 960], scale: [1, 1], rotation: 0, opacity: 1 } });
    const { layer: out } = convertText(layer, 30, undefined, { width: 1080, height: 1920 });
    expect(out.anchor).toEqual([0.5, 0.5]);
    expect(out.pivot).toBeUndefined();
    const left = convertText(headlineLayer({ transform: { ...layer.transform, anchor: [0, 0] } }), 30, undefined, { width: 1080, height: 1920 });
    expect(left.layer.anchor).toEqual([0, 0]);
  });
});
