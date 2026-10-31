// Ported from reacthub-pixitweenjs src/utils/gsapEffects/ (MIT).
import type { PresetName } from '../schema/enums';
import type { Layer } from '../schema/layer';
import type { Tween } from './compile';

export interface PresetBase {
  x: number;
  y: number;
  alpha: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface PresetObjectBase {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
}

export interface PresetContext {
  /** The layer's resting values. `rotation` is in degrees (the compiler converts deg → radians). */
  base: PresetBase;
  /** The layer's local bounds × scale, from `node.size()`. */
  size: { width: number; height: number };
  stage: { width: number; height: number };
  layerLength: number;
  /**
   * `loop.target` only: the retargeted 3D object's resting values (layer units, degrees). Set by
   * `expandPresets` so a retargeted spin/float/sway starts from the object's own base.
   */
  objectBase?: PresetObjectBase;
}

export type PresetKind = 'enter' | 'exit' | 'loop';

export interface PresetRef {
  name: PresetName;
  duration?: number;
  ease?: string;
  target?: string;
  params?: Record<string, number | string | boolean>;
}

export interface PresetDef {
  kind: PresetKind;
  /** For loops: one period. For enter/exit: the whole effect. */
  defaultDuration: number;
  build(ctx: PresetContext, ref: PresetRef, at: number, duration: number): Tween[];
}

type Build = PresetDef['build'];

/** `fadeIn` — alpha 0 → base (`fadeEffects.ts` FADE_IN). */
const fade: Build = (ctx, ref, at, duration) => [
  { at, duration, ease: ref.ease ?? 'power1.inOut', from: { alpha: 0 }, to: { alpha: ctx.base.alpha } },
];

/** `fadeInUp/Down/Left/Right` — alpha 0 → base and one axis from ± 0.5 × size (FADE_IN_*). */
function fadeDirectional(axis: 'x' | 'y', sign: 1 | -1): Build {
  return (ctx, ref, at, duration) => {
    const delta = (axis === 'x' ? ctx.size.width : ctx.size.height) * 0.5 * sign;
    const from: Record<string, number> = { alpha: 0 };
    from[axis] = ctx.base[axis] + delta;
    const to: Record<string, number> = { alpha: ctx.base.alpha };
    to[axis] = ctx.base[axis];
    return [{ at, duration, ease: ref.ease ?? 'power1.out', from, to }];
  };
}

/** `slideInUp/Down/Left/Right` — from ± 1 × own size and alpha 0 → base, `power3.out` (`slideEffects.ts`). */
function slide(axis: 'x' | 'y', sign: 1 | -1): Build {
  return (ctx, ref, at, duration) => {
    const delta = (axis === 'x' ? ctx.size.width : ctx.size.height) * sign;
    const from: Record<string, number> = { alpha: 0 };
    from[axis] = ctx.base[axis] + delta;
    const to: Record<string, number> = { alpha: ctx.base.alpha };
    to[axis] = ctx.base[axis];
    return [{ at, duration, ease: ref.ease ?? 'power3.out', from, to }];
  };
}

/** `zoomIn` — scale 0.3 × base → base and alpha 0 → base (ZOOM_IN). */
const zoom: Build = (ctx, ref, at, duration) => [
  {
    at,
    duration,
    ease: ref.ease ?? 'power2.out',
    from: { scaleX: 0.3 * ctx.base.scaleX, scaleY: 0.3 * ctx.base.scaleY, alpha: 0 },
    to: { scaleX: ctx.base.scaleX, scaleY: ctx.base.scaleY, alpha: ctx.base.alpha },
  },
];

/** `popIn` — scale 0 → base with `back.out(1.7)`, alpha 0 → base over the first 40 % (`backEffects.ts`). */
const pop: Build = (ctx, ref, at, duration) => {
  const scale: Tween = {
    at,
    duration,
    ease: ref.ease ?? 'back.out(1.7)',
    from: { scaleX: 0, scaleY: 0 },
    to: { scaleX: ctx.base.scaleX, scaleY: ctx.base.scaleY },
  };
  const alpha: Tween = { at, duration: duration * 0.4, ease: 'power1.out', from: { alpha: 0 }, to: { alpha: ctx.base.alpha } };
  return [scale, alpha];
};

/** `rotateIn` — rotation base − 200 → base and alpha 0 → base (ROTATE_IN). */
const rotate: Build = (ctx, ref, at, duration) => [
  {
    at,
    duration,
    ease: ref.ease ?? 'power1.out',
    from: { rotation: ctx.base.rotation - 200, alpha: 0 },
    to: { rotation: ctx.base.rotation, alpha: ctx.base.alpha },
  },
];

/** `dropIn` — y from base − stage height × 0.6 → base with `bounce.out` (`bounceEffects.ts`). */
const drop: Build = (ctx, ref, at, duration) => [
  {
    at,
    duration,
    ease: ref.ease ?? 'bounce.out',
    from: { y: ctx.base.y - ctx.stage.height * 0.6 },
    to: { y: ctx.base.y },
  },
];

/** `fadeOut` — alpha base → 0 (`fadeEffects.ts` FADE_OUT). */
const fadeOut: Build = (ctx, ref, at, duration) => [
  { at, duration, ease: ref.ease ?? 'power2.out', from: { alpha: ctx.base.alpha }, to: { alpha: 0 } },
];

/** `fadeOutUp/Down` — alpha base → 0 and one axis from base to ± 0.5 × size (FADE_OUT_*). */
function fadeOutDirectional(axis: 'x' | 'y', sign: 1 | -1): Build {
  return (ctx, ref, at, duration) => {
    const delta = (axis === 'x' ? ctx.size.width : ctx.size.height) * 0.5 * sign;
    const from: Record<string, number> = { alpha: ctx.base.alpha };
    from[axis] = ctx.base[axis];
    const to: Record<string, number> = { alpha: 0 };
    to[axis] = ctx.base[axis] + delta;
    return [{ at, duration, ease: ref.ease ?? 'power2.out', from, to }];
  };
}

/** `slideOutLeft/Right` — from base to ± 1 × own size and alpha 0, `power3.in` (`slideEffects.ts`). */
function slideOut(axis: 'x' | 'y', sign: 1 | -1): Build {
  return (ctx, ref, at, duration) => {
    const delta = (axis === 'x' ? ctx.size.width : ctx.size.height) * sign;
    const from: Record<string, number> = { alpha: ctx.base.alpha };
    from[axis] = ctx.base[axis];
    const to: Record<string, number> = { alpha: 0 };
    to[axis] = ctx.base[axis] + delta;
    return [{ at, duration, ease: ref.ease ?? 'power3.in', from, to }];
  };
}

/** `zoomOut` — scale base → 0.3 × base and alpha base → 0 (ZOOM_OUT). */
const zoomOut: Build = (ctx, ref, at, duration) => [
  {
    at,
    duration,
    ease: ref.ease ?? 'power2.in',
    from: { scaleX: ctx.base.scaleX, scaleY: ctx.base.scaleY, alpha: ctx.base.alpha },
    to: { scaleX: 0.3 * ctx.base.scaleX, scaleY: 0.3 * ctx.base.scaleY, alpha: 0 },
  },
];

/** Loop animation speed bounds, in turns per second (`constants/animation.ts`). */
const DEFAULT_TURNS_PER_SECOND = 0.25;
const MIN_TURNS_PER_SECOND = 0.05;
const MAX_TURNS_PER_SECOND = 1;

/** `params.turnsPerSecond`, clamped to [0.05, 1] and defaulted to 0.25. */
function turnsPerSecond(ref: PresetRef): number {
  const raw = ref.params?.turnsPerSecond;
  const value = typeof raw === 'number' ? raw : DEFAULT_TURNS_PER_SECOND;
  return Math.min(MAX_TURNS_PER_SECOND, Math.max(MIN_TURNS_PER_SECOND, value));
}

/** One period of a loop preset; `ref.duration` overrides it (engine/docs/02-timeline.md, "Presets"). */
function loopPeriod(name: PresetName, ref: PresetRef): number {
  if (ref.duration !== undefined) return ref.duration;
  switch (name) {
    case 'spin':
      return 1 / turnsPerSecond(ref);
    case 'float':
      return 3;
    case 'pulse':
      return 1.2;
    case 'sway':
      return 2.4;
    default:
      return 1;
  }
}

/** Whole periods in `duration`, tolerant of float error since `duration` is `periods × period`. */
function wholePeriods(duration: number, period: number): number {
  return Math.floor((duration + period * 1e-9) / period);
}

/** `spin` — a constant `none`-ease rotation of 360° per period (`constants/animation.ts` SPIN_360). */
const spin: Build = (ctx, ref, at, duration) => {
  const period = loopPeriod('spin', ref);
  const periods = wholePeriods(duration, period);
  if (periods <= 0) return [];
  const span = periods * period;
  const degrees = 360 * periods;
  if (ref.target) {
    const base = ctx.objectBase?.rotation.y ?? 0;
    return [{ target: ref.target, at, duration: span, ease: ref.ease ?? 'none', from: { 'rotation.y': base }, to: { 'rotation.y': base + degrees } }];
  }
  return [{ at, duration: span, ease: ref.ease ?? 'none', from: { rotation: ctx.base.rotation }, to: { rotation: ctx.base.rotation + degrees } }];
};

/** `float` — y eases to a peak and back with `yoyo`, so it ends exactly at base. */
const float: Build = (ctx, ref, at, duration) => {
  const period = loopPeriod('float', ref);
  const periods = wholePeriods(duration, period);
  if (periods <= 0) return [];
  const half = period / 2;
  const amplitude = typeof ref.params?.amplitude === 'number' ? ref.params.amplitude : ref.target ? 0.05 : 12;
  const repeat = 2 * periods - 1;
  if (ref.target) {
    const base = ctx.objectBase?.position.y ?? 0;
    return [{ target: ref.target, at, duration: half, ease: ref.ease ?? 'sine.inOut', from: { 'position.y': base }, to: { 'position.y': base - amplitude }, repeat, yoyo: true }];
  }
  return [{ at, duration: half, ease: ref.ease ?? 'sine.inOut', from: { y: ctx.base.y }, to: { y: ctx.base.y - amplitude }, repeat, yoyo: true }];
};

/** `pulse` — scale eases to a peak and back with `yoyo`, so it ends exactly at base (PULSE). */
const pulse: Build = (ctx, ref, at, duration) => {
  const period = loopPeriod('pulse', ref);
  const periods = wholePeriods(duration, period);
  if (periods <= 0) return [];
  const half = period / 2;
  return [
    {
      at,
      duration: half,
      ease: ref.ease ?? 'sine.inOut',
      from: { scaleX: ctx.base.scaleX, scaleY: ctx.base.scaleY },
      to: { scaleX: ctx.base.scaleX * 1.06, scaleY: ctx.base.scaleY * 1.06 },
      repeat: 2 * periods - 1,
      yoyo: true,
    },
  ];
};

/** `sway` — quarter out, a `yoyo` half-period sweep, quarter back; ends at base (SWING). */
const sway: Build = (ctx, ref, at, duration) => {
  const period = loopPeriod('sway', ref);
  const periods = wholePeriods(duration, period);
  if (periods <= 0) return [];
  const quarter = period / 4;
  const half = period / 2;
  const degrees = typeof ref.params?.degrees === 'number' ? ref.params.degrees : 4;
  const ease = ref.ease ?? 'sine.inOut';
  const sweepAt = at + quarter;
  const lastAt = sweepAt + half * (2 * periods - 1);
  const repeat = 2 * periods - 2;
  if (ref.target) {
    const base = ctx.objectBase?.rotation.z ?? 0;
    const tweens: Tween[] = [
      { target: ref.target, at, duration: quarter, ease, from: { 'rotation.z': base }, to: { 'rotation.z': base - degrees } },
      { target: ref.target, at: sweepAt, duration: half, ease, repeat, yoyo: true, from: { 'rotation.z': base - degrees }, to: { 'rotation.z': base + degrees } },
      { target: ref.target, at: lastAt, duration: quarter, ease, from: { 'rotation.z': base + degrees }, to: { 'rotation.z': base } },
    ];
    return tweens;
  }
  const tweens: Tween[] = [
    { at, duration: quarter, ease, from: { rotation: ctx.base.rotation }, to: { rotation: ctx.base.rotation - degrees } },
    { at: sweepAt, duration: half, ease, repeat, yoyo: true, from: { rotation: ctx.base.rotation - degrees }, to: { rotation: ctx.base.rotation + degrees } },
    { at: lastAt, duration: quarter, ease, from: { rotation: ctx.base.rotation + degrees }, to: { rotation: ctx.base.rotation } },
  ];
  return tweens;
};

/**
 * The presets (engine/docs/02-timeline.md, "Presets"). Each `build` is a pure function that returns
 * `Tween` objects in layer-local time, compiled exactly like a layer's own tweens. `expandPresets`
 * places enter, exit and loop presets; the record stays partial so an unknown preset can be reported.
 */
export const PRESETS: Partial<Record<PresetName, PresetDef>> = {
  fadeIn: { kind: 'enter', defaultDuration: 0.6, build: fade },
  fadeInUp: { kind: 'enter', defaultDuration: 0.7, build: fadeDirectional('y', 1) },
  fadeInDown: { kind: 'enter', defaultDuration: 0.7, build: fadeDirectional('y', -1) },
  fadeInLeft: { kind: 'enter', defaultDuration: 0.7, build: fadeDirectional('x', -1) },
  fadeInRight: { kind: 'enter', defaultDuration: 0.7, build: fadeDirectional('x', 1) },
  slideInUp: { kind: 'enter', defaultDuration: 0.6, build: slide('y', 1) },
  slideInDown: { kind: 'enter', defaultDuration: 0.6, build: slide('y', -1) },
  slideInLeft: { kind: 'enter', defaultDuration: 0.6, build: slide('x', -1) },
  slideInRight: { kind: 'enter', defaultDuration: 0.6, build: slide('x', 1) },
  zoomIn: { kind: 'enter', defaultDuration: 0.6, build: zoom },
  popIn: { kind: 'enter', defaultDuration: 0.5, build: pop },
  rotateIn: { kind: 'enter', defaultDuration: 0.7, build: rotate },
  dropIn: { kind: 'enter', defaultDuration: 0.9, build: drop },
  fadeOut: { kind: 'exit', defaultDuration: 0.5, build: fadeOut },
  fadeOutUp: { kind: 'exit', defaultDuration: 0.6, build: fadeOutDirectional('y', -1) },
  fadeOutDown: { kind: 'exit', defaultDuration: 0.6, build: fadeOutDirectional('y', 1) },
  slideOutLeft: { kind: 'exit', defaultDuration: 0.6, build: slideOut('x', -1) },
  slideOutRight: { kind: 'exit', defaultDuration: 0.6, build: slideOut('x', 1) },
  zoomOut: { kind: 'exit', defaultDuration: 0.5, build: zoomOut },
  spin: { kind: 'loop', defaultDuration: 4, build: spin },
  float: { kind: 'loop', defaultDuration: 3, build: float },
  pulse: { kind: 'loop', defaultDuration: 1.2, build: pulse },
  sway: { kind: 'loop', defaultDuration: 2.4, build: sway },
};

export interface ExpandResult {
  tweens: Tween[];
  errors: string[];
}

type ThreeLayer = Extract<Layer, { type: 'three' }>;

/** The loop presets `loop.target = "object:<id>"` may retarget (engine/docs/02-timeline.md). */
const RETARGETABLE_LOOPS: ReadonlySet<PresetName> = new Set<PresetName>(['spin', 'float', 'sway']);

/** The 3D object a `loop.target` names, or `null` when the target is not one on a three layer. */
function objectTarget(layer: Layer, target: string): ThreeLayer['objects'][number] | null {
  if (layer.type !== 'three' || !target.startsWith('object:')) return null;
  const id = target.slice('object:'.length);
  return layer.objects.find((object) => object.id === id) ?? null;
}

function objectBaseOf(object: ThreeLayer['objects'][number]): PresetObjectBase {
  return {
    position: { x: object.position[0], y: object.position[1], z: object.position[2] },
    rotation: { x: object.rotation[0], y: object.rotation[1], z: object.rotation[2] },
  };
}

/**
 * Places a layer's enter, exit and loop presets in layer-local time and builds their tweens
 * (engine/docs/02-timeline.md, "Presets"). Enter starts at 0, exit at `layerLength - duration`, and
 * the loop fills the gap with `floor(span / period)` whole periods so it always ends at rest; a span
 * shorter than one period adds nothing. `loop.target = "object:<id>"` retargets spin, float and sway
 * to a 3D object. Returns the tweens and one error string per bad preset reference.
 */
export function expandPresets(layer: Layer, ctx: PresetContext): ExpandResult {
  const tweens: Tween[] = [];
  const errors: string[] = [];

  let enterEnd = 0;
  const enter = layer.enter;
  if (enter) {
    const def = PRESETS[enter.name];
    if (!def) {
      errors.push(`layers.${layer.id}.enter: unknown preset "${enter.name}"`);
    } else if (enter.target !== undefined) {
      errors.push(`layers.${layer.id}.enter: target is only allowed on a loop preset`);
    } else {
      const duration = enter.duration ?? def.defaultDuration;
      tweens.push(...def.build(ctx, enter, 0, duration));
      enterEnd = duration;
    }
  }

  let exitStart = ctx.layerLength;
  const exit = layer.exit;
  if (exit) {
    const def = PRESETS[exit.name];
    if (!def) {
      errors.push(`layers.${layer.id}.exit: unknown preset "${exit.name}"`);
    } else if (exit.target !== undefined) {
      errors.push(`layers.${layer.id}.exit: target is only allowed on a loop preset`);
    } else {
      const duration = exit.duration ?? def.defaultDuration;
      exitStart = ctx.layerLength - duration;
      tweens.push(...def.build(ctx, exit, exitStart, duration));
    }
  }

  const loop = layer.loop;
  if (loop) {
    const def = PRESETS[loop.name];
    if (!def) {
      errors.push(`layers.${layer.id}.loop: unknown preset "${loop.name}"`);
    } else {
      let loopCtx = ctx;
      let usableTarget = loop.target === undefined;
      if (loop.target !== undefined) {
        if (!RETARGETABLE_LOOPS.has(loop.name)) {
          errors.push(`layers.${layer.id}.loop: target is only allowed on the spin, float and sway presets`);
        } else {
          const object = objectTarget(layer, loop.target);
          if (!object) {
            errors.push(`layers.${layer.id}.loop: target "${loop.target}" is not an object on a three layer`);
          } else {
            loopCtx = { ...ctx, objectBase: objectBaseOf(object) };
            usableTarget = true;
          }
        }
      }

      if (usableTarget) {
        const period = loopPeriod(loop.name, loop);
        const periods = wholePeriods(exitStart - enterEnd, period);
        if (periods > 0) tweens.push(...def.build(loopCtx, loop, enterEnd, periods * period));
      }
    }
  }

  return { tweens, errors };
}
