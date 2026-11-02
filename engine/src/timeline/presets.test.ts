import { afterEach, describe, expect, it } from 'vitest';
import { MotionClock } from '../core/clock';
import type { TargetRef } from '../core/paths';
import type { CameraState } from '../core/types';
import { PRESET_NAMES, type PresetName } from '../schema/enums';
import type { ShotSpec } from '../schema/shot';
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

/** The camera presets move a three layer's camera; they have their own tests below. */
const CAMERA_NAMES: readonly PresetName[] = [
  'cameraTo',
  'crane',
  'dollyZoom',
  'orbit',
  'handheld',
  // The text presets need a text3d target; they have their own tests below.
  'glyphRise',
  'glyphPop',
  'glyphFlip',
  'glyphFadeOut',
  'glyphWave',
];

const ENTER_NAMES = PRESET_NAMES.filter((entry) => entry.kind === 'enter' && !CAMERA_NAMES.includes(entry.name)).map(
  (entry) => entry.name,
);

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

const EXIT_NAMES = PRESET_NAMES.filter((entry) => entry.kind === 'exit' && !CAMERA_NAMES.includes(entry.name)).map((entry) => entry.name);

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

const LOOP_NAMES = PRESET_NAMES.filter((entry) => entry.kind === 'loop' && !CAMERA_NAMES.includes(entry.name)).map(
  (entry) => entry.name,
);

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

  it('errors when a camera preset is used on a layer without a camera', () => {
    const layer = makeLayer({ type: 'image', asset: 'a', enter: { name: 'crane' } });
    const { errors } = expandPresets(layer, ctxWith());
    expect(errors.join(' ')).toContain('only allowed on a three layer');
  });
});

/** A camera as a plain object, the way the timeline writes it. */
interface FakeCamera {
  position: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
  fov: number;
  rig: { pan: number; tilt: number; roll: number; dolly: number; truck: number; pedestal: number };
}

const CAMERA_POSITION: [number, number, number] = [0, 1.2, 6];
const CAMERA_LOOK_AT: [number, number, number] = [0, 0.9, 0];
const CAMERA_FOV = 35;

function makeCamera(): FakeCamera {
  return {
    position: { x: CAMERA_POSITION[0], y: CAMERA_POSITION[1], z: CAMERA_POSITION[2] },
    lookAt: { x: CAMERA_LOOK_AT[0], y: CAMERA_LOOK_AT[1], z: CAMERA_LOOK_AT[2] },
    fov: CAMERA_FOV,
    rig: { pan: 0, tilt: 0, roll: 0, dolly: 0, truck: 0, pedestal: 0 },
  };
}

/** The camera's tween targets, resolved onto a plain object. */
function cameraResolver(camera: FakeCamera): Resolve {
  const axes: Record<string, { obj: object; key: string }> = {
    'position.x': { obj: camera.position, key: 'x' },
    'position.y': { obj: camera.position, key: 'y' },
    'position.z': { obj: camera.position, key: 'z' },
    'lookAt.x': { obj: camera.lookAt, key: 'x' },
    'lookAt.y': { obj: camera.lookAt, key: 'y' },
    'lookAt.z': { obj: camera.lookAt, key: 'z' },
    'rig.pan': { obj: camera.rig, key: 'pan' },
    'rig.tilt': { obj: camera.rig, key: 'tilt' },
  };
  return (target, prop) => {
    if (target !== 'camera') return null;
    if (prop === 'fov') return { obj: camera, key: 'fov', kind: 'number' };
    const axis = axes[prop];
    return axis ? { obj: axis.obj, key: axis.key, kind: 'number' } : null;
  };
}

/** The pose the fake resolver frames a shot into; it depends on the shot, so a wrong shot shows. */
function fakeFrameShot(shot: ShotSpec): CameraState {
  const wide = shot.size === 'wide' || shot.size === 'extremeWide';
  return { position: [wide ? 3 : 1, 1.5, wide ? 7 : 4], lookAt: [0, 0.75, 0], fov: wide ? 45 : 50 };
}

function cameraCtx(overrides: Partial<PresetContext> = {}): PresetContext {
  return {
    base: { ...BASE },
    size: SIZE,
    stage: STAGE,
    layerLength: 10,
    fps: 30,
    camera: { position: [...CAMERA_POSITION], lookAt: [...CAMERA_LOOK_AT], fov: CAMERA_FOV },
    frameShot: fakeFrameShot,
    ...overrides,
  };
}

/** Builds a camera preset's tweens, compiles them onto a fresh clock, and primes it. */
function runCamera(
  def: PresetDef,
  ctx: PresetContext,
  ref: PresetRef,
  at: number,
  duration: number,
): { clock: MotionClock; camera: FakeCamera } {
  const clock = new MotionClock({ duration: at + duration + 1, fps: 30 });
  clocks.push(clock);
  const camera = makeCamera();
  const tweens = def.build(ctx, ref, at, duration);
  const result = compileTweens(clock.timeline, tweens, { layerStart: 0, resolve: cameraResolver(camera), layerId: 'layer' });
  expect(result.errors).toEqual([]);
  expect(result.added).toBeGreaterThan(0);
  primeTimeline(clock.timeline);
  return { clock, camera };
}

describe('camera presets', () => {
  it('registers the five camera presets with their kinds', () => {
    expect(preset('cameraTo').kind).toBe('enter');
    expect(preset('crane').kind).toBe('enter');
    expect(preset('dollyZoom').kind).toBe('enter');
    expect(preset('orbit').kind).toBe('loop');
    expect(preset('handheld').kind).toBe('loop');
  });

  it('cameraTo ends with the position, lookAt and fov of the shot it frames', () => {
    const def = preset('cameraTo');
    const shot: ShotSpec = { subject: 'object:can', size: 'closeUp' };
    const framed = fakeFrameShot(shot);
    const { clock, camera } = runCamera(def, cameraCtx(), { name: 'cameraTo', params: { shot } }, 0, def.defaultDuration);

    clock.seek(def.defaultDuration);
    expect(camera.position.x).toBeCloseTo(framed.position[0], 6);
    expect(camera.position.y).toBeCloseTo(framed.position[1], 6);
    expect(camera.position.z).toBeCloseTo(framed.position[2], 6);
    expect(camera.lookAt.x).toBeCloseTo(framed.lookAt[0], 6);
    expect(camera.lookAt.y).toBeCloseTo(framed.lookAt[1], 6);
    expect(camera.lookAt.z).toBeCloseTo(framed.lookAt[2], 6);
    expect(camera.fov).toBeCloseTo(framed.fov, 6);
  });

  it('crane lifts the camera by its height and keeps the look-at point', () => {
    const def = preset('crane');
    const { clock, camera } = runCamera(def, cameraCtx(), { name: 'crane', params: { height: 2 } }, 0, def.defaultDuration);

    clock.seek(def.defaultDuration);
    expect(camera.position.y).toBeCloseTo(CAMERA_POSITION[1] + 2, 6);
    expect(camera.position.x).toBeCloseTo(CAMERA_POSITION[0], 6);
    expect(camera.position.z).toBeCloseTo(CAMERA_POSITION[2], 6);
    expect(camera.lookAt.z).toBeCloseTo(CAMERA_LOOK_AT[2], 6);
  });

  it('orbit swings the camera around the look-at point and keeps its distance', () => {
    const def = preset('orbit');
    const period = def.defaultDuration;
    const { clock, camera } = runCamera(def, cameraCtx(), { name: 'orbit' }, 0, period);

    clock.seek(period / 2);
    const radius = Math.hypot(camera.position.x - camera.lookAt.x, camera.position.z - camera.lookAt.z);
    expect(radius).toBeCloseTo(Math.abs(CAMERA_POSITION[2] - CAMERA_LOOK_AT[2]), 6);
    expect(camera.position.x).toBeCloseTo(3, 6);
  });

  it('orbit returns the camera to its start position after two whole periods', () => {
    const def = preset('orbit');
    const period = def.defaultDuration;
    const { clock, camera } = runCamera(def, cameraCtx(), { name: 'orbit' }, 0, period * 2);

    const start = { ...camera.position };
    clock.seek(period * 2);
    expect(Math.abs(camera.position.x - start.x)).toBeLessThan(1e-6);
    expect(Math.abs(camera.position.y - start.y)).toBeLessThan(1e-6);
    expect(Math.abs(camera.position.z - start.z)).toBeLessThan(1e-6);
  });

  it('dollyZoom keeps the subject the same size in frame across the move', () => {
    const def = preset('dollyZoom');
    const { clock, camera } = runCamera(def, cameraCtx(), { name: 'dollyZoom' }, 0, def.defaultDuration);

    const distance = (): number =>
      Math.hypot(
        camera.position.x - camera.lookAt.x,
        camera.position.y - camera.lookAt.y,
        camera.position.z - camera.lookAt.z,
      );
    const sizeInFrame = (): number => distance() * Math.tan((camera.fov * Math.PI) / 360);

    const start = sizeInFrame();
    const distanceAtStart = distance();
    for (let time = 0; time <= def.defaultDuration + 1e-9; time += 0.05) {
      clock.seek(time);
      expect(Math.abs(sizeInFrame() - start) / start).toBeLessThan(0.01);
    }

    // The camera really dollied in, and the lens really widened.
    clock.seek(def.defaultDuration);
    expect(camera.fov).toBeGreaterThan(CAMERA_FOV);
    expect(distance()).toBeCloseTo(distanceAtStart / 2, 6);
  });

  it('handheld is the same on two expansions of the same layer', () => {
    const layer = makeLayer({
      type: 'three',
      width: 100,
      height: 100,
      objects: [{ id: 'can', geometry: { type: 'box', size: [1, 1, 1] } }],
      loop: { name: 'handheld', params: { amount: 0.6 } },
    });

    const first = expandPresets(layer, cameraCtx());
    const second = expandPresets(layer, cameraCtx());
    expect(first.errors).toEqual([]);
    expect(first.tweens.length).toBeGreaterThan(0);
    expect(first.tweens).toEqual(second.tweens);
  });

  it('handheld stays within its amount in degrees', () => {
    const amount = 0.6;
    const def = preset('handheld');
    const { clock, camera } = runCamera(
      def,
      cameraCtx(),
      { name: 'handheld', params: { amount } },
      0,
      def.defaultDuration,
    );

    for (let time = 0; time <= def.defaultDuration + 1e-9; time += 0.02) {
      clock.seek(time);
      expect(Math.abs(camera.rig.pan)).toBeLessThanOrEqual(amount + 1e-9);
      expect(Math.abs(camera.rig.tilt)).toBeLessThanOrEqual(amount + 1e-9);
    }
  });
});

describe('text presets', () => {
  const textLayer = (overrides: Record<string, unknown> = {}, text = 'hello') =>
    LayerSchema.parse({
      id: 'title',
      type: 'three',
      start: 0,
      end: 5,
      width: 320,
      height: 240,
      objects: [{ id: 't', geometry: { type: 'text3d', font: 'f', text } }],
      ...overrides,
    });

  interface Unit {
    offsetY: number;
    alpha: number;
    scale: number;
    rotX: number;
  }

  /** Compiles the layer's presets over 5 plain units and returns a seekable clock. */
  function run(layer: Layer, layerLength = 5) {
    const clock = new MotionClock({ duration: 12, fps: 30 });
    clocks.push(clock);
    const units: Unit[] = Array.from({ length: 5 }, () => ({ offsetY: 0, alpha: 1, scale: 1, rotX: 0 }));
    const keys: Record<string, keyof Unit> = { 'offset.y': 'offsetY', alpha: 'alpha', scale: 'scale', 'rotation.x': 'rotX' };
    const { tweens, errors } = expandPresets(layer, { ...ctxWith(), layerLength });
    expect(errors).toEqual([]);
    const res = compileTweens(clock.timeline, tweens, {
      layerStart: 0,
      resolve: () => null,
      resolveMany: (_t, prop) =>
        units.map((obj) => ({ obj, key: keys[prop] as string, kind: prop === 'rotation.x' ? 'deg' : 'number' }) as TargetRef),
      layerId: 'title',
    });
    expect(res.errors).toEqual([]);
    primeTimeline(clock.timeline, 0);
    return { clock, units };
  }

  it('glyphRise starts hidden below and ends at rest after the last stagger', () => {
    const { clock, units } = run(textLayer({ enter: { name: 'glyphRise' } }));
    expect(units[4]?.offsetY).toBeCloseTo(-0.3, 9);
    expect(units[4]?.alpha).toBe(0);
    clock.seek(0.5 + 4 * 0.04);
    for (const unit of units) {
      expect(unit.offsetY).toBeCloseTo(0, 9);
      expect(unit.alpha).toBeCloseTo(1, 9);
    }
  });

  it('glyphPop scales 0 → 1 and glyphFlip ends at rotation.x 0', () => {
    const pop = run(textLayer({ enter: { name: 'glyphPop' } }));
    expect(pop.units.every((unit) => unit.scale === 0)).toBe(true);
    pop.clock.seek(5);
    for (const unit of pop.units) expect(unit.scale).toBeCloseTo(1, 9);
    const flip = run(textLayer({ enter: { name: 'glyphFlip' } }));
    flip.clock.seek(0.6 + 4 * 0.05);
    for (const unit of flip.units) expect(unit.rotX).toBeCloseTo(0, 9);
  });

  it('glyphFadeOut finishes its last unit exactly at the layer end', () => {
    const layer = textLayer({ exit: { name: 'glyphFadeOut' } });
    const { tweens } = expandPresets(layer, { ...ctxWith(), layerLength: 5 });
    const ends = tweens.flatMap((tween) => {
      const stagger = tween.stagger?.each ?? 0;
      return [tween.at + 4 * stagger + tween.duration];
    });
    expect(Math.max(...ends)).toBeCloseTo(5, 9);
    const { clock, units } = run(layer);
    clock.seek(5);
    for (const unit of units) expect(unit.alpha).toBeCloseTo(0, 9);
  });

  it('glyphWave rests at the end of the span and adds nothing when too short', () => {
    const { clock, units } = run(textLayer({ loop: { name: 'glyphWave' }, end: 10 }), 10);
    clock.seek(5);
    expect(units.some((unit) => unit.offsetY !== 0)).toBe(true);
    clock.seek(10);
    for (const unit of units) expect(unit.offsetY).toBeCloseTo(0, 9);
    const short = expandPresets(textLayer({ loop: { name: 'glyphWave' } }), { ...ctxWith(), layerLength: 1.4 });
    expect(short.tweens).toEqual([]);
    expect(short.errors).toEqual([]);
  });

  it('asks for a target when the layer has two text3d objects', () => {
    const layer = textLayer({
      enter: { name: 'glyphRise' },
      objects: [
        { id: 'a', geometry: { type: 'text3d', font: 'f', text: 'one' } },
        { id: 'b', geometry: { type: 'text3d', font: 'f', text: 'two' } },
      ],
    });
    const { errors } = expandPresets(layer, ctxWith());
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('needs a target');
    const ok = expandPresets({ ...layer, enter: { name: 'glyphRise', target: 'glyphs:b' } }, ctxWith());
    expect(ok.errors).toEqual([]);
  });
});
