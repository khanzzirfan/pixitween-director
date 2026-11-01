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

  it('accepts the camera rig targets', () => {
    const doc = docWith(
      threeLayer({
        tweens: [
          {
            target: 'camera',
            at: 0,
            duration: 1,
            ease: 'none',
            to: { 'rig.pan': 90, 'rig.tilt': 5, 'rig.roll': 0, 'rig.dolly': 0.5, 'rig.truck': 1, 'rig.pedestal': 0.25 },
          },
        ],
      }),
    );

    expect(validateTargets(doc)).toEqual([]);
  });

  it('rejects a camera property that is not a rig move', () => {
    const doc = docWith(threeLayer({ tweens: [{ target: 'camera', at: 0, duration: 1, ease: 'none', to: { 'rig.zoom': 2 } }] }));

    const errors = validateTargets(doc);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('rig.zoom');
    expect(errors[0].path).toContain('rig.zoom');
  });

  it('validates every fixture with zero errors', () => {
    expect(fixtures.map(([path]) => path).sort()).toEqual([
      '../../fixtures/basic-2d.json',
      '../../fixtures/camera-moves.json',
      '../../fixtures/effects-2d.json',
      '../../fixtures/showcase-product-turntable.json',
      '../../fixtures/showcase-robot-dance.json',
      '../../fixtures/showcase-title-card.json',
      '../../fixtures/three-gltf.json',
      '../../fixtures/three-postfx.json',
      '../../fixtures/three-primitives.json',
      '../../fixtures/three-text.json',
    ]);

    for (const [path, raw] of fixtures) {
      const result = parseMotionDoc(raw);
      if (!result.ok) throw new Error(`${path}: ${JSON.stringify(result.errors)}`);
      expect(validateTargets(result.doc), path).toEqual([]);
    }
  });
});

describe('effect targets', () => {
  const text = (target: string, to: Record<string, unknown> = { strength: 3 }) =>
    docWith({ id: 'title', type: 'text', text: 'hi', effects: [{ id: 'g', type: 'glow' }], tweens: [{ target, at: 0, duration: 1, ease: 'none', to }] });

  it('accepts effect:<id> on a 2D layer that has the effect', () => {
    expect(validateTargets(text('effect:g'))).toEqual([]);
  });

  it('rejects the old filter: and postfx: forms and a missing effect id', () => {
    expect(validateTargets(text('filter:g'))).toHaveLength(1);
    expect(validateTargets(text('postfx:g'))).toHaveLength(1);
    expect(validateTargets(text('effect:nope'))).toHaveLength(1);
  });

  it('no longer allows skewX on the layer', () => {
    const doc = docWith({ id: 'title', type: 'text', text: 'hi', tweens: [{ at: 0, duration: 1, ease: 'none', to: { skewX: 10 } }] });
    expect(validateTargets(doc)).toHaveLength(1);
  });
  describe('unit targets', () => {
    const text3d = (text: string, tweens: unknown[], extra: Record<string, unknown> = {}) =>
      parse({
        version: 1,
        width: 320,
        height: 240,
        duration: 6,
        assets: { f: { type: 'font', url: '/fonts/f.json' } },
        layers: [
          {
            id: 'hero',
            type: 'three',
            width: 320,
            height: 240,
            end: 2,
            objects: [{ id: 't', geometry: { type: 'text3d', font: 'f', text } }],
            tweens,
            ...extra,
          },
        ],
      });
    const tw = (o: Record<string, unknown>) => ({ target: 'glyphs:t', at: 0, duration: 1, ease: 'none', to: { 'offset.y': 1 }, ...o });

    it('reports glyphs:t on a text layer and on an image layer', () => {
      const textDoc = docWith({ id: 'a', type: 'text', text: 'hi', tweens: [tw({})] });
      const imageDoc = parse({
        version: 1,
        width: 320,
        height: 240,
        duration: 6,
        assets: { img: { type: 'image', url: '/a.png' } },
        layers: [{ id: 'a', type: 'image', asset: 'img', tweens: [tw({})] }],
      });
      for (const doc of [textDoc, imageDoc]) {
        const errors = validateTargets(doc);
        expect(errors).toHaveLength(1);
        expect(errors[0].path).toBe('layers[0].tweens[0].target');
      }
    });

    it('names alpha on words:t, accepts alpha and offset.y on glyphs:t', () => {
      const bad = validateTargets(text3d('hello world', [tw({ target: 'words:t', to: { alpha: 0 } })]));
      expect(bad).toHaveLength(1);
      expect(bad[0].message).toContain('alpha');
      expect(validateTargets(text3d('hello world', [tw({ to: { 'offset.y': 1, alpha: 0 } })]))).toEqual([]);
    });

    it('warns when a stagger runs past the layer end', () => {
      const text = 'abcdefghijkl';
      const late = validateTargets(text3d(text, [tw({ stagger: { each: 0.1 } })]));
      expect(late).toHaveLength(1);
      expect(late[0].severity).toBe('warning');
      expect(validateTargets(text3d(text, [tw({ stagger: { each: 0.05 } })]))).toEqual([]);
    });
  });
});
