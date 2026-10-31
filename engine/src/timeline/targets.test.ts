/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { parseMotionDoc } from '../schema/doc';
import type { MotionDoc } from '../schema/doc';
import { validateTargets } from './targets';

function parse(input: unknown): MotionDoc {
  const result = parseMotionDoc(input);
  if (!result.ok) throw new Error(`did not parse: ${JSON.stringify(result.errors)}`);
  return result.doc;
}

function docWith(layer: unknown): MotionDoc {
  return parse({ version: 1, width: 320, height: 240, duration: 6, layers: [layer] });
}

function threeLayer(extra: Record<string, unknown> = {}): unknown {
  return {
    id: 'hero',
    type: 'three',
    width: 320,
    height: 240,
    objects: [{ id: 'can', geometry: { type: 'sphere', radius: 1 } }],
    ...extra,
  };
}

const fixtures = Object.entries(import.meta.glob('../../fixtures/*.json', { eager: true, import: 'default' }) as Record<string, unknown>);

describe('validateTargets', () => {
  it('reports a camera target on a text layer as one error at the target path', () => {
    const doc = docWith({
      id: 'title',
      type: 'text',
      text: 'hello',
      tweens: [{ target: 'camera', at: 0, duration: 1, ease: 'none', to: { x: 10 } }],
    });

    const errors = validateTargets(doc);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('layers[0].tweens[0].target');
  });

  it('reports an object the three layer does not have', () => {
    const doc = docWith(threeLayer({ tweens: [{ target: 'object:nope', at: 0, duration: 1, ease: 'none', to: { 'rotation.y': 90 } }] }));

    const errors = validateTargets(doc);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('layers[0].tweens[0].target');
    expect(errors[0].message).toContain('nope');
  });

  it('accepts the preset light light:key with no declared lights', () => {
    const doc = docWith(threeLayer({ tweens: [{ target: 'light:key', at: 0, duration: 1, ease: 'none', to: { intensity: 2 } }] }));

    expect(validateTargets(doc)).toEqual([]);
  });

  it('reports an object property outside the allowlist', () => {
    const doc = docWith(threeLayer({ tweens: [{ target: 'object:can', at: 0, duration: 1, ease: 'none', to: { 'rotation.w': 1 } }] }));

    const errors = validateTargets(doc);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toContain('rotation.w');
    expect(errors[0].message).toContain('rotation.w');
  });

  it('accepts rotation.y and material.color on an object', () => {
    const doc = docWith(
      threeLayer({ tweens: [{ target: 'object:can', at: 0, duration: 1, ease: 'none', to: { 'rotation.y': 90, 'material.color': '#ff0000' } }] }),
    );

    expect(validateTargets(doc)).toEqual([]);
  });

  it('validates all four m1 fixtures with zero errors', () => {
    expect(fixtures.map(([path]) => path).sort()).toEqual([
      '../../fixtures/basic-2d.json',
      '../../fixtures/three-gltf.json',
      '../../fixtures/three-postfx.json',
      '../../fixtures/three-primitives.json',
    ]);

    for (const [path, raw] of fixtures) {
      const result = parseMotionDoc(raw);
      if (!result.ok) throw new Error(`${path}: ${JSON.stringify(result.errors)}`);
      expect(validateTargets(result.doc), path).toEqual([]);
    }
  });
});
