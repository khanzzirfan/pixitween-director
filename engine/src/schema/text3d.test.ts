import { describe, expect, it } from 'vitest';
import { parseMotionDoc } from './doc';
import type { MotionDocError } from './doc';
import { Object3DSchema } from './layer3d';
import { TweenSchema } from './parts';

const text3d = (extra: Record<string, unknown> = {}) => ({ type: 'text3d', font: 'f', text: 'Hi', ...extra });

function doc(layerExtra: Record<string, unknown> = {}, geometry: Record<string, unknown> = text3d(), assets?: Record<string, unknown>): unknown {
  return {
    version: 1,
    width: 1280,
    height: 720,
    duration: 6,
    assets: assets ?? { f: { type: 'font', url: '/fonts/helvetiker_bold.typeface.json' }, img: { type: 'image', url: '/a.png' } },
    layers: [
      {
        id: 'h',
        type: 'three',
        width: 512,
        height: 512,
        objects: [{ id: 't', geometry }],
        ...layerExtra,
      },
    ],
  };
}

function errorsOf(input: unknown): MotionDocError[] {
  const result = parseMotionDoc(input);
  if (result.ok) throw new Error('expected failure');
  return result.errors;
}

describe('text3d geometry', () => {
  it('fills the defaults', () => {
    const object = Object3DSchema.parse({ id: 't', geometry: text3d() });
    expect(object.geometry).toMatchObject({ size: 0.5, depth: 0.1, curveSegments: 8, align: 'center', lineHeight: 1.2, letterSpacing: 0 });
  });

  it('accepts a bevel with defaults', () => {
    const object = Object3DSchema.parse({ id: 't', geometry: text3d({ bevel: {} }) });
    expect(object.geometry).toMatchObject({ bevel: { thickness: 0.01, size: 0.01, segments: 2 } });
  });

  it('rejects empty text, 201 characters and bad limits with the field in the path', () => {
    expect(errorsOf(doc({}, text3d({ text: '' }))).map((e) => e.path)).toContain('layers[0].objects[0].geometry.text');
    expect(errorsOf(doc({}, text3d({ text: 'a'.repeat(201) }))).map((e) => e.path)).toContain('layers[0].objects[0].geometry.text');
    expect(parseMotionDoc(doc({}, text3d({ text: 'a'.repeat(200) }))).ok).toBe(true);
    for (const bad of [{ size: 0 }, { depth: -1 }, { curveSegments: 1 }, { curveSegments: 25 }]) {
      expect(parseMotionDoc(doc({}, text3d(bad))).ok).toBe(false);
    }
  });

  it('requires font to be a font asset', () => {
    expect(errorsOf(doc({}, text3d({ font: 'img' }))).map((e) => e.path)).toContain('layers[0].objects[0].geometry.font');
    expect(errorsOf(doc({}, text3d({ font: 'missing' }))).map((e) => e.path)).toContain('layers[0].objects[0].geometry.font');
    expect(parseMotionDoc(doc()).ok).toBe(true);
  });

  it('rejects a font url that is not http(s), data: or root-relative', () => {
    expect(parseMotionDoc(doc({}, text3d(), { f: { type: 'font', url: 'fonts/x.json' } })).ok).toBe(false);
  });

  it('rejects an animation on text3d', () => {
    expect(errorsOf(doc({ objects: [{ id: 't', geometry: text3d(), animation: {} }] })).map((e) => e.path)).toContain('layers[0].objects[0].animation');
  });
});

describe('tween stagger', () => {
  const tween = (extra: Record<string, unknown>) => ({ at: 0, duration: 1, to: { alpha: 1 }, ...extra });

  it('defaults from to start', () => {
    const parsed = TweenSchema.parse(tween({ target: 'glyphs:t', stagger: { each: 0.05 } }));
    expect(parsed.stagger).toEqual({ each: 0.05, from: 'start' });
  });

  it('accepts words and lines targets and every origin', () => {
    for (const target of ['words:t', 'lines:t']) {
      for (const from of ['start', 'end', 'center', 'edges']) {
        expect(TweenSchema.safeParse(tween({ target, stagger: { each: 0, from } })).success).toBe(true);
      }
    }
  });

  it('fails without a target or on a single-unit target, and on bad values', () => {
    for (const bad of [tween({ stagger: { each: 0.05 } }), tween({ target: 'camera', stagger: { each: 0.05 } }), tween({ target: 'object:t', stagger: { each: 0.05 } })]) {
      const result = TweenSchema.safeParse(bad);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].path).toEqual(['stagger']);
    }
    expect(TweenSchema.safeParse(tween({ target: 'glyphs:t', stagger: { each: -1 } })).success).toBe(false);
    expect(TweenSchema.safeParse(tween({ target: 'glyphs:t', stagger: { each: 1, from: 'random' } })).success).toBe(false);
  });

  it('reports the stagger path inside a doc', () => {
    const errors = errorsOf(doc({ tweens: [tween({ stagger: { each: 0.05 } })] }));
    expect(errors.map((e) => e.path)).toContain('layers[0].tweens[0].stagger');
  });
});

describe('text presets and unit targets', () => {
  it('accepts glyphWave on glyphs:t and the other kinds', () => {
    expect(parseMotionDoc(doc({ loop: { name: 'glyphWave', target: 'glyphs:t' } })).ok).toBe(true);
    expect(parseMotionDoc(doc({ enter: { name: 'glyphRise', target: 'glyphs:t' } })).ok).toBe(true);
    expect(parseMotionDoc(doc({ enter: { name: 'glyphPop', target: 'words:t' } })).ok).toBe(true);
    expect(parseMotionDoc(doc({ enter: { name: 'glyphFlip', target: 'lines:t' } })).ok).toBe(true);
    expect(parseMotionDoc(doc({ exit: { name: 'glyphFadeOut', target: 'glyphs:t' } })).ok).toBe(true);
  });

  it('rejects an unknown id, a non-text3d object, and a unit target on a 2D layer', () => {
    expect(errorsOf(doc({ loop: { name: 'glyphWave', target: 'glyphs:nope' } })).map((e) => e.path)).toContain('layers[0].loop.target');
    expect(errorsOf(doc({ objects: [{ id: 't', geometry: { type: 'box', size: [1, 1, 1] } }], loop: { name: 'glyphWave', target: 'glyphs:t' } })).map((e) => e.path)).toContain('layers[0].loop.target');
    const flat = { version: 1, width: 640, height: 360, duration: 4, layers: [{ id: 's', type: 'shape', shape: 'rect', width: 10, height: 10, enter: { name: 'glyphRise', target: 'glyphs:t' } }] };
    expect(errorsOf(flat).map((e) => e.path)).toContain('layers[0].enter.target');
  });

  it('still rejects an object: target on enter and exit', () => {
    expect(errorsOf(doc({ enter: { name: 'fadeIn', target: 'object:t' } })).map((e) => e.path)).toContain('layers[0].enter.target');
  });
});
