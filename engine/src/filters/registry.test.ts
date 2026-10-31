import { BlurFilter, ColorMatrixFilter, NoiseFilter, type Filter } from 'pixi.js';
import {
  AdjustmentFilter,
  AdvancedBloomFilter,
  CRTFilter,
  DropShadowFilter,
  GlitchFilter,
  GlowFilter,
  GodrayFilter,
  OldFilmFilter,
  OutlineFilter,
  PixelateFilter,
  RGBSplitFilter,
  ZoomBlurFilter,
} from 'pixi-filters';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FILTERS, type FilterDef } from './registry';

type FilterCtor = new (...args: any[]) => Filter;

// GlitchFilter draws its displacement map onto a real 2D canvas; web/src/test-setup.ts
// stubs getContext to null, so give it a minimal recording double for these tests.
const originalGetContext = HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => ({
    clearRect: () => {},
    fillRect: () => {},
    fillStyle: '',
  })) as never;
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

/** Asserts the shared contract of one registry entry against its live pixi filter. */
function verify<F extends Filter>(key: keyof typeof FILTERS, def: FilterDef<F>, ctor: FilterCtor): void {
  expect(def.type).toBe(key);

  const filter = def.create({});
  expect(filter).toBeInstanceOf(ctor);

  for (const [param, spec] of Object.entries(def.tweenable)) {
    // every tweenable param must be a declared default, so `create(params)` can always seed it
    expect(Object.keys(def.defaults)).toContain(param);

    // the freshly created filter can be read back at its documented default. Numbers
    // compare with a tolerance: several pixi-filters uniforms are float32 arrays and the
    // glitch direction is stored as radians, so a value does not round-trip bit-exactly.
    const expected = def.defaults[param];
    if (spec.kind === 'number') {
      expect(spec.get(filter) as number).toBeCloseTo(expected as number, 6);
    } else {
      expect(spec.get(filter)).toBe(expected);
    }

    // and the writer/reader pair round-trips, which is what the timeline tweens through
    const next = spec.kind === 'number' ? 3 : '#3366ff';
    spec.set(filter, next);
    if (spec.kind === 'number') {
      expect(spec.get(filter) as number).toBeCloseTo(next as number, 6);
    } else {
      expect(spec.get(filter)).toBe(next);
    }
  }
}

describe('FILTERS registry', () => {
  it('exposes the ported 2D filters keyed by their type', () => {
    expect(Object.keys(FILTERS)).toEqual([
      'blur', 'glow', 'bloom', 'dropShadow', 'adjustment', 'outline',
      'colorMatrix', 'noise', 'rgbSplit', 'pixelate', 'zoomBlur',
      'crt', 'oldFilm', 'godray', 'glitch',
    ]);

    for (const [key, def] of Object.entries(FILTERS)) {
      expect(def.type).toBe(key);
    }
  });

  it('blur', () => verify('blur', FILTERS.blur, BlurFilter));
  it('glow', () => verify('glow', FILTERS.glow, GlowFilter));
  it('bloom', () => verify('bloom', FILTERS.bloom, AdvancedBloomFilter));
  it('dropShadow', () => verify('dropShadow', FILTERS.dropShadow, DropShadowFilter));
  it('adjustment', () => verify('adjustment', FILTERS.adjustment, AdjustmentFilter));
  it('outline', () => verify('outline', FILTERS.outline, OutlineFilter));
  it('colorMatrix', () => verify('colorMatrix', FILTERS.colorMatrix, ColorMatrixFilter));
  it('noise', () => verify('noise', FILTERS.noise, NoiseFilter));
  it('rgbSplit', () => verify('rgbSplit', FILTERS.rgbSplit, RGBSplitFilter));
  it('pixelate', () => verify('pixelate', FILTERS.pixelate, PixelateFilter));
  it('zoomBlur', () => verify('zoomBlur', FILTERS.zoomBlur, ZoomBlurFilter));
  it('crt', () => verify('crt', FILTERS.crt, CRTFilter));
  it('oldFilm', () => verify('oldFilm', FILTERS.oldFilm, OldFilmFilter));
  it('godray', () => verify('godray', FILTERS.godray, GodrayFilter));
  it('glitch', () => verify('glitch', FILTERS.glitch, GlitchFilter));

  it('glow.create merges defaults and overrides outerStrength', () => {
    const filter = FILTERS.glow.create({ ...FILTERS.glow.defaults, outerStrength: 3 });

    expect(filter).toBeInstanceOf(GlowFilter);
    expect(filter.outerStrength).toBe(3);
  });

  it('dropShadow maps offsetX and offsetY onto the offset point', () => {
    const filter = FILTERS.dropShadow.create({ ...FILTERS.dropShadow.defaults, offsetX: 6, offsetY: -2 });

    expect(filter.offset).toEqual({ x: 6, y: -2 });
  });

  it('rgbSplit maps redX and redY onto the red offset point', () => {
    const filter = FILTERS.rgbSplit.create({ ...FILTERS.rgbSplit.defaults, redX: -4, redY: 0 });

    expect(filter.red).toEqual({ x: -4, y: 0 });
  });

  it('colorMatrix preset grayscale with amount 1 grades away from none', () => {
    const grayscale = FILTERS.colorMatrix.create({ ...FILTERS.colorMatrix.defaults, preset: 'grayscale' });
    const none = FILTERS.colorMatrix.create({ ...FILTERS.colorMatrix.defaults, preset: 'none' });

    expect([...grayscale.matrix]).not.toEqual([...none.matrix]);
  });

  it('colorMatrix rebuilds the matrix when amount is set', () => {
    const filter = FILTERS.colorMatrix.create({ ...FILTERS.colorMatrix.defaults, preset: 'grayscale' });
    const before = [...filter.matrix];

    FILTERS.colorMatrix.tweenable.amount.set(filter, 0.5);

    expect(FILTERS.colorMatrix.tweenable.amount.get(filter)).toBe(0.5);
    expect([...filter.matrix]).not.toEqual(before);
  });

  it('round-trips colours case-insensitively as #rrggbb', () => {
    const filter = FILTERS.outline.create(FILTERS.outline.defaults);
    FILTERS.outline.tweenable.color.set(filter, '#AABBCC');

    expect(String(FILTERS.outline.tweenable.color.get(filter)).toLowerCase()).toBe('#aabbcc');
  });

  it('overlays explicit params on top of the defaults', () => {
    const outline = FILTERS.outline.create({ thickness: 5, color: '#ff0000', alpha: 0.5 });

    expect(outline.thickness).toBe(5);
    expect(outline.alpha).toBe(0.5);
    expect(FILTERS.outline.tweenable.color.get(outline)).toBe('#ff0000');
  });

  it('accepts a numeric colour source and normalises it to lowercase hex', () => {
    const glow = FILTERS.glow.create({ color: 0xff0000 });

    expect(FILTERS.glow.tweenable.color.get(glow)).toBe('#ff0000');
  });

  it('falls back to the default when a param has the wrong type', () => {
    const blurred = FILTERS.blur.create({ strength: true });
    expect(blurred.strength).toBe(8);

    const uncoloured = FILTERS.glow.create({ color: true });
    expect(FILTERS.glow.tweenable.color.get(uncoloured)).toBe('#ffffff');
  });

  it('gives the time-driven filters a tick and leaves it off the static ones', () => {
    const timeDriven = ['noise', 'crt', 'oldFilm', 'godray', 'glitch'];

    for (const [key, def] of Object.entries(FILTERS)) {
      if (timeDriven.includes(key)) expect(def.tick).toBeTypeOf('function');
      else expect(def.tick).toBeUndefined();
    }
  });

  it('crt tick gives the same seed and time at one frame and a new seed at the next', () => {
    const filter = FILTERS.crt.create(FILTERS.crt.defaults);

    FILTERS.crt.tick!(filter, 0.5, 10, 7);
    const seed = filter.seed;
    const time = filter.time;

    FILTERS.crt.tick!(filter, 0.5, 10, 7);
    expect(filter.seed).toBe(seed);
    expect(filter.time).toBe(time);

    FILTERS.crt.tick!(filter, 0.5, 11, 7);
    expect(filter.seed).not.toBe(seed);
  });

  it('glitch tick produces identical slice arrays at one frame and different ones at the next', () => {
    const filter = FILTERS.glitch.create(FILTERS.glitch.defaults);

    FILTERS.glitch.tick!(filter, 5 / 30, 5, 3);
    const sizes = [...filter.sizes];
    const offsets = [...filter.offsets];

    FILTERS.glitch.tick!(filter, 5 / 30, 5, 3);
    expect([...filter.sizes]).toEqual(sizes);
    expect([...filter.offsets]).toEqual(offsets);

    FILTERS.glitch.tick!(filter, 6 / 30, 6, 3);
    expect([...filter.sizes]).not.toEqual(sizes);
  });

  it('does not call Math.random outside withSeededRandom during a glitch tick', () => {
    const filter = FILTERS.glitch.create(FILTERS.glitch.defaults);
    const original = Math.random;
    const spy = vi.fn(() => original());

    Math.random = spy;
    try {
      FILTERS.glitch.tick!(filter, 5 / 30, 5, 3);
      expect(Math.random).toBe(spy);
    } finally {
      Math.random = original;
    }

    expect(spy).not.toHaveBeenCalled();
  });
});
