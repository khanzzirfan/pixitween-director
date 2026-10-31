import { describe, expect, it } from 'vitest';
import { ColorSchema, EaseSchema, IdSchema, ParamValueSchema, SecondsSchema, Vec3Schema } from './scalars';
import { FILTER_2D_TYPES, POSTFX_TYPES, PRESET_KINDS, PRESET_NAMES, PresetNameSchema } from './enums';
import { Filter2DSchema, PostFxSchema, PresetRefSchema, TweenSchema } from './parts';

describe('scalars', () => {
  it('accepts 6 and 8 digit colours and rejects the rest', () => {
    expect(ColorSchema.parse('#a1B2c3')).toBe('#a1B2c3');
    expect(ColorSchema.parse('#a1b2c3ff')).toBe('#a1b2c3ff');
    for (const bad of ['red', '#abc', '#a1b2c3f']) {
      expect(ColorSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('validates ids, seconds and vectors', () => {
    expect(IdSchema.safeParse('a').success).toBe(true);
    expect(IdSchema.safeParse('1a').success).toBe(false);
    expect(SecondsSchema.safeParse(-1).success).toBe(false);
    expect(SecondsSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
    expect(Vec3Schema.safeParse([1, 2, 3]).success).toBe(true);
    expect(Vec3Schema.safeParse([1, 2]).success).toBe(false);
  });

  it('accepts known eases, defaults and rejects unknown ones', () => {
    for (const ease of ['power2.inOut', 'back.out(1.7)', 'none', 'sine']) {
      expect(EaseSchema.parse(ease)).toBe(ease);
    }
    expect(EaseSchema.parse(undefined)).toBe('power2.inOut');
    expect(EaseSchema.safeParse('superBounce').success).toBe(false);
  });

  it('accepts only number, string or boolean params', () => {
    expect(ParamValueSchema.safeParse(4).success).toBe(true);
    expect(ParamValueSchema.safeParse('#ffffff').success).toBe(true);
    expect(ParamValueSchema.safeParse(true).success).toBe(true);
    expect(ParamValueSchema.safeParse({}).success).toBe(false);
  });
});

describe('preset names', () => {
  it('lists every preset with its kind', () => {
    const names = PRESET_NAMES.map((preset) => preset.name);
    expect(names).toEqual(expect.arrayContaining(['fadeIn', 'slideInUp', 'popIn', 'fadeOut', 'zoomOut', 'spin', 'float', 'pulse', 'sway']));
    for (const preset of PRESET_NAMES) {
      expect(['enter', 'exit', 'loop']).toContain(preset.kind);
      expect(PRESET_KINDS[preset.name]).toBe(preset.kind);
    }
    expect(PresetNameSchema.safeParse('fadeIn').success).toBe(true);
    expect(PresetNameSchema.safeParse('superBounce').success).toBe(false);
  });

  it('exposes the filter and postFx type lists', () => {
    expect(FILTER_2D_TYPES).toHaveLength(15);
    expect(POSTFX_TYPES).toHaveLength(7);
  });
});

describe('TweenSchema', () => {
  it('fills the ease, repeat and yoyo defaults', () => {
    const tween = TweenSchema.parse({ at: 0, duration: 1, to: { x: 5 } });
    expect(tween.ease).toBe('power2.inOut');
    expect(tween.repeat).toBe(0);
    expect(tween.yoyo).toBe(false);
    expect(tween.to).toEqual({ x: 5 });
  });

  it('rejects repeat over 100, unknown keys and an empty to', () => {
    expect(TweenSchema.safeParse({ at: 0, duration: 1, to: { x: 5 }, repeat: 101 }).success).toBe(false);
    expect(TweenSchema.safeParse({ at: 0, duration: 1, to: { x: 5 }, foo: true }).success).toBe(false);
    expect(TweenSchema.safeParse({ at: 0, duration: 1, to: {} }).success).toBe(false);
    expect(TweenSchema.safeParse({ duration: 1, to: { x: 5 } }).success).toBe(false);
  });
});

describe('PresetRefSchema', () => {
  it('accepts a name alone and rejects unknown names, keys and a zero duration', () => {
    expect(PresetRefSchema.parse({ name: 'fadeIn' })).toEqual({ name: 'fadeIn' });
    expect(PresetRefSchema.safeParse({ name: 'fadeIn', duration: 0 }).success).toBe(false);
    expect(PresetRefSchema.safeParse({ name: 'nope' }).success).toBe(false);
    expect(PresetRefSchema.safeParse({ name: 'fadeIn', foo: 1 }).success).toBe(false);
  });

  it('accepts a loop target and params', () => {
    const ref = PresetRefSchema.parse({ name: 'spin', target: 'object:can', params: { turnsPerSecond: 0.15 } });
    expect(ref.target).toBe('object:can');
    expect(ref.params).toEqual({ turnsPerSecond: 0.15 });
  });
});

describe('Filter2DSchema and PostFxSchema', () => {
  it('fills enabled and params defaults', () => {
    expect(Filter2DSchema.parse({ id: 'soft', type: 'blur' })).toEqual({ id: 'soft', type: 'blur', enabled: true, params: {} });
    expect(PostFxSchema.parse({ id: 'glow', type: 'bloom' })).toEqual({ id: 'glow', type: 'bloom', enabled: true, params: {} });
  });

  it('rejects unknown types, missing ids and unknown keys', () => {
    expect(Filter2DSchema.safeParse({ id: 'soft', type: 'nope' }).success).toBe(false);
    expect(Filter2DSchema.safeParse({ type: 'blur' }).success).toBe(false);
    expect(Filter2DSchema.safeParse({ id: 'soft', type: 'blur', foo: 1 }).success).toBe(false);
    expect(PostFxSchema.safeParse({ id: 'glow', type: 'bloom', params: { intensity: 'high' } }).success).toBe(false);
  });
});
