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

  it('converts a drop-shadow effect to style.dropShadow', () => {
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
      angle: 180,
      blur: 8,
      alpha: 0.35,
      color: '#000000',
    });
    expect(warnings).toHaveLength(0);
  });

  it('warns on an unknown effect name without throwing', () => {
    const layer = headlineLayer({
      effects: [{ name: 'glow', params: {} }],
    });
    expect(() => convertText(layer, 30)).not.toThrow();
    const { warnings } = convertText(layer, 30);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('glow');
  });
});
