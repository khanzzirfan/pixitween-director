// Ported from reacthub-pixitweenjs src/utils/gsapEffects/ (MIT).
// The camera presets are adapted from reacthub-pixitweenjs
// src/components/AepComposition/model3d/cameraMoves.ts (MIT): the camera-move vocabulary (orbit,
// crane, dolly zoom, handheld) and its numbers are that library's idea. Our maths is ours: the
// moves are camera tweens on our GSAP clock, and engine/docs/09-camera.md is the contract.
import { seedFor } from '../core/seed';
import type { CameraState } from '../core/types';
import { CAMERA_PRESET_SET, TEXT_PRESET_SET, type PresetKind, type PresetName } from '../schema/enums';
import { parseUnitTarget } from '../schema/scalars';
import { countUnits } from '../three/text/layout';
import type { ShotSpec } from '../schema/shot';
import type { Layer } from '../schema/layer';
import { staggerSpan, type Tween } from './compile';

export type { PresetKind };

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
  /**
   * The camera's rest pose and lens. The camera presets read it to build their moves; a layer
   * without a camera (or whose rig is not built yet) leaves it out.
   */
  camera?: CameraState;
  /** Frames a shot by film vocabulary against the layer's own objects (the `cameraTo` preset). */
  frameShot?: (shot: ShotSpec) => CameraState | null;
  /** The document's frame rate, for the handheld jitter's frame numbers. */
  fps?: number;
  /** Text presets only: how many units the preset's target has. `expandPresets` fills it. */
  unitCount?: number;
}

export interface PresetRef {
  name: PresetName;
  duration?: number;
  ease?: string;
  target?: string;
  params?: Record<string, number | string | boolean | ShotSpec>;
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
    case 'orbit':
      return 6;
    case 'handheld':
      return 2;
    case 'glyphWave':
      return 1.2;
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

// The text presets (engine/docs/07-text3d.md): per-unit tweens on a `glyphs:|words:|lines:<id>`
// target with a stagger. `duration` is the per-unit duration; the whole effect spans
// `max(order) * each + duration`.
const TEXT_STAGGER: Partial<Record<PresetName, { each: number; from?: 'end' }>> = {
  glyphRise: { each: 0.04 },
  glyphPop: { each: 0.05 },
  glyphFlip: { each: 0.05 },
  glyphFadeOut: { each: 0.03, from: 'end' },
  glyphWave: { each: 0.06 },
};

/** The stagger a text preset uses: `params.stagger` overrides the preset's default gap. */
function textStagger(ref: PresetRef): { each: number; from?: 'end' } {
  const base = TEXT_STAGGER[ref.name] ?? { each: 0.05 };
  const raw = ref.params?.stagger;
  return typeof raw === 'number' && raw >= 0 ? { ...base, each: raw } : base;
}

/** Seconds from a text preset's start to its last unit finishing, for per-unit `duration`. */
export function textPresetSpan(ref: PresetRef, units: number, duration: number): number {
  const stagger = textStagger(ref);
  return staggerSpan(units, stagger.each, stagger.from ?? 'start', duration, 0);
}

const glyphRise: Build = (ctx, ref, at, duration) => {
  const distance = numberParam(ref, 'distance', 0.3);
  const stagger = textStagger(ref);
  const target = ref.target;
  const ease = ref.ease ?? 'power3.out';
  const tweens: Tween[] = [
    { target, at, duration, ease, stagger, from: { 'offset.y': -distance }, to: { 'offset.y': 0 } },
    { target, at, duration, ease: 'none', stagger, from: { alpha: 0 }, to: { alpha: 1 } },
  ];
  return tweens;
};

const glyphPop: Build = (ctx, ref, at, duration) => {
  const stagger = textStagger(ref);
  const target = ref.target;
  const tweens: Tween[] = [
    { target, at, duration, ease: ref.ease ?? 'back.out(2)', stagger, from: { scale: 0 }, to: { scale: 1 } },
    { target, at, duration: duration * 0.4, ease: 'power1.out', stagger, from: { alpha: 0 }, to: { alpha: 1 } },
  ];
  return tweens;
};

const glyphFlip: Build = (ctx, ref, at, duration) => {
  const stagger = textStagger(ref);
  const target = ref.target;
  const ease = ref.ease ?? 'power2.out';
  const tweens: Tween[] = [
    { target, at, duration, ease, stagger, from: { 'rotation.x': 90 }, to: { 'rotation.x': 0 } },
    { target, at, duration, ease: 'none', stagger, from: { alpha: 0 }, to: { alpha: 1 } },
  ];
  return tweens;
};

const glyphFadeOut: Build = (ctx, ref, at, duration) => {
  const distance = numberParam(ref, 'distance', 0.2);
  const stagger = textStagger(ref);
  const target = ref.target;
  const ease = ref.ease ?? 'power2.in';
  const tweens: Tween[] = [
    { target, at, duration, ease: 'none', stagger, from: { alpha: 1 }, to: { alpha: 0 } },
    { target, at, duration, ease, stagger, from: { 'offset.y': 0 }, to: { 'offset.y': distance } },
  ];
  return tweens;
};

/**
 * `glyphWave` — `duration` is the whole loop span here. The staggered tail is subtracted so whole
 * periods end at rest for every unit; a span shorter than one period plus the tail adds nothing.
 */
const glyphWave: Build = (ctx, ref, at, duration) => {
  const period = loopPeriod('glyphWave', ref);
  const stagger = textStagger(ref);
  const units = ctx.unitCount ?? 1;
  const tail = textPresetSpan(ref, units, 0);
  const periods = wholePeriods(duration - tail, period);
  if (periods <= 0) return [];
  const amplitude = numberParam(ref, 'amplitude', 0.08);
  return [
    {
      target: ref.target,
      at,
      duration: period / 2,
      ease: ref.ease ?? 'sine.inOut',
      stagger,
      repeat: 2 * periods - 1,
      yoyo: true,
      from: { 'offset.y': 0 },
      to: { 'offset.y': amplitude },
    },
  ];
};

// The camera presets (engine/docs/09-camera.md): they move the camera of a three layer, so they
// read the camera's rest pose from the context.

/** Every camera preset targets the camera. */
const CAMERA_TARGET = 'camera';

/** The orbit's keys per period: enough that the arc is not a polygon. */
const ORBIT_KEYS = 8;

/** The handheld's keys per second. */
const HANDHELD_KEY_RATE = 4;

/** The seeds of the handheld's two wobbles (the pan and the tilt). */
const HANDHELD_PAN_SALT = 7;
const HANDHELD_TILT_SALT = 8;

/** The frame rate the handheld falls back on when the context does not carry one. */
const DEFAULT_FPS = 30;

/** The largest dolly zoom: the camera never ends closer than a fifth of its distance. */
const MAX_DOLLY_ZOOM = 0.8;

/** The candidate key counts of a dolly zoom, from the coarsest to the finest. */
const DOLLY_ZOOM_KEY_COUNTS = [4, 6, 8, 12, 16, 24, 32];

/** The error the dolly zoom's straight-line lens may leave in `distance × tan(fov / 2)`. */
const DOLLY_ZOOM_TOLERANCE = 0.005;

/** A numeric parameter, or the default when it is missing or not a number. */
function numberParam(ref: PresetRef, name: string, fallback: number): number {
  const raw = ref.params?.[name];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

/** The shot a preset frames (`params.shot`), or null when it names none. */
function shotParam(ref: PresetRef): ShotSpec | null {
  const raw = ref.params?.shot;
  if (!raw || typeof raw !== 'object') return null;
  return raw;
}

/** The camera's position as tween properties. */
function positionProps(position: readonly [number, number, number]): Record<string, number> {
  return { 'position.x': position[0], 'position.y': position[1], 'position.z': position[2] };
}

/** The distance between the camera and the point it looks at. */
function cameraDistance(camera: CameraState): number {
  const dx = camera.position[0] - camera.lookAt[0];
  const dy = camera.position[1] - camera.lookAt[1];
  const dz = camera.position[2] - camera.lookAt[2];
  return Math.hypot(dx, dy, dz);
}

/**
 * `cameraTo` — moves the camera to a shot's framed pose: where it stands, what it looks at and how
 * wide the lens is. The runtime frames the shot, because only it knows the subject's world box.
 */
const cameraTo: Build = (ctx, ref, at, duration) => {
  const shot = shotParam(ref);
  const framed = shot ? ctx.frameShot?.(shot) : undefined;
  if (!framed) return [];
  return [
    {
      target: CAMERA_TARGET,
      at,
      duration,
      ease: ref.ease ?? 'sine.inOut',
      to: {
        ...positionProps(framed.position),
        'lookAt.x': framed.lookAt[0],
        'lookAt.y': framed.lookAt[1],
        'lookAt.z': framed.lookAt[2],
        fov: framed.fov,
      },
    },
  ];
};

/**
 * `crane` — lifts the camera by `params.height` metres (default 1) and keeps the look-at point, so
 * the subject stays framed while the camera rises over it.
 */
const crane: Build = (ctx, ref, at, duration) => {
  const camera = ctx.camera;
  if (!camera) return [];
  const height = numberParam(ref, 'height', 1);
  return [
    {
      target: CAMERA_TARGET,
      at,
      duration,
      ease: ref.ease ?? 'sine.inOut',
      to: { 'position.y': camera.position[1] + height },
    },
  ];
};

/**
 * `orbit` — swings the camera around the look-at point and back, so the move loops. The camera
 * keeps its height and its distance from the look-at point; only its azimuth around it changes.
 */
const orbit: Build = (ctx, ref, at, duration) => {
  const camera = ctx.camera;
  if (!camera) return [];
  const degrees = numberParam(ref, 'degrees', 30);
  const period = loopPeriod('orbit', ref);
  const periods = wholePeriods(duration, period);
  if (periods <= 0) return [];
  const step = period / ORBIT_KEYS;
  const tweens: Tween[] = [];
  for (let periodIndex = 0; periodIndex < periods; periodIndex++) {
    const base = at + periodIndex * period;
    let from = orbitPosition(camera, degrees, 0);
    for (let key = 1; key <= ORBIT_KEYS; key++) {
      const to = orbitPosition(camera, degrees, key / ORBIT_KEYS);
      tweens.push({
        target: CAMERA_TARGET,
        at: base + (key - 1) * step,
        duration: step,
        ease: 'none',
        from: positionProps(from),
        to: positionProps(to),
      });
      from = to;
    }
  }
  return tweens;
};

/**
 * The camera's position at `u` along the orbit. The swing is a cosine, so the camera leaves and
 * returns to its start with no speed at either end, and `u = 1` is where it began.
 */
function orbitPosition(camera: CameraState, degrees: number, u: number): [number, number, number] {
  const sweep = ((degrees * (1 - Math.cos(2 * Math.PI * u))) / 2) * (Math.PI / 180);
  const dx = camera.position[0] - camera.lookAt[0];
  const dz = camera.position[2] - camera.lookAt[2];
  const cos = Math.cos(sweep);
  const sin = Math.sin(sweep);
  return [
    camera.lookAt[0] + dx * cos + dz * sin,
    camera.position[1],
    camera.lookAt[2] - dx * sin + dz * cos,
  ];
}

/**
 * `dollyZoom` — dollies the camera in while the lens widens, so the subject keeps its size in
 * frame and the perspective stretches (the "vertigo" move).
 *
 * What keeps the subject the same size is `distance × tan(fov / 2)`. The camera's distance is a
 * straight line, so only the lens has to be keyed: often enough that the straight lines between
 * the keys keep that product within a fraction of a percent of its constant.
 */
const dollyZoom: Build = (ctx, ref, at, duration) => {
  const camera = ctx.camera;
  if (!camera) return [];
  const amount = Math.min(MAX_DOLLY_ZOOM, Math.max(0, numberParam(ref, 'amount', 0.5)));
  if (amount <= 0) return [];
  if (cameraDistance(camera) <= 0) return [];
  const tan0 = Math.tan((camera.fov * Math.PI) / 360);
  const keys = dollyZoomKeyCount(camera.fov, amount);
  const step = duration / keys;
  const tweens: Tween[] = [];
  let from = { position: camera.position, fov: camera.fov };
  for (let key = 1; key <= keys; key++) {
    const to = dollyZoomPose(camera, tan0, amount, key / keys);
    tweens.push({
      target: CAMERA_TARGET,
      at: at + (key - 1) * step,
      duration: step,
      ease: 'none',
      from: { ...positionProps(from.position), fov: from.fov },
      to: { ...positionProps(to.position), fov: to.fov },
    });
    from = to;
  }
  return tweens;
};

/** The camera's pose at `u` along the dolly zoom: nearer the subject, with a wider lens. */
function dollyZoomPose(
  camera: CameraState,
  tan0: number,
  amount: number,
  u: number,
): { position: [number, number, number]; fov: number } {
  const scale = 1 - amount * u;
  return {
    position: [
      camera.lookAt[0] + (camera.position[0] - camera.lookAt[0]) * scale,
      camera.lookAt[1] + (camera.position[1] - camera.lookAt[1]) * scale,
      camera.lookAt[2] + (camera.position[2] - camera.lookAt[2]) * scale,
    ],
    fov: (2 * Math.atan(tan0 / scale) * 180) / Math.PI,
  };
}

/**
 * How many keys the dolly zoom needs: the straight line between two keys is not the curve, so the
 * finer the keys the closer `distance × tan(fov / 2)` stays to its constant.
 */
function dollyZoomKeyCount(fov: number, amount: number): number {
  for (const keys of DOLLY_ZOOM_KEY_COUNTS) {
    if (dollyZoomError(fov, amount, keys) <= DOLLY_ZOOM_TOLERANCE) return keys;
  }
  return DOLLY_ZOOM_KEY_COUNTS[DOLLY_ZOOM_KEY_COUNTS.length - 1];
}

/** The largest relative error the straight-line lens leaves in `distance × tan(fov / 2)`. */
function dollyZoomError(fov: number, amount: number, keys: number): number {
  const tan0 = Math.tan((fov * Math.PI) / 360);
  let worst = 0;
  for (let key = 0; key < keys; key++) {
    const u0 = key / keys;
    const u1 = (key + 1) / keys;
    const fov0 = (2 * Math.atan(tan0 / (1 - amount * u0)) * 180) / Math.PI;
    const fov1 = (2 * Math.atan(tan0 / (1 - amount * u1)) * 180) / Math.PI;
    for (let step = 0; step <= 4; step++) {
      const u = u0 + ((u1 - u0) * step) / 4;
      const lens = fov0 + ((fov1 - fov0) * step) / 4;
      const product = (1 - amount * u) * Math.tan((lens * Math.PI) / 360);
      worst = Math.max(worst, Math.abs(product - tan0) / tan0);
    }
  }
  return worst;
}

/**
 * `handheld` — the small wobble of a camera held in a hand: the view turns a fraction of a degree
 * here and there. The wobble is `seedFor` noise smoothed over the keys, so the same layer always
 * shakes the same way.
 */
const handheld: Build = (ctx, ref, at, duration) => {
  const amount = numberParam(ref, 'amount', 0.6);
  const period = loopPeriod('handheld', ref);
  const periods = wholePeriods(duration, period);
  if (periods <= 0) return [];
  const keys = Math.max(2, Math.round(period * HANDHELD_KEY_RATE));
  const step = period / keys;
  const fps = ctx.fps ?? DEFAULT_FPS;
  const pan = handheldWobble(keys, step, amount, fps, HANDHELD_PAN_SALT);
  const tilt = handheldWobble(keys, step, amount, fps, HANDHELD_TILT_SALT);
  const tweens: Tween[] = [];
  for (let periodIndex = 0; periodIndex < periods; periodIndex++) {
    const base = at + periodIndex * period;
    for (let key = 1; key <= keys; key++) {
      const previous = key - 1;
      tweens.push({
        target: CAMERA_TARGET,
        at: base + previous * step,
        duration: step,
        ease: 'none',
        from: { 'rig.pan': pan[previous], 'rig.tilt': tilt[previous] },
        to: { 'rig.pan': pan[key % keys], 'rig.tilt': tilt[key % keys] },
      });
    }
  }
  return tweens;
};

/**
 * The wobble of one period: noise per key, smoothed into a slow drift and scaled so the widest
 * swing is exactly `amount` degrees. The wobble starts at zero, so the move leaves the camera at
 * rest and the loop has no seam.
 */
function handheldWobble(keys: number, step: number, amount: number, fps: number, salt: number): number[] {
  const noise: number[] = [];
  for (let key = 0; key < keys; key++) {
    noise.push(seedFor(Math.round(key * step * fps), salt) * 2 - 1);
  }
  const smoothed = noise.map((_, key) => (noise[(key + keys - 1) % keys] + noise[key] + noise[(key + 1) % keys]) / 3);
  const start = smoothed[0];
  const centred = smoothed.map((value) => value - start);
  const peak = Math.max(...centred.map((value) => Math.abs(value)));
  if (peak === 0) return centred;
  return centred.map((value) => (value / peak) * amount);
}

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
  cameraTo: { kind: 'enter', defaultDuration: 1.5, build: cameraTo },
  crane: { kind: 'enter', defaultDuration: 2, build: crane },
  dollyZoom: { kind: 'enter', defaultDuration: 1.5, build: dollyZoom },
  orbit: { kind: 'loop', defaultDuration: 6, build: orbit },
  handheld: { kind: 'loop', defaultDuration: 2, build: handheld },
  glyphRise: { kind: 'enter', defaultDuration: 0.5, build: glyphRise },
  glyphPop: { kind: 'enter', defaultDuration: 0.45, build: glyphPop },
  glyphFlip: { kind: 'enter', defaultDuration: 0.6, build: glyphFlip },
  glyphFadeOut: { kind: 'exit', defaultDuration: 0.4, build: glyphFadeOut },
  glyphWave: { kind: 'loop', defaultDuration: 1.2, build: glyphWave },
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
 * A text preset's target and unit count. With no `target` the layer's only text3d object is used
 * (`glyphs:<id>`); two or more text3d objects need an explicit target.
 */
function resolveTextRef(layer: Layer, ref: PresetRef, where: string): { ref: PresetRef; units: number } | string {
  if (layer.type !== 'three') return `${where}: preset "${ref.name}" is only allowed on a three layer with a text3d object`;
  const texts = layer.objects.filter((object) => object.geometry.type === 'text3d');
  let target = ref.target;
  if (target === undefined) {
    if (texts.length === 0) return `${where}: preset "${ref.name}" needs a text3d object on the layer`;
    if (texts.length > 1) {
      return `${where}: preset "${ref.name}" needs a target (glyphs:<id>, words:<id> or lines:<id>) because the layer has ${texts.length} text3d objects`;
    }
    target = `glyphs:${texts[0]?.id}`;
  }
  const unit = parseUnitTarget(target);
  if (!unit) return `${where}: target "${target}" must be glyphs:<id>, words:<id> or lines:<id> for preset "${ref.name}"`;
  const object = texts.find((entry) => entry.id === unit.id);
  if (!object || object.geometry.type !== 'text3d') return `${where}: target "${target}" is not a text3d object on this layer`;
  return { ref: { ...ref, target }, units: countUnits(object.geometry.text)[unit.kind] };
}

/** The error a camera preset on the wrong layer type makes, or null when it is fine. */
function cameraPresetError(layer: Layer, ref: PresetRef): string | null {
  if (!CAMERA_PRESET_SET.has(ref.name)) return null;
  if (layer.type === 'three') return null;
  return `preset "${ref.name}" moves the camera, so it is only allowed on a three layer`;
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
    } else if (TEXT_PRESET_SET.has(enter.name)) {
      const text = resolveTextRef(layer, enter, `layers.${layer.id}.enter`);
      if (typeof text === 'string') {
        errors.push(text);
      } else {
        const duration = enter.duration ?? def.defaultDuration;
        tweens.push(...def.build({ ...ctx, unitCount: text.units }, text.ref, 0, duration));
        enterEnd = textPresetSpan(text.ref, text.units, duration);
      }
    } else if (enter.target !== undefined) {
      errors.push(`layers.${layer.id}.enter: target is only allowed on a loop preset`);
    } else {
      const cameraError = cameraPresetError(layer, enter);
      if (cameraError) {
        errors.push(`layers.${layer.id}.enter: ${cameraError}`);
      } else {
        const duration = enter.duration ?? def.defaultDuration;
        tweens.push(...def.build(ctx, enter, 0, duration));
        enterEnd = duration;
      }
    }
  }

  let exitStart = ctx.layerLength;
  const exit = layer.exit;
  if (exit) {
    const def = PRESETS[exit.name];
    if (!def) {
      errors.push(`layers.${layer.id}.exit: unknown preset "${exit.name}"`);
    } else if (TEXT_PRESET_SET.has(exit.name)) {
      const text = resolveTextRef(layer, exit, `layers.${layer.id}.exit`);
      if (typeof text === 'string') {
        errors.push(text);
      } else {
        const duration = exit.duration ?? def.defaultDuration;
        exitStart = ctx.layerLength - textPresetSpan(text.ref, text.units, duration);
        tweens.push(...def.build({ ...ctx, unitCount: text.units }, text.ref, exitStart, duration));
      }
    } else if (exit.target !== undefined) {
      errors.push(`layers.${layer.id}.exit: target is only allowed on a loop preset`);
    } else {
      const cameraError = cameraPresetError(layer, exit);
      if (cameraError) {
        errors.push(`layers.${layer.id}.exit: ${cameraError}`);
      } else {
        const duration = exit.duration ?? def.defaultDuration;
        exitStart = ctx.layerLength - duration;
        tweens.push(...def.build(ctx, exit, exitStart, duration));
      }
    }
  }

  const loop = layer.loop;
  if (loop) {
    const def = PRESETS[loop.name];
    if (!def) {
      errors.push(`layers.${layer.id}.loop: unknown preset "${loop.name}"`);
    } else if (TEXT_PRESET_SET.has(loop.name)) {
      const text = resolveTextRef(layer, loop, `layers.${layer.id}.loop`);
      if (typeof text === 'string') {
        errors.push(text);
      } else {
        tweens.push(...def.build({ ...ctx, unitCount: text.units }, text.ref, enterEnd, exitStart - enterEnd));
      }
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

      const cameraError = cameraPresetError(layer, loop);
      if (cameraError) {
        errors.push(`layers.${layer.id}.loop: ${cameraError}`);
      } else if (usableTarget) {
        const period = loopPeriod(loop.name, loop);
        const periods = wholePeriods(exitStart - enterEnd, period);
        if (periods > 0) tweens.push(...def.build(loopCtx, loop, enterEnd, periods * period));
      }
    }
  }

  return { tweens, errors };
}
