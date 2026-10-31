import { afterEach, describe, expect, it } from 'vitest';
import { MotionClock } from '../core/clock';
import type { TargetRef } from '../core/paths';
import { PRESET_NAMES, type PresetName } from '../schema/enums';
import { LayerSchema, type Layer } from '../schema/layer';
import { compileTweens, primeTimeline, type Resolve } from './compile';
import { PRESETS, expandPresets, type PresetContext, type PresetDef, type PresetRef } from './presets';

const DEG_TO_RAD = Math.PI / 180;
const EPSILON = 1e-6;

const BASE = { x: 100, y: 40, alpha: 0.8, rotation: 30, scaleX: 1.5, scaleY: 2 };
const SIZE = { width: 300, height: 200 };
const STAGE = { width: 1000, height: 800 };

const clocks: MotionClock[] = [];

afterEach(() => {
  for (const clock of clocks.splice(0)) clock.destroy();
});

function ctxWith(baseOverrides: Partial<PresetContext['base']> = {}): PresetContext {
  return { base: { ...BASE, ...baseOverrides }, size: SIZE, stage: STAGE, layerLength: 10 };
}

function preset(name: PresetName): PresetDef {
  const def = PRESETS[name];
  if (!def) throw new Error(`missing preset "${name}"`);
  return def;
}

interface Node {
  x: number;
  y: number;
  alpha: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/** A fake 2D node holding `rotation` in radians, as the runtime does. */
function makeNode(ctx: PresetContext): Node {
  return {
    x: ctx.base.x,
    y: ctx.base.y,
    alpha: ctx.base.alpha,
    rotation: ctx.base.rotation * DEG_TO_RAD,
    scaleX: ctx.base.scaleX,
    scaleY: ctx.base.scaleY,
  };
}

function resolver(node: Node): Resolve {
  return (_target, prop) => {
    if (!Object.prototype.hasOwnProperty.call(node, prop)) return null;
    const kind: TargetRef['kind'] = prop === 'rotation' ? 'deg' : 'number';
    return { obj: node, key: prop, kind };
  };
}

/** Builds a preset's tweens, compiles them onto a fresh clock, and primes it. */
function run(
  def: PresetDef,
  ctx: PresetContext,
  ref: PresetRef,
  at: number,
  duration: number,
): { clock: MotionClock; node: Node } {
  const clock = new MotionClock({ duration: at + duration + 1, fps: 30 });
  clocks.push(clock);
  const node = makeNode(ctx);
  const tweens = def.build(ctx, ref, at, duration);
  const result = compileTweens(clock.timeline, tweens, { layerStart: 0, resolve: resolver(node), layerId: 'layer' });
  expect(result.errors).toEqual([]);
  expect(result.added).toBeGreaterThan(0);
  primeTimeline(clock.timeline);
  return { clock, node };
}

function isAtBase(node: Node, base: PresetContext['base']): boolean {
  return (
    Math.abs(node.x - base.x) < EPSILON &&
    Math.abs(node.y - base.y) < EPSILON &&
    Math.abs(node.alpha - base.alpha) < EPSILON &&
    Math.abs(node.rotation - base.rotation * DEG_TO_RAD) < EPSILON &&
    Math.abs(node.scaleX - base.scaleX) < EPSILON &&
    Math.abs(node.scaleY - base.scaleY) < EPSILON
  );
}

function expectAtBase(node: Node, base: PresetContext['base']): void {
  expect(Math.abs(node.x - base.x)).toBeLessThan(EPSILON);
  expect(Math.abs(node.y - base.y)).toBeLessThan(EPSILON);
  expect(Math.abs(node.alpha - base.alpha)).toBeLessThan(EPSILON);
  expect(Math.abs(node.rotation - base.rotation * DEG_TO_RAD)).toBeLessThan(EPSILON);
  expect(Math.abs(node.scaleX - base.scaleX)).toBeLessThan(EPSILON);
  expect(Math.abs(node.scaleY - base.scaleY)).toBeLessThan(EPSILON);
}

const ENTER_NAMES = PRESET_NAMES.filter((entry) => entry.kind === 'enter').map((entry) => entry.name);

/** Defaults from the presets table in engine/docs/02-timeline.md. */
const TABLE_DEFAULTS: Record<string, number> = {
  fadeIn: 0.6,
  fadeInUp: 0.7,
  fadeInDown: 0.7,
  fadeInLeft: 0.7,
  fadeInRight: 0.7,
  slideInUp: 0.6,
  slideInDown: 0.6,
  slideInLeft: 0.6,
  slideInRight: 0.6,
  zoomIn: 0.6,
  popIn: 0.5,
  rotateIn: 0.7,
  dropIn: 0.9,
};

describe('enter presets', () => {
  it('defines every enter preset from the table with its default duration', () => {
    for (const [name, duration] of Object.entries(TABLE_DEFAULTS)) {
      const def = preset(name as PresetName);
      expect(def.kind).toBe('enter');
      expect(def.defaultDuration).toBe(duration);
    }
    expect(ENTER_NAMES).toHaveLength(Object.keys(TABLE_DEFAULTS).length);
  });

  it('starts off-base or transparent and lands exactly at base at at + duration', () => {
    for (const name of ENTER_NAMES) {
      const def = preset(name);
      const ctx = ctxWith();
      const { clock, node } = run(def, ctx, { name }, 0, def.defaultDuration);

      clock.seek(0);
      expect(isAtBase(node, ctx.base) && node.alpha > EPSILON).toBe(false);

      clock.seek(def.defaultDuration);
      expectAtBase(node, ctx.base);
    }
  });

  it('slideInLeft starts one own width to the left and transparent', () => {
    const ctx = ctxWith({ x: 500 });
    const def = preset('slideInLeft');
    const { clock, node } = run(def, ctx, { name: 'slideInLeft' }, 0, def.defaultDuration);

    clock.seek(0);
    expect(Math.abs(node.x - 200)).toBeLessThan(EPSILON);
    expect(node.alpha).toBe(0);
  });

  it('popIn eases with back.out and starts at scale 0', () => {
    const ctx = ctxWith();
    const def = preset('popIn');
    const tweens = def.build(ctx, { name: 'popIn' }, 0, def.defaultDuration);

    expect(tweens.some((tween) => tween.from?.scaleX === 0 && /back\.out/.test(tween.ease ?? ''))).toBe(true);

    const { clock, node } = run(def, ctx, { name: 'popIn' }, 0, def.defaultDuration);
    clock.seek(0);
    expect(Math.abs(node.scaleX)).toBeLessThan(EPSILON);
    expect(Math.abs(node.scaleY)).toBeLessThan(EPSILON);
    expect(node.alpha).toBe(0);
  });

  it('honours ref.duration and otherwise falls back to the table default', () => {
    const def = preset('fadeIn');
    const endOf = (tweens: { at: number; duration: number }[]): number =>
      Math.max(...tweens.map((tween) => tween.at + tween.duration));

    const explicit: PresetRef = { name: 'fadeIn', duration: 2 };
    expect(endOf(def.build(ctxWith(), explicit, 1, explicit.duration ?? def.defaultDuration))).toBeCloseTo(3, 6);

    const implicit: PresetRef = { name: 'fadeIn' };
    expect(endOf(def.build(ctxWith(), implicit, 0, implicit.duration ?? def.defaultDuration))).toBeCloseTo(0.6, 6);
  });

  it('lets ref.ease override the preset ease', () => {
    const def = preset('slideInLeft');
    const tweens = def.build(ctxWith(), { name: 'slideInLeft', ease: 'sine.inOut' }, 0, def.defaultDuration);
    expect(tweens[0].ease).toBe('sine.inOut');
  });
});

const EXIT_NAMES = PRESET_NAMES.filter((entry) => entry.kind === 'exit').map((entry) => entry.name);

/** Defaults from the exit rows of the presets table in engine/docs/02-timeline.md. */
const EXIT_TABLE_DEFAULTS: Record<string, number> = {
  fadeOut: 0.5,
  fadeOutUp: 0.6,
  fadeOutDown: 0.6,
  slideOutLeft: 0.6,
  slideOutRight: 0.6,
  zoomOut: 0.5,
};

describe('exit presets', () => {
  it('defines every exit preset from the table with its default duration', () => {
    for (const [name, duration] of Object.entries(EXIT_TABLE_DEFAULTS)) {
      const def = preset(name as PresetName);
      expect(def.kind).toBe('exit');
      expect(def.defaultDuration).toBe(duration);
    }
    expect(EXIT_NAMES).toHaveLength(Object.keys(EXIT_TABLE_DEFAULTS).length);
  });

  it('starts exactly at base and ends with alpha 0 at at + duration', () => {
    for (const name of EXIT_NAMES) {
      const def = preset(name);
      const ctx = ctxWith();
      const { clock, node } = run(def, ctx, { name }, 0, def.defaultDuration);

      clock.seek(0);
      expectAtBase(node, ctx.base);

      clock.seek(def.defaultDuration);
      expect(node.alpha).toBe(0);
    }
  });

  it('slideOutRight ends one own width to the right of base', () => {
    const ctx = ctxWith({ x: 500 });
    const def = preset('slideOutRight');
    const { clock, node } = run(def, ctx, { name: 'slideOutRight' }, 0, def.defaultDuration);

    clock.seek(0);
    expect(Math.abs(node.x - 500)).toBeLessThan(EPSILON);

    clock.seek(def.defaultDuration);
    expect(Math.abs(node.x - 800)).toBeLessThan(EPSILON);
    expect(node.alpha).toBe(0);
  });

  it('zoomOut ends at 0.3 × base scale', () => {
    const ctx = ctxWith();
    const def = preset('zoomOut');
    const { clock, node } = run(def, ctx, { name: 'zoomOut' }, 0, def.defaultDuration);

    clock.seek(def.defaultDuration);
    expect(Math.abs(node.scaleX - 0.3 * ctx.base.scaleX)).toBeLessThan(EPSILON);
    expect(Math.abs(node.scaleY - 0.3 * ctx.base.scaleY)).toBeLessThan(EPSILON);
    expect(node.alpha).toBe(0);
  });
});

const LOOP_NAMES = PRESET_NAMES.filter((entry) => entry.kind === 'loop').map((entry) => entry.name);

/** Periods from the loop rows of the presets table in engine/docs/02-timeline.md. */
const LOOP_TABLE_PERIODS: Record<string, number> = {
  spin: 4,
  float: 3,
  pulse: 1.2,
  sway: 2.4,
};

describe('loop presets', () => {
  it('defines every loop preset with its table period', () => {
    for (const [name, period] of Object.entries(LOOP_TABLE_PERIODS)) {
      const def = preset(name as PresetName);
      expect(def.kind).toBe('loop');
      expect(def.defaultDuration).toBe(period);
    }
    expect(LOOP_NAMES).toHaveLength(Object.keys(LOOP_TABLE_PERIODS).length);
  });

  it('spin advances 360 degrees per period with a none ease', () => {
    const ctx = ctxWith();
    const tweens = preset('spin').build(ctx, { name: 'spin' }, 0.6, 8);
    expect(tweens).toHaveLength(1);
    expect(tweens[0].at).toBe(0.6);
    expect(tweens[0].duration).toBe(8);
    expect(tweens[0].ease).toBe('none');
    expect(tweens[0].to.rotation).toBe(ctx.base.rotation + 720);
  });

  it('clamps turnsPerSecond to 1', () => {
    const ctx = ctxWith();
    const tweens = preset('spin').build(ctx, { name: 'spin', params: { turnsPerSecond: 5 } }, 0, 4);
    expect(tweens[0].duration).toBe(4);
    expect(tweens[0].to.rotation).toBe(ctx.base.rotation + 1440);
  });

  it('renders a spin over two periods and lands at base + 720 degrees at 8.6', () => {
    const ctx = ctxWith();
    const tweens = preset('spin').build(ctx, { name: 'spin' }, 0.6, 8);
    const clock = new MotionClock({ duration: 12, fps: 30 });
    clocks.push(clock);
    const node = makeNode(ctx);
    const result = compileTweens(clock.timeline, tweens, { layerStart: 0, resolve: resolver(node), layerId: 'layer' });
    expect(result.errors).toEqual([]);
    primeTimeline(clock.timeline);
    clock.seek(8.6);
    expect(Math.abs(node.rotation - (ctx.base.rotation + 720) * DEG_TO_RAD)).toBeLessThan(EPSILON * 10);
  });

  it('float and sway land exactly at base and pulse lands at base scale', () => {
    for (const name of ['float', 'pulse', 'sway'] as const) {
      const ctx = ctxWith();
      const def = preset(name);
      const span = 3 * def.defaultDuration;
      const { clock, node } = run(def, ctx, { name }, 0, span);
      clock.seek(span);
      expectAtBase(node, ctx.base);
    }
  });
});

function makeLayer(overrides: Record<string, unknown>): Layer {
  return LayerSchema.parse({ id: 'layer', start: 0, ...overrides });
}

describe('expandPresets', () => {
  it('places a spin loop between a fadeIn and a fadeOut over a 10s layer', () => {
    const layer = makeLayer({
      type: 'image',
      asset: 'a',
      enter: { name: 'fadeIn' },
      exit: { name: 'fadeOut' },
      loop: { name: 'spin' },
    });
    const ctx = ctxWith();
    const { tweens, errors } = expandPresets(layer, ctx);
    expect(errors).toEqual([]);

    const enterTween = tweens.find((tween) => tween.at === 0);
    expect(enterTween?.to.alpha).toBe(ctx.base.alpha);

    const loopTween = tweens.find((tween) => tween.ease === 'none');
    expect(loopTween?.at).toBe(0.6);
    expect(loopTween?.duration).toBe(8);
    expect(loopTween?.to.rotation).toBe(ctx.base.rotation + 720);

    const exitTween = tweens.find((tween) => tween.at === 9.5);
    expect(exitTween?.to.alpha).toBe(0);
  });

  it('adds no tween and no error when the loop span is shorter than one period', () => {
    const layer = makeLayer({ type: 'image', asset: 'a', loop: { name: 'spin' } });
    const { tweens, errors } = expandPresets(layer, { ...ctxWith(), layerLength: 3 });
    expect(tweens).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('retargets a spin loop to a 3D object rotation.y', () => {
    const layer = makeLayer({
      type: 'three',
      width: 100,
      height: 100,
      objects: [{ id: 'can', geometry: { type: 'box', size: [1, 1, 1] } }],
      loop: { name: 'spin', target: 'object:can' },
    });
    const { tweens, errors } = expandPresets(layer, ctxWith());
    expect(errors).toEqual([]);
    const spin = tweens.find((tween) => tween.target === 'object:can');
    expect(spin).toBeDefined();
    expect(spin?.to['rotation.y']).toBe(720);
    expect(spin?.from?.['rotation.y']).toBe(0);
  });

  it('errors when a non-loop preset carries a target', () => {
    const layer = makeLayer({ type: 'image', asset: 'a', enter: { name: 'fadeIn', target: 'object:can' } });
    const { errors } = expandPresets(layer, ctxWith());
    expect(errors.length).toBeGreaterThan(0);
  });
});
