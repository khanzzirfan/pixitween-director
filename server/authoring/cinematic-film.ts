import { formatPrice } from '@shared/catalog';
import { ASPECT_SIZES } from '@shared/composition';
import { newFilmComposition, registerAsset } from './composition';
import { addLayer, type AddLayerOptions } from './layers';
import { readDirector, writeDirector, sceneMeta } from './meta';
import { defaultFinish, type Grade, type FocusTarget, type Handheld, type ShotFocus, type BoardLight, type EndCard, effectiveAngles, effectiveSizes, totalSeconds, type EASES, type Angle, type Beat, type BeatSheet, type CameraPoint, type Finish, type KeyLevel, type ShotSize, type Tone } from './beatsheet';
import { ELEMENT_BODY } from './forms';
import type { IngredientAsset } from './ingredients';
import { shade, type ClipAsset, type Rect } from './retail-clip';
import { addScene } from './scenes';
import { CAMERA, CUT_SHADERS, FINISH, LIGHT, MATERIALS, SPOT, SURFACES, type Surface } from './cinematic-rules';
import { WALL, type SetAir, type SetLook } from './set-art';
import { setKeyframes } from './transform';
import { rampProgress, type RatePoint } from '@engine/core/speedRamp';
import type { Aspect, Comp, Obj } from './types';
import { inkOn, luma, tint } from './variant-film';
import { TITLE_DEPTH, TITLE_PROPS_MAX, drawable, titleLeaveAt, lineWidth, plateMaterial, roundedRect, slabProp, titleFont, titleSpace, titlesWorld, wordsBox, wordsProp, wrapTitle } from './titles3d';

import type { PrimitiveShape } from '../product3d/types';

// The cinematic film: one beat sheet played in one stage3d world (engine aep-32, schema 1.12.0). The camera cuts between shots and
// moves inside each one; the product (a prop3d can wearing the unwrapped label) tumbles in, turns under a moving key light and holds
// its place; ingredients are swarms, glass cubes and cards round it. Brand, name and price are 2D layers over the world.
// Pure and deterministic: the same sheet and assets give the same JSON, and every position comes from a closed formula of the frame.
//
// Units are metres, Y up, the ground at y = 0. A prop's position is its BOTTOM (the engine normalises it so), so the can stands at y = 0 and the camera looks at its centre, PRODUCT_Y.
// Engine spec: upstream feature aep-32-stage3d-cinematic.

export const SCHEMA = '1.12.0';
const ID = 'cine';
export const PRODUCT_H = 0.16;
export const PRODUCT_Y = PRODUCT_H / 2;
/** The largest stage card (metres) that plays in front of the product; a bigger one plays behind it. */
const CARD_FRONT_MAX = 0.18;
export const FOV_BASE = CAMERA.fovBase;
export const FOV_WIDE = CAMERA.fovWide;
/** Camera height as an angle above the product's centre: low looks up at it, high looks down. */
export const ELEVATION: Record<Angle, number> = { low: -3, eye: 7, high: 28 };
/** How much of the frame's height the product fills at each size. The macro frames the label band and the name above it, about two thirds of the can. */
export const FILL: Record<ShotSize, number> = { wide: 0.32, medium: 0.5, close: 0.8, macro: 1.5 };
/** The lens blur. Low enough that the can's edges stay crisp in every shot; the focus distance follows the camera. */
export const APERTURE = 0.3;
/** A backdrop brighter than this (relative luminance of its top third) takes dark type. */
export const BRIGHT_SKY = 0.45;
/**
 * A flat cut-out is built into a solid; unless Muse says otherwise it is this deep and this round (2 is an ellipse). The depth is a share of the
 * product's shorter side, so a tall bottle is as deep as part of its width and a long, low roll as part of its height, never a thick puck.
 */
export const SOLID = { depth: 0.55, section: 2.6 } as const;

/** Engine limits (STAGE3D_LIMITS in aep-32). */
export const LIMITS = { props: 12, instances: 400, swarm: 200 } as const;

/** A solid element's 3D source. A round piece (a berry) is swept round like a body, as deep as it is wide; a thin one (a leaf) is a thin
 * extrusion; a chunk (a slice, or no form given) keeps the plain extrusion, a quarter of its longest side deep. */
function elementSource(a: IngredientAsset): Obj {
  const w = a.frames[0]?.width ?? 100;
  const h = a.frames[0]?.height ?? 100;
  const contour = a.contour ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
  if (a.form === 'round') return { type: 'extrude', contour, depth: r2(Math.min(w, h) * ELEMENT_BODY.round.depth), section: ELEMENT_BODY.round.section };
  if (a.form === 'thin') return { type: 'extrude', contour, depth: r2(Math.max(w, h) * ELEMENT_BODY.thin.depth), bevel: r2(Math.max(w, 1) * 0.01) };
  return { type: 'extrude', contour, depth: r2(Math.max(w, h) * (a.form === 'chunk' ? ELEMENT_BODY.chunk.depth : 0.25)), bevel: r2(Math.max(w, 1) * 0.03) };
}

export interface CinematicInput {
  aspect: Aspect;
  sheet: BeatSheet;
  /** The product's textures from prepareProduct3D. */
  texture: ClipAsset & { kind: 'label' | 'front' };
  /** A round or box shape wears the texture; 'other' is a flat cut-out, extruded from its outline (`contour`) with the photo on its front. */
  shape: PrimitiveShape | 'other';
  side: string;
  /** Height over width of the product. */
  productAspect: number;
  /** Where the label is on the front picture, [u, v] shares of its width and height (v from the top): the macro shot's camera aims there. Without it the macro looks at the middle. */
  focus?: [number, number];
  /** The outline in the front texture's own pixels; required for shape 'other'. */
  contour?: Array<[number, number]>;
  title: string;
  /** The price on the end disc; without one the end card is the name and tagline alone. */
  price?: number;
  wasPrice?: number;
  currency?: string;
  brand?: string;
  accent: string;
  /** The screen grade over the world. Absent means the one its key level gets. */
  finish?: Finish;
  /** The end card's style, Muse's choice. Absent means a centred pill, a round disc and the product's own accent. */
  endCard?: EndCard;
  /** The product's body when it is a flat cut-out: depth as a share of its shorter side and the cross-section's exponent. Absent means SOLID. */
  body?: { depth?: number; section?: number; axis?: 'up' | 'across' };
  /** How light sits on the product (matte, satin, gloss, metal). Absent means satin. */
  surface?: Surface;
  /** The colours of the key and rim lights, Muse's choice. Absent means the key follows the tone and the rim is white. */
  light?: BoardLight;
  /** Motion blur for the film: the share of a frame the shutter stays open (a shot's own `blur` replaces it). Absent means none. */
  blur?: number;
  /** The ingredients made for this product, by kind. A beat whose kind is missing plays without it. */
  ingredients?: Record<string, IngredientAsset>;
  /** The line under the name in the end hold (at most six words); the shots' own words come from the sheet. */
  tagline?: string;
  /** A live, hand-held tremor over the camera's moves (the board's choice). It is dropped when the world's 64-tween budget has no room for it. */
  handheld?: boolean | Handheld;
  /** The colour grade over the world: tone, split toning, a lens streak, halation, a letterbox. Absent means none of them. */
  grade?: Grade;
  /** How much bright points of light spread into discs where the lens is out of focus (0 none, 1 strong). Absent means none. */
  bokeh?: number;
  /** Spot lights on the product, each a pool of light from one side. Absent means none. */
  spots?: Array<{ side: 'left' | 'right' | 'above' | 'behind' | 'front'; color?: string; strength?: number; cone?: number; soft?: number }>;
  /** What shiny things reflect. Absent means the studio preset's own (the room). */
  reflect?: 'room' | 'softbox' | 'ring' | 'sunset' | 'none';
  /** The lens's base aperture, 0 sharp everywhere to 1 shallow. Absent means APERTURE. */
  aperture?: number;
  /** The board's set: a backdrop picture on the wall behind the product, the floor colour, and the air. Without it the product floats on the plain field. */
  set?: { look: SetLook; air: SetAir; backdrop: ClipAsset; ground: string; /** the soft dot the bokeh lights are drawn with */ dot?: ClipAsset; /** how bright the backdrop is where the words sit (its top third), 0 to 1: it picks dark or light type */ skyLuma?: number };
  /** The board's light: the key light's colour and how dark or bright the world is. */
  tone?: Tone;
  key?: KeyLevel;
  bpm?: number;
  music?: { id: string; src: string; level?: number };
}

type V3 = [number, number, number];
type Bez = [number, number, number, number];
const EASE_OUT: Bez = [0.16, 1, 0.3, 1];
const EASE_IN_OUT: Bez = [0.42, 0, 0.58, 1];
const LINEAR: Bez = [0, 0, 1, 1];
/**
 * The eases that keep a shot moving through its ends. The corpus cuts at peak velocity: the shot before leaves at speed and the shot after
 * enters at speed, so a cut is a change of place, never a stop. This curve runs at two thirds of its mean speed at both ends (EASE_IN_OUT
 * and EASE_OUT stop at the end, which makes a dead cut). The hook enters faster still.
 */
const EASE_THROUGH: Bez = [0.3, 0.2, 0.7, 0.8];
const EASE_HOOK: Bez = [0.15, 0.5, 0.7, 0.8];
const r = (n: number) => Math.round(n * 1e4) / 1e4;
const r2 = (n: number) => Math.round(n * 100) / 100;
const rad = (d: number) => (d * Math.PI) / 180;

interface Key<T> {
  t: number;
  v: T;
  easeIn?: Bez;
  easeOut?: Bez;
  hold?: boolean;
}
const key = <T>(t: number, v: T, e?: Bez, hold?: boolean): Key<T> => ({ t, v, ...(e ? { easeIn: e, easeOut: e } : {}), ...(hold ? { hold: true } : {}) });

/** Distance from the target that makes the product fill `fill` of the frame's height at lens `fov`. */
export const framingDistance = (fill: number, fov: number = FOV_BASE, productH = PRODUCT_H): number => productH / (fill * 2 * Math.tan(rad(fov) / 2));

interface Pose {
  /** metres from the target */
  d: number;
  /** degrees round the product, 0 = straight on */
  az: number;
  fov: number;
  /** degrees above the product's centre */
  el: number;
  /** metres sideways along the camera's right (a truck slides the camera; the target stays on the product) */
  x?: number;
}
const positionOf = (p: Pose): V3 => {
  const el = rad(p.el);
  const az = rad(p.az);
  const side = p.x ?? 0;
  // the camera's right-hand vector at this azimuth is (cos az, 0, -sin az)
  return [r(Math.sin(az) * Math.cos(el) * p.d + Math.cos(az) * side), r(Math.max(CAMERA.minCameraHeight, PRODUCT_Y + Math.sin(el) * p.d)), r(Math.cos(az) * Math.cos(el) * p.d - Math.sin(az) * side)];
};
/** How far the camera starts from where a push arrives: the hook comes in hard (the references push 40-90 %), later pushes ease in. */
export const PUSH_FROM = { hook: CAMERA.pushFromHook, later: CAMERA.pushFromLater, wide: CAMERA.pushFromWide } as const;
/** The whip's ease: nearly all of the swing happens in the first fifth of the shot, then it brakes. */
const EASE_WHIP: Bez = [0.05, 0.9, 0.1, 1];

export interface BeatFrames {
  /** first and last frame of the shot */
  start: number;
  end: number;
  size: ShotSize;
  move: Beat['move'];
  from: Pose;
  to: Pose;
  /** The shot's speed curve, when Muse wrote one. */
  ramp?: RatePoint[];
  /** Poses the camera passes through between `from` and `to`; the path is a smooth curve through them. */
  via?: Pose[];
  /** Where each pose of the path (`from`, the `via`s, `to`) falls in the shot, 0 to 1 (the `via`s' and the end's; the start is 0). Absent means evenly spaced. */
  knots?: number[];
  /** The shot's own aperture, when its focus names one. */
  aperture?: number;
  /** The shot's hand-held tremor as a multiple of the film's, when Muse wrote one. */
  shake?: number;
}
export interface CameraPlan {
  beats: BeatFrames[];
  position: Array<Key<V3>>;
  fov: Array<Key<number>>;
  focus: Array<Key<number>>;
  frames: number;
}

/** A fill from here up is a crop of the label, which no cap holds back. */
const MACRO_FROM = 1.2;
/** The curve each ease word names (Muse's `camera.ease`). */
const EASE_OF: Record<(typeof EASES)[number], Bez> = { through: EASE_THROUGH, snap: EASE_HOOK, smooth: EASE_IN_OUT, linear: LINEAR, whip: EASE_WHIP, float: [0.6, 0, 0.4, 1] };

/**
 * One end of the camera as Muse wrote it, laid over the pose the move gave. fill sets the distance for the lens in force; a lens change
 * without a fill keeps the product's size (the distance follows the lens, as in a dolly-zoom); side slides the camera by a share of its
 * distance. Only safety bounds the numbers (the parse already pulled them into range); a macro crop is the one place fill may pass 1.
 */
function withPoint(pose: Pose, pt: CameraPoint | undefined, cap: number): Pose {
  if (!pt) return pose;
  const fov = pt.lens ?? pose.fov;
  const keepSize = pt.lens !== undefined && pt.fill === undefined ? (pose.d * Math.tan(rad(pose.fov / 2))) / Math.tan(rad(fov / 2)) : undefined;
  const d = pt.fill !== undefined ? framingDistance(pt.fill >= MACRO_FROM ? pt.fill : Math.min(pt.fill, cap), fov) : (keepSize ?? pose.d);
  const x = pt.side !== undefined ? r(pt.side * d) : pose.x;
  return { d: r(d), az: pt.around ?? pose.az, fov, el: pt.height ?? pose.el, ...(x !== undefined ? { x } : {}) };
}

/** Where the lens focuses for a target at a pose: the near things (a piece falling toward it), the product, or the far set behind it. */
export const focusOn = (target: FocusTarget, pose: Pose): number => (target === 'near' ? Math.max(pose.d * 0.45, pose.d - 0.1) : target === 'far' ? pose.d + CAMERA.farFocus : pose.d);

const mixPose = (a: Pose, b: Pose, u: number): Pose => ({ d: a.d + (b.d - a.d) * u, az: a.az + (b.az - a.az) * u, fov: a.fov + (b.fov - a.fov) * u, el: a.el + (b.el - a.el) * u, x: (a.x ?? 0) + ((b.x ?? 0) - (a.x ?? 0)) * u });

/**
 * The camera for a sheet. Every shot is a cut: it starts at its own pose and moves to its arrival pose. A push comes in from 35 % further
 * away, a pull from 30 % closer, a hold creeps in (CAMERA.holdCreep), an orbit swings 44 degrees round the product, and a dolly-zoom widens the lens from 30 to 80
 * degrees while the distance shrinks so the product keeps its size (distance times tan(fov/2) is constant). A hold after a dolly-zoom stays at
 * the wide lens, so the film ends on the reveal.
 */
export function planCamera(sheet: BeatSheet, fps: number, o: { maxFill?: number; holdFill?: number; highEl?: number } = {}): CameraPlan {
  const high = o.highEl ?? ELEVATION.high;
  const elevOf = (a: Angle): number => (a === 'high' ? high : ELEVATION[a]);
  // a wide product must not outgrow the frame's width: the sizes are shares of the frame's height, so they are capped (the macro is a crop on purpose)
  // the end hold keeps the framing of the shot before it, so that shot and the hold are both held to the most the text above the product leaves room for
  const lastIdx = sheet.beats.length - 1;
  const fillOf = (size: ShotSize, i = -1): number => {
    const cap = i >= lastIdx - 1 ? Math.min(o.maxFill ?? Infinity, o.holdFill ?? Infinity) : (o.maxFill ?? Infinity);
    return size === 'macro' ? FILL.macro : Math.min(FILL[size], cap);
  };
  const sizes = effectiveSizes(sheet);
  const angles = effectiveAngles(sheet);
  const beats: BeatFrames[] = [];
  const position: Array<Key<V3>> = [];
  const fov: Array<Key<number>> = [];
  const focus: Array<Key<number>> = [];
  let cur: Pose = { d: framingDistance(FILL.medium), az: 0, fov: FOV_BASE, el: ELEVATION.eye };
  let clock = 0;
  let swings = 0;
  let plunge: Pose | undefined;
  const frames = Math.round(totalSeconds(sheet) * fps);
  sheet.beats.forEach((b, i) => {
    const start = Math.round(clock * fps);
    clock += b.seconds;
    const last = i === sheet.beats.length - 1;
    const end = last ? frames : Math.round(clock * fps) - 1;
    const size = sizes[i]!;
    const el = elevOf(angles[i]!);
    const arrive = framingDistance(fillOf(size, i));
    const az0 = ((i * 37) % 21) - 10;
    // the sideways moves (truck, crane, whip) go one way and the next the other, so the film never repeats a direction
    const dir = swings % 2 === 0 ? 1 : -1;
    if (b.move === 'truck' || b.move === 'crane' || b.move === 'whip') swings++;
    let from: Pose;
    let to: Pose;
    let ease: Bez = EASE_THROUGH;
    let rack = false;
    let via: Pose[] | undefined;
    let shake: number | undefined;
    let pull: ShotFocus | undefined;
    switch (b.move) {
      case 'push':
        from = { d: arrive * (i === 0 ? PUSH_FROM.hook : size === 'wide' ? PUSH_FROM.wide : PUSH_FROM.later), az: az0, fov: FOV_BASE, el };
        to = { d: arrive, az: az0 * 0.5, fov: FOV_BASE, el };
        ease = i === 0 ? EASE_HOOK : EASE_THROUGH;
        break;
      case 'truck':
        // the camera slides a third of the way across, the target stays on the product: the set streams by
        from = { d: arrive, az: 0, fov: FOV_BASE, el, x: -dir * arrive * CAMERA.truckShare };
        to = { d: arrive, az: 0, fov: FOV_BASE, el, x: dir * arrive * CAMERA.truckShare };
        ease = EASE_THROUGH;
        break;
      case 'crane':
        // rises from the low angle to the high one, or falls from high to low
        from = { d: arrive * 1.05, az: az0 * 0.4, fov: FOV_BASE, el: dir > 0 ? ELEVATION.low : high };
        to = { d: arrive, az: az0 * 0.2, fov: FOV_BASE, el: dir > 0 ? high : ELEVATION.low };
        ease = EASE_THROUGH;
        break;
      case 'whip':
        from = { d: arrive * 1.08, az: dir * CAMERA.whipAzimuth, fov: FOV_BASE, el };
        to = { d: arrive, az: 0, fov: FOV_BASE, el };
        ease = EASE_WHIP;
        break;
      case 'rack':
        from = { d: arrive * 1.12, az: az0 * 0.5, fov: FOV_BASE, el };
        to = { d: arrive, az: az0 * 0.25, fov: FOV_BASE, el };
        ease = EASE_THROUGH;
        rack = true;
        break;
      case 'pull':
        from = { d: arrive * 0.7, az: az0, fov: FOV_BASE, el };
        to = { d: arrive, az: az0 * 0.5, fov: FOV_BASE, el };
        break;
      case 'orbit':
        from = { d: arrive, az: -22, fov: FOV_BASE, el };
        to = { d: arrive, az: 22, fov: FOV_BASE, el };
        ease = EASE_THROUGH;
        break;
      case 'dolly-zoom': {
        from = { d: arrive, az: az0 * 0.4, fov: FOV_BASE, el };
        to = { d: r(arrive * (Math.tan(rad(FOV_BASE / 2)) / Math.tan(rad(FOV_WIDE / 2)))), az: az0 * 0.4, fov: FOV_WIDE, el };
        ease = LINEAR;
        break;
      }
      default: {
        // hold: continues from where the last shot ended (after a dolly-zoom that is the wide lens), creeping in
        to = { ...cur };
        from = { d: cur.d * CAMERA.holdCreep, az: cur.az, fov: cur.fov, el: cur.el, ...(cur.x !== undefined ? { x: cur.x } : {}) };
        ease = EASE_IN_OUT;
      }
    }
    // in-scene cuts change where a shot starts, before Muse's own numbers lay over it. match: it starts as close and on the same lens as the shot before
    // ended, so the product keeps its size and place on the screen and only the angle jumps. pass: it starts where the shot before plunged to, a crop of the
    // product's own surface
    if (i > 0 && b.cut === 'match') from = { ...from, d: cur.d, fov: cur.fov, ...(cur.x !== undefined ? { x: cur.x } : {}) };
    if (i > 0 && b.cut === 'pass' && plunge) from = { ...plunge };
    // Muse's own numbers lay over the move's preset: the move is only where a shot starts from when Muse wrote nothing
    if (b.camera) {
      const capShot = i >= lastIdx - 1 ? Math.min(o.maxFill ?? Infinity, o.holdFill ?? Infinity) : (o.maxFill ?? Infinity);
      from = withPoint(from, b.camera.from, capShot);
      to = withPoint(to, b.camera.to, capShot);
      if (b.camera.ease) ease = EASE_OF[b.camera.ease];
      if (b.camera.focus) rack = b.camera.focus === 'rack';
      // the waypoints: each starts from where the straight path would be at its share of the way, then Muse's own numbers lay over it
      const pts = b.camera.via ?? [];
      if (pts.length) via = pts.map((pt, j) => withPoint(mixPose(from, to, (j + 1) / (pts.length + 1)), pt, capShot));
      if (b.camera.shake !== undefined) shake = b.camera.shake;
      if (typeof b.camera.focus === 'object') {
        pull = b.camera.focus;
        rack = false;
      }
    }
    plunge = undefined;
    const arrival = to;
    let knots: number[] | undefined;
    if (!last && sheet.beats[i + 1]?.cut === 'pass') {
      // the shot ends by plunging at the product until it fills the frame: the cut hides in its surface, and the next shot pulls out of it
      plunge = withPoint(to, { fill: CAMERA.passFill }, Infinity);
      const mine = via ?? [];
      const reach = 1 - CAMERA.passTail;
      via = [...mine, arrival];
      knots = [...mine.map((_, j) => ((j + 1) / (mine.length + 1)) * reach * 0.9), reach];
      to = plunge;
    }
    beats.push({ start, end, size, move: b.move, from, to, ...(knots ? { knots } : {}), ...(b.ramp ? { ramp: b.ramp } : {}), ...(via ? { via } : {}), ...(pull?.aperture !== undefined ? { aperture: pull.aperture } : {}), ...(shake !== undefined ? { shake } : {}) });
    position.push(key(start, positionOf(from), ease), key(end, positionOf(to), ease, !last));
    fov.push(key(start, from.fov, ease), key(end, to.fov, ease, !last));
    // the product stays in focus: the focus distance is the camera's distance to it
    // the product stays in focus, except in a rack: the focus starts at the near lights (about half the way) and runs back to the product
    // a written focus pull names what the lens is on at each end; a rack is the old near-to-product pull
    focus.push(key(start, r(pull ? focusOn(pull.from ?? 'product', from) : rack ? to.d * 0.5 : from.d), ease), key(end, r(pull ? focusOn(pull.to ?? 'product', to) : to.d), ease, !last));
    cur = arrival;
  });
  return { beats, position, fov, focus, frames };
}

/** The value an ease gives at progress `u` (0 to 1): the cubic-bezier of its handles, solved for x by Newton's method. */
function bezierAt([x1, y1, x2, y2]: Bez, u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  let t = u;
  for (let n = 0; n < 8; n++) {
    const m = 1 - t;
    const x = 3 * m * m * t * x1 + 3 * m * t * t * x2 + t * t * t;
    const dx = 3 * m * m * x1 + 6 * m * t * (x2 - x1) + 3 * t * t * (1 - x2);
    if (Math.abs(dx) < 1e-9) break;
    t = Math.min(1, Math.max(0, t - (x - u) / dx));
  }
  const m = 1 - t;
  return 3 * m * m * t * y1 + 3 * m * t * t * y2 + t * t * t;
}

/** The moves that may carry a tremor: a whip is too fast to sample, a dolly-zoom must stay steady for the vertigo to read. */
const SHAKY: ReadonlySet<string> = new Set(['push', 'pull', 'truck', 'crane', 'orbit', 'rack', 'hold']);
/** The tremor's size: a share of the camera's distance, about one percent of the frame's height. */
const SHAKE_AMOUNT = CAMERA.shakeAmount;
/** A layer may hold 64 tweens. Everything but the camera's position and lens takes some, and the tremor must leave them room. */
const TWEEN_BUDGET = CAMERA.tweenBudget;

/**
 * How many tremor keys each shot can afford. The camera's position and lens move as one tween per segment (the converter merges them), so a
 * shot with n tremor keys costs n + 2 (its segments and the hold to the next cut), plus 2 for the focus; the product and the light take theirs.
 * Zero means there is no room and the film plays steady.
 */
export function shakeKeysPerShot(shots: number, otherTweens: number, most: number = CAMERA.shakeKeysMax): number {
  return Math.max(0, Math.min(most, Math.floor((TWEEN_BUDGET - otherTweens) / Math.max(1, shots)) - 4));
}

/**
 * How many keys a ramped shot gets between its ends: as many as the rule book allows, fewer when the world's tween budget is short, and none
 * when fewer than two would fit (the shot then plays straight, but the world's own motion still follows the ramp). `others` is what the rest of the
 * film already takes; each ramped shot costs one tween a key for the camera and two for a spin that also tosses.
 */
export function rampKeysFor(rampShots: number, spinShots: number, others: number): number {
  const perKey = rampShots + 2 * spinShots;
  if (perKey < 1) return 0;
  const k = Math.min(CAMERA.rampKeys, Math.floor((TWEEN_BUDGET - others) / perKey));
  return k < 2 ? 0 : k;
}

/**
 * The camera between a shot's ends. A shot is sampled along its path when it has something to show there: a tremor (a few small nudges), a speed
 * ramp (the ease runs over the progress the ramp reached) or a curved path (a smooth curve through the poses Muse named). Every sample is the
 * planned path's own value plus the nudge, so a cut and a hold meet it exactly: only the keys between a shot's ends move. The segments are
 * linear, since the ease is in the samples (a through-ease is nearly linear anyway). The tremor is a deterministic pattern of the shot, the key and
 * the seed, so the same board shakes the same way and another seed shakes another way.
 */
export function shakeCamera(plan: CameraPlan, perShot: number, rampKeys: number = CAMERA.rampKeys, hand: { amount?: number; seed?: number } = {}): CameraPlan {
  const curved = plan.beats.some((b) => b.via?.length);
  if (perShot < 1 && !curved && !(rampKeys >= 1 && plan.beats.some((b) => b.ramp))) return plan;
  const position: Array<Key<V3>> = [];
  const fov: Array<Key<number>> = [];
  const focus: Array<Key<number>> = [];
  const seed = (hand.seed ?? 0) * 13;
  plan.beats.forEach((b, n) => {
    const p0 = plan.position[n * 2]!;
    const p1 = plan.position[n * 2 + 1]!;
    const f0 = plan.fov[n * 2]!;
    const f1 = plan.fov[n * 2 + 1]!;
    const d0 = plan.focus[n * 2]!;
    const d1 = plan.focus[n * 2 + 1]!;
    // a shaky shot is sampled at the tremor's keys, a ramped one at the ramp's, a curved one at two a waypoint (the most of them)
    const shake = (hand.amount ?? 1) * (b.shake ?? 1);
    const shaky = perShot >= 1 && shake > 0 && SHAKY.has(b.move);
    const inner = Math.max(shaky ? perShot : 0, b.ramp ? rampKeys : 0, pathKeysOf(b));
    if (inner < 1 || p1.t - p0.t < 4 * (inner + 1)) {
      position.push(p0, p1);
      fov.push(f0, f1);
      focus.push(d0, d1);
      return;
    }
    const e: Bez = p0.easeOut ?? LINEAR;
    const amp = shaky ? SHAKE_AMOUNT * b.to.d * shake : 0;
    const path = b.via?.length ? [b.from, ...b.via, b.to] : undefined;
    // the focus follows the product when both its ends do; a pull between other targets runs straight between its ends
    const follows = Math.abs(d0.v - b.from.d) < 1e-3 && Math.abs(d1.v - b.to.d) < 1e-3;
    for (let k = 0; k <= inner + 1; k++) {
      const u = k / (inner + 1);
      // a ramp bends the shot's time: the ease then runs over the progress the ramp reached, not over the clock
      const w = bezierAt(e, b.ramp ? rampProgress(b.ramp, u) : u);
      const t = k === 0 ? p0.t : k === inner + 1 ? p1.t : Math.round(p0.t + u * (p1.t - p0.t));
      const edge = k === 0 || k === inner + 1;
      const wob = (axis: number) => (edge ? 0 : (Math.sin((n * 7 + k * 3 + axis * 5 + seed) * 1.7) * 0.6 + Math.cos((n * 3 + k * 5 + axis + seed) * 2.3) * 0.4) * amp);
      const pose = path ? curveAt(path, w, b.knots) : undefined;
      const base: V3 = pose ? positionOf(pose) : [p0.v[0] + (p1.v[0] - p0.v[0]) * w, p0.v[1] + (p1.v[1] - p0.v[1]) * w, p0.v[2] + (p1.v[2] - p0.v[2]) * w];
      const v: V3 = [r(base[0] + wob(0)), r(base[1] + wob(1)), r(base[2])];
      const lens = r(pose ? pose.fov : f0.v + (f1.v - f0.v) * w);
      position.push(key(t, v, undefined, edge && k > 0 && !!p1.hold));
      fov.push(key(t, lens, undefined, edge && k > 0 && !!f1.hold));
      if (pose) focus.push(key(t, r(follows ? pose.d : d0.v + (d1.v - d0.v) * w), undefined, edge && k > 0 && !!d1.hold));
    }
    // a curved shot's focus was sampled with the camera; a straight one keeps its two keys
    if (!path) focus.push(d0, d1);
  });
  return { ...plan, position, fov, focus: curved ? focus : plan.focus };
}

/** The keys a curved shot is sampled at between its ends: two a waypoint and two more, and three more for a plunge, whose end is quick. */
export const pathKeysOf = (b: BeatFrames): number => (b.via?.length ? b.via.length * 2 + 2 + (b.knots ? 3 : 0) : 0);

/** A smooth curve through the poses (a Catmull-Rom spline over distance, azimuth, lens, height and sideways slide), at share `u` of the way along it. */
function curveAt(path: Pose[], u: number, knots?: number[]): Pose {
  const segs = path.length - 1;
  let i: number;
  let t: number;
  if (knots && knots.length === segs) {
    // the poses fall where `knots` say: the segment holding `u`, and how far along it
    const at = [0, ...knots];
    i = 0;
    while (i < segs - 1 && u > at[i + 1]!) i++;
    t = Math.min(1, Math.max(0, (u - at[i]!) / Math.max(1e-6, at[i + 1]! - at[i]!)));
  } else {
    const x = Math.min(segs - 1e-9, Math.max(0, u * segs));
    i = Math.floor(x);
    t = x - i;
  }
  const at = (j: number): Pose => path[Math.min(path.length - 1, Math.max(0, j))]!;
  const spline = (pick: (q: Pose) => number): number => {
    const p0 = pick(at(i - 1));
    const p1 = pick(at(i));
    const p2 = pick(at(i + 1));
    const p3 = pick(at(i + 2));
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  };
  return { d: Math.max(0.05, spline((q) => q.d)), az: spline((q) => q.az), fov: Math.min(95, Math.max(10, spline((q) => q.fov))), el: spline((q) => q.el), x: spline((q) => q.x ?? 0) };
}

/** How fast a segment starts and ends, as a share of its mean speed: the slope of its ease at both ends. A key without an ease is linear (1 and 1). */
function endSlopes(k: Key<unknown>): { start: number; end: number } {
  const e = k.easeOut;
  if (!e) return { start: 1, end: 1 };
  return { start: e[0] > 0 ? e[1] / e[0] : Infinity, end: e[2] < 1 ? (1 - e[3]) / (1 - e[2]) : Infinity };
}

export interface CutSpeed {
  /** the cut is at the start of this shot (index into the beats) */
  shot: number;
  /** how fast the shot before leaves, and the shot after enters, as shares of their mean speeds; null when that side is a hold (still by design) */
  out: number | null;
  in: number | null;
}
/**
 * The speed at each cut: the camera leaves one shot and enters the next at this share of its mean speed (1 is steady). A cut between two
 * moving shots should be well above 0 on both sides; a hold has no speed to carry, and a whip brakes on purpose, so neither is measured.
 */
export function cutSpeeds(plan: CameraPlan): CutSpeed[] {
  const out: CutSpeed[] = [];
  for (let n = 1; n < plan.beats.length; n++) {
    const a = plan.beats[n - 1]!;
    const b = plan.beats[n]!;
    const leaving = a.move === 'hold' || a.move === 'whip' ? null : endSlopes(plan.position[(n - 1) * 2]!).end;
    const entering = b.move === 'hold' ? null : endSlopes(plan.position[n * 2]!).start;
    out.push({ shot: n, out: leaving, in: entering });
  }
  return out;
}

// ---- layer helpers (the scene's 2D layers go through addLayer like every other clip) ----

const layersOf = (c: Comp): Obj[] => (c.precomps as Record<string, Obj>)[ID]!.layers as Obj[];
function add(c: Comp, o: Omit<AddLayerOptions, 'sceneId'>, retag = false): { c: Comp; id: string } {
  const before = new Set(layersOf(c).map((l) => l.id));
  let out = addLayer(c, { sceneId: ID, ...o });
  const id = layersOf(out).find((l) => !before.has(l.id))!.id;
  if (retag) {
    const meta = readDirector(out);
    meta.layers[id] = { ...meta.layers[id]!, role: 'subject', z: o.z ?? 0 };
    out = writeDirector(out, meta);
  }
  return { c: out, id };
}
function patch(c: Comp, id: string, fn: (l: Obj) => void): Comp {
  const out = structuredClone(c);
  fn(layersOf(out).find((x) => x.id === id)!);
  return out;
}
function shape(c: Comp, box: Rect, fill: string, z: number, path?: Obj, look?: (l: Obj) => void): { c: Comp; id: string } {
  const s = add(c, { role: 'bg', kind: 'shape', fill, box, z }, true);
  return { c: patch(s.c, s.id, (l) => { if (path) l.path = path; look?.(l); }), id: s.id };
}

/** Puts the world and then its members into the scene by depth (layers run farthest first): after the 2D field and halo (z 12 and 11), before the copy. */
function insertStage(c: Comp, world: Obj, members: Obj[]): Comp {
  const out = structuredClone(c);
  const layers = layersOf(out);
  const meta = readDirector(out);
  let at = layers.findIndex((l) => (meta.layers[l.id]?.z ?? 0) < 5);
  if (at < 0) at = layers.length;
  layers.splice(at, 0, world, ...members);
  meta.layers[world.id] = { sceneId: ID, role: 'stage3d', z: 5 };
  for (const m of members) meta.layers[m.id] = { sceneId: ID, role: 'prop3d', z: 5 };
  Object.assign(out, writeDirector(out, meta));
  return out;
}

/** A film asset is also copied into the scene's own asset map, where the engine looks for the scene's layers. */
function share(c: Comp, assetId: string): Comp {
  const out = structuredClone(c);
  const a = (out.assets as Record<string, Obj>)[assetId];
  if (a) ((out.precomps as Record<string, Obj>)[ID]!.assets as Record<string, Obj>)[assetId] = structuredClone(a);
  return out;
}

// ---- ingredients ----

const hash = (n: number) => (n * 2654435761) >>> 0;

interface Planned {
  beat: number;
  layer: Obj;
  instances: number;
}

/** The prop for one beat's ingredient, or undefined when the asset is missing or the action does not suit the kind. */
function ingredientProp(i: number, b: Beat, f: BeatFrames, a: IngredientAsset | undefined): Planned | undefined {
  if (!b.ingredient || !a) return undefined;
  const act = b.ingredient.action;
  const id = `${ID}:ing${i}-${a.kind}`;
  const inPoint = f.start;
  const base = { id, name: `${a.kind} ${act}`, kind: 'prop3d', stage: `${ID}:world`, inPoint, outPoint: Math.min(f.end + (act === 'fall' || act === 'burst' ? 12 : 1), 10 ** 6) };
  const sec = b.seconds;
  // Muse's own size and depth for the element; its default depth is the one the kind plays at
  const size = r(a.sizeM * (b.ingredient.scale ?? 1));
  const depth = (dflt: number): number => (b.ingredient!.place === 'front' ? 0.08 : b.ingredient!.place === 'behind' ? -0.07 : b.ingredient!.place === 'around' ? 0 : dflt);

  if (a.use === 'liquid') {
    // real liquid, drawn by the engine round the product: a crown splash, a stream pouring beside it, or drops floating round it
    const form = act === 'pour' ? 'pour' : act === 'swirl' ? 'vortex' : act === 'drift' ? 'blobs' : act === 'splash' ? 'crown' : undefined;
    if (!form) return undefined;
    const look = a.clear
      ? { color: a.color ?? '#d8eef8', roughness: 0.02, clearcoat: 1, transmission: 0.92, ior: 1.33, thickness: 0.06 }
      : { color: a.color ?? '#4a2a16', roughness: 0.05, clearcoat: 1 };
    return {
      beat: i,
      instances: 1,
      layer: { ...base, outPoint: f.end + 1, source: { type: 'liquid', form, seed: 3 + (hash(i + 7) % 97) }, size, position: [form === 'pour' ? 0.015 : 0, 0, depth(0)], material: look, castShadow: true },
    };
  }

  if (a.use === 'vapour') {
    // soft vapour drawn by the engine, never off an open top: steam rises behind the product and towers over it, a cloud rolls round
    // it and clears, powder bursts out behind it
    const form = act === 'rise' ? 'steam' : act === 'wrap' ? 'cloud' : act === 'burst' ? 'powder' : undefined;
    if (!form) return undefined;
    const position = form === 'cloud' ? [0, 0, -0.04] : form === 'steam' ? [0.015, 0, -0.07] : [0, 0, -0.05];
    return {
      beat: i,
      instances: 1,
      layer: { ...base, ...(form === 'powder' ? {} : { outPoint: f.end + 1 }), source: { type: 'smoke', form, seed: 3 + (hash(i + 7) % 97) }, size, position: [position[0]!, position[1]!, depth(position[2]!)], material: { color: a.color ?? '#f2ece4', opacity: 1 } },
    };
  }

  if (a.use === 'card') {
    if (act === 'splash') {
      // a stage card plays in front of the product only while it is small; a big one would bury it, so it glows from behind instead
      const source: Obj = a.frames.length > 1 ? { type: 'card', frames: a.frames.map((x) => x.id), fps: 24 } : { type: 'card' };
      return { beat: i, instances: 1, layer: { ...base, source, ...(a.frames.length > 1 ? {} : { textures: { front: a.frames[0]!.id } }), size, position: [0, 0.01, depth(size > CARD_FRONT_MAX ? -0.04 : 0.06)], lit: false } };
    }
    // swirl: drifts across behind the product and rolls a little
    return {
      beat: i,
      instances: 1,
      layer: {
        ...base,
        source: { type: 'card' },
        textures: { front: a.frames[0]!.id },
        size,
        position: [key(inPoint, [-0.06, r(PRODUCT_Y - size / 2 + 0.02), depth(-0.07)]), key(f.end, [0.06, r(PRODUCT_Y - size / 2 + 0.05), depth(-0.07)])],
        rotation: [key(inPoint, [0, 0, -10]), key(f.end, [0, 0, 16])],
      },
    };
  }

  const seed = 11 + (hash(i + 1) % 997);
  const glass = a.procedural === 'glass-cube';
  const source: Obj = glass
    ? { type: 'primitive', shape: 'box', proportions: { width: 1, height: 1 }, round: MATERIALS.iceRound }
    : elementSource(a);
  const look: Obj = glass
    ? { material: { ...MATERIALS.ice } }
    : { textures: { ...(a.frames[0] ? { front: a.frames[0].id } : {}), side: a.side ?? '#3b2416' }, material: { roughness: 0.45, clearcoat: 0.3 } };
  const count = act === 'fall' ? 40 : act === 'burst' ? 30 : glass ? 6 : 14;
  const swarm: Obj =
    act === 'fall'
      ? { count, seed, motion: 'fall', emitter: { shape: 'box', center: [0, 0.45, 0.1], size: [0.5, 0.05, 0.4] }, direction: [0, -1, 0], speed: 0.1, gravity: 3, spin: 300, stagger: r2(sec * 0.8), sizeJitter: 0.2 }
      : act === 'burst'
        ? { count, seed, motion: 'burst', emitter: { shape: 'point', center: [0, PRODUCT_Y, 0] }, direction: [0, 1, CAMERA.burstToward], spread: CAMERA.burstSpread, speed: 0.9, drag: 2.2, gravity: 2, spin: 240, stagger: 0.1, sizeJitter: 0.2 }
        : act === 'orbit'
          ? { count, seed, motion: 'orbit', emitter: { shape: 'point', center: [0, PRODUCT_Y, 0] }, orbit: { radius: 0.13, angularSpeed: 40, height: 0.12, bob: 0.01 }, spin: 60, growFrames: 6, sizeJitter: 0.25 }
          : { count, seed, motion: 'drift', emitter: { shape: 'sphere', center: [0, PRODUCT_Y, 0], radius: 0.25 }, drift: {}, spin: 40, sizeJitter: 0.3 };
  return { beat: i, instances: count, layer: { ...base, source, size: glass ? Math.min(size, CAMERA.glassMax) : size, ...look, swarm } };
}

/**
 * The air of the set. Dust is a swarm of tiny specks drifting round the product; spray a burst of droplets in the peak shot (or the third shot);
 * bokeh is a few soft lights, single cards that drift slowly near the lens and out of focus. Swarms count toward the instance budget; cards
 * (a swarm cannot be a card) count toward the prop limit.
 */
function airProps(set: NonNullable<CinematicInput['set']>, sheet: BeatSheet, cam: CameraPlan, frames: number): { planned: Planned[]; cards: Obj[] } {
  const base = { kind: 'prop3d', stage: `${ID}:world`, inPoint: 0, outPoint: frames };
  const speck = { source: { type: 'primitive', shape: 'box', proportions: { width: 1, height: 1 } }, material: { color: '#fff6e4', roughness: 1 }, castShadow: false };
  const drop = { source: { type: 'primitive', shape: 'box', proportions: { width: 1, height: 1 }, round: MATERIALS.dropRound }, material: { ...MATERIALS.drop }, castShadow: false };
  if (set.air === 'dust') {
    const layer: Obj = { ...base, id: `${ID}:air-dust`, name: 'dust', ...speck, size: 0.0035, swarm: { count: 80, seed: 41, motion: 'drift', emitter: { shape: 'sphere', center: [0, PRODUCT_Y, 0.05], radius: 0.38 }, drift: {}, spin: 0, sizeJitter: 0.55 } };
    return { planned: [{ beat: -1, layer, instances: 80 }], cards: [] };
  }
  if (set.air === 'spray') {
    const peak = sheet.beats.findIndex((b) => b.phase === 'peak');
    const at = peak >= 0 ? peak : Math.min(2, cam.beats.length - 1);
    const f = cam.beats[at]!;
    const layer: Obj = {
      ...base, id: `${ID}:air-spray`, name: 'spray', ...drop, size: 0.004, inPoint: f.start, outPoint: Math.min(f.end + 12, frames),
      swarm: { count: 70, seed: 77, motion: 'burst', emitter: { shape: 'point', center: [0, 0.01, 0.1] }, direction: [0, 1, 0.25], spread: 55, speed: 0.75, drag: 1.5, gravity: 2.2, spin: 0, stagger: r2(Math.min(0.3, (f.end - f.start) / 30 / 3)), sizeJitter: 0.5 },
    };
    return { planned: [{ beat: at, layer, instances: 70 }], cards: [] };
  }
  if (set.air === 'smoke') {
    // two slow plumes behind the product from the first frame to the last; the engine fades each in and out of its own length
    const plume = (n: number, x: number, z: number, size: number, seed: number): Planned => ({
      beat: -1,
      instances: 0,
      layer: { ...base, id: `${ID}:air-smoke${n}`, name: 'smoke', source: { type: 'smoke', form: 'steam', seed }, size, position: [x, 0, z], material: { color: '#b9aea3', opacity: 1 }, castShadow: false },
    });
    return { planned: [plume(0, -0.05, -0.13, 0.42, 21), plume(1, 0.06, -0.18, 0.5, 58)], cards: [] };
  }
  if (set.air === 'bokeh' && set.dot) {
    // x, y, z at the start and the end, size, opacity: round the edges of the frame, in front of and behind the product
    const lights: Array<[V3, V3, number, number]> = [
      [[-0.14, 0.2, 0.3], [-0.1, 0.26, 0.3], 0.09, 0.5],
      [[0.15, 0.06, 0.34], [0.11, 0.12, 0.34], 0.12, 0.42],
      [[0.09, 0.27, -0.3], [0.13, 0.22, -0.3], 0.07, 0.55],
      [[-0.17, 0.04, -0.45], [-0.13, 0.08, -0.45], 0.11, 0.45],
    ];
    const cards = lights.map(([a, b, size, opacity], n): Obj => ({
      ...base, id: `${ID}:air-bokeh${n}`, name: 'bokeh', source: { type: 'card' }, textures: { front: set.dot!.id }, size, material: { opacity },
      position: [key(0, a), key(frames, b)],
    }));
    return { planned: [], cards };
  }
  return { planned: [], cards: [] };
}

/** Trims the swarms until the world holds at most LIMITS.instances copies: each swarm keeps its share, never below 4. */
function fitInstances(planned: Planned[]): Planned[] {
  const total = planned.reduce((s, p) => s + p.instances, 0);
  const budget = LIMITS.instances - 1;
  if (total <= budget) return planned;
  const k = budget / total;
  return planned.map((p) => {
    if (!p.layer.swarm) return p;
    const n = Math.max(4, Math.min(LIMITS.swarm, Math.floor(p.layer.swarm.count * k)));
    return { ...p, instances: n, layer: { ...p.layer, swarm: { ...p.layer.swarm, count: n } } };
  });
}

/** Keys strictly increasing in time: sorted, and where two share a frame the later one wins. */
function uniq<T>(ks: Array<Key<T>>): Array<Key<T>> {
  const out: Array<Key<T>> = [];
  for (const k of [...ks].sort((a, b) => a.t - b.t)) {
    if (out.at(-1)?.t === k.t) out.pop();
    out.push(k);
  }
  return out;
}

/** The light as Muse directs it, shot by shot: keys for the key light's direction and height and the key and rim strengths, only for what a shot names. */
export interface LightPlan {
  azimuth?: Array<Key<number>>;
  elevation?: Array<Key<number>>;
  key?: Array<Key<number>>;
  rim?: Array<Key<number>>;
}
export function lightKeys(sheet: BeatSheet, cam: CameraPlan, base: { azimuth: number; elevation: number; key: number; rim: number }): LightPlan | undefined {
  const plan: LightPlan = {};
  const track = (name: keyof LightPlan, pick: (b: Beat) => [number | undefined, number | undefined], start: number, scale = 1): void => {
    const ks: Array<Key<number>> = [];
    let last = start;
    cam.beats.forEach((f, n) => {
      const [a, b] = pick(sheet.beats[n]!);
      if (a === undefined && b === undefined) return;
      const v0 = (a ?? last) * scale;
      const v1 = (b ?? a ?? last) * scale;
      if (v0 === v1) ks.push(key(f.start, r2(v0), undefined, true));
      else ks.push(key(f.start, r2(v0), EASE_IN_OUT), key(f.end, r2(v1), EASE_IN_OUT));
      last = b ?? a ?? last;
    });
    if (!ks.length) return;
    // before the first shot that names it, the light is what the film began with
    if (ks[0]!.t > 0) ks.unshift(key(0, r2(start * scale), undefined, true));
    plan[name] = uniq(ks);
  };
  track('azimuth', (b) => [b.light?.from, b.light?.to ?? b.light?.from], base.azimuth);
  track('elevation', (b) => [b.light?.elevation, b.light?.elevation], base.elevation);
  track('key', (b) => [b.light?.key, b.light?.key], 1, base.key);
  track('rim', (b) => [b.light?.rim, b.light?.rim], 1, base.rim);
  return Object.keys(plan).length ? plan : undefined;
}

/** How far a flat cut-out swings to either side on a turn: it shows only its front, so it rocks from one side to the other inside 30 degrees. */
const FLAT_SWING = 25;

/** Degrees between the product's front and the lens, from -180 to 180: its yaw less the camera's azimuth (the lens sits at x = sin az, z = cos az). */
export function faceOffset(yawDeg: number, cameraPos: V3): number {
  const az = (Math.atan2(cameraPos[0], cameraPos[2]) * 180) / Math.PI;
  return ((((yawDeg - az + 180) % 360) + 360) % 360) - 180;
}

/**
 * The product's turn and rise, from the shots' product field. Safety only: the film ends on the price, so the product must end with its front
 * to the lens. When Muse's turns would leave its back or side showing (more than CAMERA.endFaceMax degrees off), its last turn is lengthened or
 * shortened just enough; with no turn after the last label macro to adjust, the last shot turns it round. Muse's spins otherwise play as written.
 */
function productMoves(sheet: BeatSheet, cam: CameraPlan, land: number, frames: number, flat = false, rampKeys: number = CAMERA.rampKeys): { yaw: Array<Key<V3>>; rise: Array<Key<V3>> } {
  const first = layProductMoves(sheet, cam, land, frames, flat, rampKeys);
  const end = cam.position.at(-1)?.v;
  if (!end) return first;
  const off = faceOffset(first.at, end);
  const max = CAMERA.endFaceMax;
  if (Math.abs(off) <= max) return first;
  const delta = r(Math.sign(off) * max - off);
  return layProductMoves(sheet, cam, land, frames, flat, rampKeys, first.lastTurn !== undefined ? { beat: first.lastTurn, delta } : { beat: cam.beats.length - 1, delta, add: true });
}

/** Lays out the turn and rise: a drop-in rises from above spinning, a turn swings it 45 degrees through the shot, still holds the yaw it has, a spin turns it as Muse wrote, and the label macro faces the lens (yaw 0) at its middle. */
function layProductMoves(
  sheet: BeatSheet,
  cam: CameraPlan,
  land: number,
  frames: number,
  flat: boolean,
  rampKeys: number,
  /** an extra turn on one shot, so the product ends facing the lens: `add` turns it in a shot that had no turn of its own */
  fix?: { beat: number; delta: number; add?: boolean },
): { yaw: Array<Key<V3>>; rise: Array<Key<V3>>; at: number; lastTurn?: number } {
  let at = -28;
  /** the last shot that turns the product, unless a label macro (which faces it front) comes after */
  let lastTurn: number | undefined;
  const yaw: Array<Key<V3>> = [key(0, [4, at, 0])];
  const rise: Array<Key<V3>> = [key(0, [0, 0, 0])];
  cam.beats.forEach((f, n) => {
    const beat = sheet.beats[n]!;
    const pm = beat.product ?? 'still';
    const sp = beat.spin;
    const extra = fix && fix.beat === n ? fix.delta : 0;
    if (fix?.add && fix.beat === n) {
      // a shot with no turn of its own turns the product round to face the lens, smoothly over the shot
      yaw.push(key(f.start, [4, at, 0], EASE_OF.smooth));
      at += extra;
      yaw.push(key(f.end, [4, at, 0], EASE_OF.smooth));
      return;
    }
    const spun = !!sp && pm !== 'drop' && [sp.degrees, sp.tilt, sp.roll, sp.lift].some((v) => v !== undefined && v !== 0);
    if (spun && sp) {
      // Muse wrote the product's motion out: a turn of `degrees` over the shot, and a lean, a roll and a toss that peak at its middle
      const e = EASE_OF[sp.ease ?? 'smooth'];
      const from = at;
      const turn = (sp.degrees ?? 0) + extra;
      if (turn !== 0) lastTurn = n;
      at = from + turn;
      const mid = Math.round((f.start + f.end) / 2);
      const hasMid = (sp.tilt || sp.roll || sp.lift) && mid > f.start + 1 && mid < f.end - 1;
      if (beat.ramp && rampKeys >= 2 && f.end - f.start >= 4 * (rampKeys + 1)) {
        // a speed ramp bends the shot's time, so the turn is sampled along it: every key is the turn's value at the progress the ramp has reached
        const n = rampKeys + 1;
        for (let k = 0; k <= n; k++) {
          const w = rampProgress(beat.ramp, k / n);
          const t = k === 0 ? f.start : k === n ? f.end : Math.round(f.start + (k / n) * (f.end - f.start));
          // the lean, roll and toss peak where the shot's motion is half done
          const bump = 1 - Math.abs(2 * w - 1);
          yaw.push(key(t, [r(4 + (sp.tilt ?? 0) * bump), r(from + turn * bezierAt(e, w)), r((sp.roll ?? 0) * bump)], LINEAR));
          if (sp.lift) rise.push(key(t, [0, r(sp.lift * PRODUCT_H * Math.sin(Math.PI * w)), 0], LINEAR));
        }
        return;
      }
      yaw.push(key(f.start, [4, from, 0], e));
      if (hasMid) {
        // the middle key rides the eased curve (its value at half the time) and is linear through, so the turn keeps its shape
        yaw.push(key(mid, [r(4 + (sp.tilt ?? 0)), r(from + turn * bezierAt(e, 0.5)), r(sp.roll ?? 0)], LINEAR));
        if (sp.lift) rise.push(key(f.start, [0, 0, 0], EASE_OUT), key(mid, [0, r(sp.lift * PRODUCT_H), 0], LINEAR), key(f.end, [0, 0, 0], EASE_IN_OUT));
      }
      yaw.push(key(f.end, [4, at, 0], e));
      return;
    }
    if (pm === 'drop') {
      const dur = Math.max(3, Math.min(land, f.end - f.start));
      if (f.start > 0) rise.push(key(f.start - 1, [0, 0, 0], undefined, true));
      rise.push(key(f.start, [0, CAMERA.dropFrom, 0], EASE_OUT), key(f.start + dur, [0, 0, 0]));
      yaw.push(key(f.start, [4, at - 220, -24], EASE_OUT), key(f.start + dur, [4, at, 0], EASE_IN_OUT));
    } else if (pm === 'turn') {
      // the turn runs on through the cut into the next shot, like the camera
      yaw.push(key(f.start, [4, at, 0], EASE_THROUGH));
      // a round pack turns on; a flat one swings across to the other side, so every turn moves it
      at = (flat ? (at > 0 ? -FLAT_SWING : FLAT_SWING) : at + 45) + extra;
      lastTurn = n;
      yaw.push(key(f.end, [4, at, 0], EASE_THROUGH));
    } else {
      yaw.push(key(f.start, [4, at, 0]));
    }
    if (f.size === 'macro') {
      at = 0;
      lastTurn = undefined;
      yaw.push(key(Math.round((f.start + f.end) / 2), [4, 0, 0], EASE_IN_OUT));
    }
  });
  yaw.push(key(frames, [4, at, 0]));
  return { yaw: uniq(yaw), rise: uniq(rise), at, ...(lastTurn !== undefined ? { lastTurn } : {}) };
}

/**
 * The cuts the board names: a wipe is a quick dip to the dark field across the cut, a cloud a bloom of the key light that fills the frame
 * and clears. One full-frame layer each, above the world and under the copy; the first shot has nothing to cut from.
 */
function cutLayers(c: Comp, sheet: BeatSheet, cam: CameraPlan, fps: number, [W, H]: [number, number], dark: string, light: string): Comp {
  let out = c;
  const D = totalSeconds(sheet);
  for (const [kind, color, peak, lead, tail] of [['wipe', dark, 1, 0.08, 0.12], ['cloud', light, 0.85, 0.05, 0.22], ['flash', tint(light, 0.8), 1, 0.05, 0.14]] as const) {
    const ks: Array<[number, number]> = [[0, 0]];
    cam.beats.forEach((f, n) => {
      if (n === 0 || sheet.beats[n]!.cut !== kind) return;
      const t0 = f.start / fps;
      ks.push([r(Math.max(0, t0 - lead)), 0], [r(t0), peak], [r(Math.min(D, t0 + tail)), 0]);
    });
    if (ks.length < 3) continue;
    // z counts depth: the world is 5 and the copy under 1, so 4 lies over the world and under the copy
    const layer = shape(out, { x: 0, y: 0, w: W, h: H }, color, 4);
    out = setKeyframes(layer.c, layer.id, 'opacity', dedupe(ks), 'easeOut');
  }
  return out;
}

/**
 * Black bars to a wide ratio, over the world and under the copy. The picture is W / ratio high, so each bar is half of what is left; in a tall frame that
 * would eat the product, so a bar stops at LETTERBOX_MAX of the height. The bars lift when the end hold starts, so the name, tagline and price have the whole frame.
 */
export const LETTERBOX_MAX = 0.3;
export function letterbox(c: Comp, ratio: number, [W, H]: [number, number], holdStart: number, D: number): Comp {
  const bar = Math.min(H * LETTERBOX_MAX, Math.max(0, (H - W / ratio) / 2));
  if (bar < 2) return c;
  let out = c;
  for (const y of [0, H - bar]) {
    const layer = shape(out, { x: 0, y, w: W, h: bar }, '#000000', 3);
    out = setKeyframes(layer.c, layer.id, 'opacity', dedupe([[0, 1], [r2(Math.max(0.05, holdStart)), 1], [r2(Math.min(D, holdStart + 0.3)), 0]]), 'easeOut');
  }
  return out;
}

/**
 * Where the label macro's camera goes, metres from the product's centre: over the label's spot (`focus`, [u, v] on the front picture), but never so
 * far that the frame leaves the product (the macro's frame is a crop of PRODUCT_H / FILL.macro high). Zero on an axis the frame already covers.
 */
export function macroOffset(focus: [number, number], widthM: number, heightM: number, frameRatio: number, yawDeg = 0): [number, number] {
  const frameH = PRODUCT_H / FILL.macro;
  // a product turned by yaw shows its width foreshortened: the label's sideways spot and the room to move on it shrink with the cosine
  const across = Math.cos(rad(yawDeg));
  widthM *= across;
  const clamp = (v: number, size: number, frame: number) => {
    const room = Math.max(0, (size - frame) / 2);
    return Math.max(-room, Math.min(room, v));
  };
  return [r(clamp((focus[0] - 0.5) * widthM, widthM, frameH * frameRatio)), r(clamp((0.5 - focus[1]) * heightM, heightM, frameH))];
}

/** The film. Throws when the sheet has no beats. */
export function buildCinematicFilm(i: CinematicInput): Comp {
  if (!i.sheet.beats.length) throw new Error('a cinematic film needs at least one beat');
  const { width: W, height: H } = ASPECT_SIZES[i.aspect];
  const u = Math.min(W, H);
  const portrait = H > W;
  const D = totalSeconds(i.sheet);
  const flat = i.shape === 'other';
  if (flat && (!i.contour || i.contour.length < 3)) throw new Error("a flat product needs a contour of at least 3 points");
  const aspect = Math.max(0.3, i.productAspect);
  // A flat product is sized by its longest side: a tall one is PRODUCT_H high, a wide one at most 0.9 PRODUCT_H wide, so it stays in a portrait frame.
  const fitSize = flat && aspect < 1 ? Math.min(PRODUCT_H / aspect, PRODUCT_H * 0.9) : PRODUCT_H;
  /** The product's height as a share of PRODUCT_H, and the lift that keeps its centre where the camera looks. */
  const hFrac = flat ? Math.min(1, fitSize * aspect / PRODUCT_H) : 1;
  const lift = r((PRODUCT_H * (1 - hFrac)) / 2);
  const sizes = effectiveSizes(i.sheet);
  let c = newFilmComposition({ aspect: i.aspect, title: `${i.brand ?? i.title}: cinematic`, palette: [i.accent] });
  const fps = c.fps as number;
  c = addScene(c, { id: ID, durationSec: D, mode: 'motion', intent: `Cinematic 3D film: ${i.sheet.beats.map((b) => `${b.size} ${b.move}`).join(', ')}` });
  const frames = sceneMeta(c, ID).durationFrames;
  // the most of the frame's height a flat, wide product may fill before its width passes 90 % of the frame's
  const widthM = aspect >= 1 ? PRODUCT_H / aspect : fitSize;
  const maxFill = flat ? (CAMERA.maxWidthShare * PRODUCT_H * (W / H)) / widthM : Infinity;
  // the end hold's product leaves room above it for the name and tagline: its height is capped, whatever the shot sizes say
  const holdFill = (CAMERA.maxHoldHeight / 1.16) / hFrac;
  let cam = planCamera(i.sheet, fps, { maxFill, holdFill, ...(i.set ? { highEl: CAMERA.highAngleSet } : {}) });
  const fillIn = (size: ShotSize): number => (size === 'macro' ? FILL.macro : Math.min(FILL[size], maxFill));
  const holdBeat = cam.beats.at(-1)!;
  const holdStart = holdBeat.start / fps;
  const macro = cam.beats.find((b) => b.size === 'macro');
  // the board's light: key colour, and how dark or bright the world is
  const keyLevel = i.key ?? 'mid';
  const keyColor = i.tone === 'warm' ? '#ffd7a3' : i.tone === 'cool' ? '#bcd6ff' : tint(i.accent, 0.7);
  const fieldColor = keyLevel === 'high' ? tint(i.accent, 0.9) : shade(i.tone && i.tone !== 'neutral' ? keyColor : i.accent, keyLevel === 'low' ? 0.93 : 0.85);
  const haloGain = keyLevel === 'low' ? 0.6 : 1;
  const setLight = LIGHT[keyLevel];
  // a set has real light on a real floor, so it needs less exposure than the dark field a halo is drawn on
  const exposure = i.set ? r2((keyLevel === 'low' ? 0.9 : keyLevel === 'high' ? 1.05 : 1) * LIGHT.exposure) : keyLevel === 'low' ? 0.95 : keyLevel === 'high' ? 1.3 : 1.1;

  // the 2D world under the 3D one: a near-black field and a warm halo behind the product that follows its size from shot to shot
  c = shape(c, { x: 0, y: 0, w: W, h: H }, fieldColor, 12).c;
  const pcx = W / 2;
  const pcy = H * 0.5;
  const hd = H * 0.46;
  if (!i.set) {
    const halo = shape(c, { x: pcx - hd / 2, y: pcy - hd / 2, w: hd, h: hd }, i.tone && i.tone !== 'neutral' ? shade(keyColor, 0.45) : tint(i.accent, 0.3), 11, { kind: 'ellipse', size: [hd, hd] }, (l) => {
      l.effects = [{ name: 'gaussian-blur', params: { blurriness: r2(hd * 0.1) } }];
    });
    c = halo.c;
    const haloScale: Array<[number, number]> = [];
    const haloOp: Array<[number, number]> = [[0, 0]];
    cam.beats.forEach((b, n) => {
      const s = (fillIn(b.size) / FILL.medium) * (b.move === 'dolly-zoom' ? 1.35 : 1);
      const t0 = b.start / fps;
      // a shot's last frame is one frame before the next shot's first, so the halo cuts with the camera
      const t1 = n === cam.beats.length - 1 ? D : b.end / fps;
      haloScale.push([r(t0), r2(Math.max(0.6, Math.min(2.6, fillIn(b.size) / FILL.medium)))], [r(t1), r2(Math.max(0.6, Math.min(2.6, s)))]);
      haloOp.push([r(Math.max(t0, 0.3)), r2((b.size === 'macro' ? 0.45 : 0.85) * haloGain)]);
    });
    c = setKeyframes(c, halo.id, 'scale', dedupe(haloScale), 'easeInOut');
    c = setKeyframes(c, halo.id, 'opacity', dedupe(haloOp), 'easeOut');
  }

  // assets: the product's textures and every picture an ingredient plays
  c = registerAsset(c, { id: i.texture.id, kind: 'image', src: i.texture.src, width: i.texture.width, height: i.texture.height });
  const used = new Set<string>([i.texture.id]);
  if (i.set) {
    c = registerAsset(c, { id: i.set.backdrop.id, kind: 'image', src: i.set.backdrop.src, width: i.set.backdrop.width, height: i.set.backdrop.height });
    used.add(i.set.backdrop.id);
    if (i.set.dot && i.set.air === 'bokeh') {
      c = registerAsset(c, { id: i.set.dot.id, kind: 'image', src: i.set.dot.src, width: i.set.dot.width, height: i.set.dot.height });
      used.add(i.set.dot.id);
    }
  }
  const planned: Planned[] = [];
  i.sheet.beats.forEach((b, n) => {
    const a = b.ingredient ? i.ingredients?.[b.ingredient.kind] : undefined;
    const p = ingredientProp(n, b, cam.beats[n]!, a);
    if (p && a) {
      planned.push(p);
      for (const f of a.frames) {
        if (!used.has(f.id)) {
          c = registerAsset(c, { id: f.id, kind: 'image', src: f.src, width: f.width, height: f.height });
          used.add(f.id);
        }
      }
    }
  });
  const air = i.set ? airProps(i.set, i.sheet, cam, frames) : { planned: [], cards: [] };
  planned.push(...air.planned);
  const props = fitInstances(planned).slice(0, LIMITS.props - 1 - air.cards.length);
  for (const id of used) c = share(c, id);

  // the product: lands from above in the first shot, then turns slowly; during the macro the label faces the camera
  const land = Math.round(0.8 * fps);
  const turnEnd = Math.max(land + 6, Math.round((cam.beats.find((b) => b.move === 'dolly-zoom')?.start ?? holdBeat.start) ));
  // the light Muse directs shot by shot (the film's own sweep when it names none)
  const gain = lightBudget(i.spots, i.side);
  const lp = lightKeys(i.sheet, cam, { azimuth: -70, elevation: 55, key: r2((i.set ? setLight.key : 3.2) * gain.key), rim: r2((i.set ? setLight.rim : 0.6) * gain.rim) });
  const lightTweens = lp ? Object.values(lp).reduce((sum, ks) => sum + Math.max(0, ks.length - 1), 0) : 0;
  // ramped shots are sampled along their curve, as densely as the tween budget allows
  const rampShots = i.sheet.beats.filter((b) => b.ramp).length;
  const spinRamps = i.sheet.beats.filter((b) => b.ramp && b.spin).length;
  const rampKeys = rampKeysFor(rampShots, spinRamps, cam.beats.length * 4 + lightTweens + 8 + 5);
  let yaw: Array<Key<V3>> = [key(0, [4, -250, -24], EASE_OUT), key(land, [4, -28, 0], EASE_IN_OUT)];
  if (macro && macro.start > land + 3) yaw.push(key(Math.round((macro.start + macro.end) / 2), [4, 0, 0], EASE_IN_OUT));
  // the default turn ends at 16 degrees; when the lens has orbited away it turns on until the front meets the lens (safety, as in productMoves)
  const camEnd = cam.position.at(-1)?.v;
  const endOff = camEnd ? faceOffset(16, camEnd) : 0;
  const settle = Math.abs(endOff) > CAMERA.endFaceMax ? r(Math.sign(endOff) * CAMERA.endFaceMax - endOff) : 0;
  yaw.push(key(Math.max(turnEnd, (yaw.at(-1)?.t ?? 0) + 3), [4, 22 + settle, 0], EASE_IN_OUT), key(frames, [4, 16 + settle, 0]));
  let rise: Array<Key<V3>> = [key(0, [0, CAMERA.dropFrom, 0], EASE_OUT), key(land, [0, 0, 0])];
  if (i.sheet.beats.some((b) => b.product)) ({ yaw, rise } = productMoves(i.sheet, cam, land, frames, flat, rampKeys));
  // the label macro looks at the label: the camera and its target both move over the label's spot for that shot, and go back for the next
  let target: V3 | Array<Key<V3>> = [0, PRODUCT_Y, 0];
  let macroShift: { beat: BeatFrames; x: number; y: number } | undefined;
  const macroBeat = cam.beats.find((b) => b.size === 'macro');
  if (flat && i.focus && macroBeat) {
    const widthMeters = aspect < 1 ? fitSize : fitSize / aspect;
    const heightMeters = aspect < 1 ? fitSize * aspect : fitSize;
    // the product's turn at the middle of the macro (the keys are not clamped yet, and the product is held to the flat swing)
    const mid = (macroBeat.start + macroBeat.end) / 2;
    const after = yaw.findIndex((k) => k.t >= mid);
    const yawAt = after < 0 ? (yaw.at(-1)?.v[1] ?? 0) : after === 0 ? yaw[0]!.v[1] : yaw[after - 1]!.v[1] + ((yaw[after]!.v[1] - yaw[after - 1]!.v[1]) * (mid - yaw[after - 1]!.t)) / Math.max(1, yaw[after]!.t - yaw[after - 1]!.t);
    const [ox, oy] = macroOffset(i.focus, widthMeters, heightMeters, W / H, Math.max(-CAMERA.flatSwingMax, Math.min(CAMERA.flatSwingMax, yawAt)));
    if (ox !== 0 || oy !== 0) {
      macroShift = { beat: macroBeat, x: ox, y: oy };
      const aim = [0, PRODUCT_Y, 0] as V3;
      const over = [ox, r(PRODUCT_Y + oy), 0] as V3;
      target = uniq([
        key(0, aim, undefined, true),
        ...(macroBeat.start > 0 ? [key(macroBeat.start - 1, aim, undefined, true)] : []),
        key(macroBeat.start, over, undefined, true),
        key(macroBeat.end, over, undefined, true),
        key(macroBeat.end + 1, aim),
      ]);
    }
  }
  // the hand-held tremor: a plain true is the usual sway, an object sets its amount, keys a shot and seed; an amount of 0 is a locked camera
  const hand: Handheld = typeof i.handheld === 'object' ? i.handheld : {};
  const handheld = i.handheld === true || (typeof i.handheld === 'object' && (hand.amount ?? 1) > 0);
  if (handheld || cam.beats.some((b) => b.ramp || b.via?.length)) {
    // what the camera leaves for itself: the product's turn and rise, the camera's aim, the light's keys, the samples of the ramped and curved shots, and a few more
    const curvedKeys = cam.beats.reduce((sum, b) => sum + 2 * pathKeysOf(b), 0);
    const others = yaw.length + rise.length + (typeof target[0] === 'object' ? target.length : 0) + 8 + lightTweens + rampKeys * rampShots + curvedKeys;
    cam = shakeCamera(cam, handheld ? shakeKeysPerShot(cam.beats.length, others, hand.keys ?? CAMERA.shakeKeysMax) : 0, rampKeys, hand);
  }
  if (macroShift) {
    // the tremor's own keys inside the macro move with it, so the shake rides on the aimed path
    const { beat, x, y } = macroShift;
    cam = { ...cam, position: cam.position.map((k) => (k.t >= beat.start && k.t <= beat.end ? { ...k, v: [r(k.v[0] + x), r(k.v[1] + y), k.v[2]] as V3 } : k)) };
  }
  if (flat) {
    // the cut-out is a solid body with a back and sides, so it turns as far as Muse asks
    rise = rise.map((k) => ({ ...k, v: [k.v[0], r(k.v[1] + lift), k.v[2]] as V3 }));
  }
  const can: Obj = {
    id: `${ID}:product`,
    name: 'Product',
    kind: 'prop3d',
    role: 'product',
    stage: `${ID}:world`,
    inPoint: 0,
    outPoint: frames,
    source: flat
      ? { type: 'extrude', contour: i.contour, depth: r2(Math.min(i.texture.width, i.texture.height) * (i.body?.depth ?? SOLID.depth)), section: i.body?.section ?? SOLID.section, ...(i.body?.axis === 'across' ? { axis: 'across' as const } : {}) }
      : { type: 'primitive', shape: i.shape, proportions: { width: 1, height: r2(aspect) } },
    textures: flat ? { front: i.texture.id, side: i.set ? tint(i.side, LIGHT.sideLift) : i.side } : { label: i.texture.id, side: i.side },
    size: r(fitSize),
    material: { ...SURFACES[i.surface ?? 'satin'], ...wetLook(i.finish ?? defaultFinish(keyLevel)) },
    position: rise,
    rotation: yaw,
  };

  const world: Obj = {
    id: `${ID}:world`,
    name: 'World',
    kind: 'stage3d',
    inPoint: 0,
    outPoint: frames,
    transform: { position: [W / 2, H / 2], anchor: [W / 2, H / 2], scale: [1, 1], rotation: 0, opacity: 1 },
    viewport: { width: W, height: H },
    camera: { position: cam.position, target, fov: cam.fov, focus: { distance: cam.focus, aperture: apertureKeys(cam, i.aperture ?? APERTURE), ...(i.bokeh ? { bokeh: r2(i.bokeh) } : {}) } },
    set: i.set ? { ground: i.set.ground, groundSize: [...CAMERA.groundSize], wall: { distance: WALL.distance, height: WALL.height }, backdrop: i.set.backdrop.id, ...floorShine(i.finish ?? defaultFinish(keyLevel)), ...floorLight(i.finish ?? defaultFinish(keyLevel)) } : { ground: 'none', wall: false },
    style: { shading: 'pbr', exposure },
    post: ((post, blur) => (post || blur ? { ...post, ...(blur ? { motionBlur: blur } : {}) } : undefined))(finishPost(i.finish ?? defaultFinish(keyLevel), cam.beats.at(-1)!.start, i.grade, gain.bloom), motionBlur(i.sheet, cam, i.blur)),
    ...(shaderCuts(i.sheet, cam, fps).length ? { shotTransitions: shaderCuts(i.sheet, cam, fps) } : {}),
    ...(speedRamps(cam).length ? { timeWarp: speedRamps(cam) } : {}),
    shadow: { opacity: i.set ? LIGHT.shadow : 0.45, softness: 0.7 },
    lights: {
      preset: 'studio',
      ...(i.reflect ? { environment: i.reflect } : {}),
      ...(i.spots?.length ? { spots: spotLights(i.spots, gain.spot) } : {}),
      key: { azimuth: lp?.azimuth ?? [key(0, -70, EASE_IN_OUT), key(land, -70, EASE_IN_OUT), key(Math.max(turnEnd, land + 6), 45, LINEAR), key(frames, 45)], elevation: lp?.elevation ?? 55, color: i.light?.key ?? keyColor, ...(lp?.key ? { intensity: lp.key } : i.set ? { intensity: r2(setLight.key * gain.key) } : {}) },
      ...(i.set ? { fill: { intensity: setLight.fill }, ambient: setLight.ambient } : {}),
      rim: { ...(i.light?.rim ? { color: i.light.rim } : {}), intensity: lp?.rim ?? [key(0, r2((i.set ? setLight.rim : 0.6) * gain.rim), EASE_IN_OUT), key(Math.max(turnEnd, land + 6), r2((i.set ? setLight.rim : 0.6) * gain.rim), EASE_IN_OUT), key(frames, r2((i.set ? setLight.rimEnd : 1.4) * gain.rim))] },
    },
  };
  c = insertStage(c, world, [can, ...props.map((p) => p.layer), ...air.cards]);
  c = cutLayers(c, i.sheet, cam, fps, [W, H], fieldColor, keyColor);
  if (i.grade?.letterbox) c = letterbox(c, i.grade.letterbox, [W, H], holdStart, D);
  c = structuredClone(c);
  c.version = SCHEMA as never;
  ((c.precomps as Record<string, Obj>)[ID] as Obj).version = SCHEMA;

  // the words: glossy 3D type in its own world over the product's (titles3d.ts), styled by Muse's end card
  c = addTitles(c, { i, W, H, u, portrait, fps, frames, keyLevel, holdStart, macro, beats: cam.beats, pcx, pcy, fill: Math.min(fillIn(sizes.at(-1) ?? 'medium'), holdFill), hFrac, aspect });
  if (i.music) {
    c = registerAsset(c, { id: i.music.id, kind: 'audio', src: i.music.src });
    c = structuredClone(c);
    (c.layers as Obj[]).unshift({
      kind: 'audio', id: `${ID}:music`, name: 'music', inPoint: 0, outPoint: c.durationInFrames, assetId: i.music.id, level: i.music.level ?? 0.7,
      transform: { position: [0, 0], anchor: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
    });
  }
  return c;
}

interface TitleSetting {
  i: CinematicInput;
  W: number;
  H: number;
  u: number;
  portrait: boolean;
  fps: number;
  frames: number;
  keyLevel: KeyLevel;
  /** seconds */
  holdStart: number;
  macro?: { start: number; end: number };
  beats: CameraPlan['beats'];
  pcx: number;
  pcy: number;
  /** the product's fill of the frame in the end hold, its height share and its aspect */
  fill: number;
  hFrac: number;
  aspect: number;
}

/**
 * Every word of the film as glossy 3D type (titles3d.ts): the brand over the first shots, a shot's own line in the lower third (never in the
 * macro or the last shot), and in the end hold the name, the tagline and the price on a coin or tag, each where the flat words used to sit.
 * Muse styles them with the end card; the type is dark on a bright world and white on a dark one, measured on the backdrop behind the words.
 */
function addTitles(c: Comp, s: TitleSetting): Comp {
  const { i, W, H, u, portrait, fps, frames } = s;
  const ec = i.endCard ?? {};
  const accent = ec.accent ?? i.accent;
  const face = ec.face ?? 'sans';
  const finish = ec.letters ?? 'gloss';
  const enter = ec.entrance ?? 'rise';
  const heavy = ec.weight !== 'light';
  const leftAlign = ec.align === 'left';
  const margin = W * 0.08;
  const bright = i.set?.skyLuma !== undefined ? i.set.skyLuma > BRIGHT_SKY : s.keyLevel === 'high';
  const ink = bright ? shade(accent, 0.8) : '#ffffff';
  const darkPlate = !bright;
  const { ppu, at } = titleSpace(W, H);
  const stage = `${ID}:titles`;
  const members: Obj[] = [];
  const fonts = new Set<string>();
  const holdF = Math.round(s.holdStart * fps);
  const F = (sec: number) => Math.round(sec * fps);
  let n = 0;
  const nextId = (what: string) => `${ID}:title-${what}-${++n}`;
  // the letters' depth and the gap to a plate behind them, in world units
  const depthOf = (px: number) => (px / ppu) * TITLE_DEPTH.depth;
  const behind = (px: number, plateDepthPx: number) => -(depthOf(px) / 2 + 0.03 + plateDepthPx / ppu / 2);
  /** The words, wrapped to `maxW` pixels; returns their box in pixels. */
  const say = (o: { text: string; heavy?: boolean; px: number; cx: number; cy: number; maxW: number; ink: string; inAt: number; goneBy?: number; z?: number; drift?: boolean; swing?: number[]; left?: number }): { w: number; h: number; cx: number; cy: number; px: number; outAt?: number } | undefined => {
    const cut = o.heavy ?? heavy;
    const font = titleFont(face, cut);
    const raw = drawable(ec.text === 'upper' ? o.text.toUpperCase() : o.text, font.file);
    if (!raw) return undefined;
    // a line shrinks (to 72 % at most) to stay on one row before it wraps; a wrapped block keeps clear of the frame's top and bottom
    const one = lineWidth(raw, font.file, 1);
    const px = Math.round(Math.max(o.px * 0.72, Math.min(o.px, o.maxW / Math.max(one, 0.01))));
    const text = wrapTitle(raw, font.file, px, o.maxW).join('\n');
    const box = wordsBox(text, face, cut, px);
    // never past the frame's sides: a block too near an edge is moved in
    const side = W * 0.045;
    const cx = Math.min(W - side - box.w / 2, Math.max(side + box.w / 2, o.left !== undefined ? o.left + box.w / 2 : o.cx));
    const edge = H * 0.045 + px * 0.3;
    const cy = Math.min(H - edge - box.h / 2, Math.max(edge + box.h / 2, o.cy));
    fonts.add(font.id);
    // a line that must be gone by a frame (a cut, the macro, the end hold) starts to leave in time for its last letter to fade
    const outAt = o.goneBy !== undefined ? titleLeaveAt(text, o.inAt, o.goneBy, fps) : undefined;
    const [x, y] = at(cx, cy);
    members.push({
      ...wordsProp(stage, { id: nextId('words'), text, face, heavy: cut, px, cx, cy, align: o.left !== undefined ? 'left' : 'center', ink: o.ink, finish, enter, inAt: o.inAt, ...(outAt !== undefined ? { outAt } : {}), end: frames, ...(o.drift ? { drift: true } : {}), ...(o.swing ? { swing: o.swing } : {}) }, ppu, fps, at),
      position: [x, y, Math.round((o.z ?? 0) * 1000) / 1000],
    });
    return { ...box, cx, cy, px, ...(outAt !== undefined ? { outAt } : {}) };
  };
  /** A glassy pill or bar behind a span of words. */
  const plateUnder = (cx: number, cy: number, w: number, h: number, px: number, inAt: number, outAt?: number) => {
    if (ec.plate === 'none') return;
    const bar = ec.plate === 'bar';
    const pw = bar ? W * 1.04 : w + h * 0.9;
    const depthPx = h * 0.16;
    members.push(slabProp(stage, { id: nextId('plate'), outline: roundedRect(pw, h, bar ? h * 0.08 : h / 2), w: pw, h, depthPx, cx: bar ? W / 2 : cx, cy, z: behind(px, depthPx), material: plateMaterial(darkPlate), inAt, ...(outAt !== undefined ? { outAt } : {}), end: frames, grow: 'across' }, ppu, fps, at));
  };

  // the end hold's layout: the product's height and top, and the name clear above it (the brand clear above the name)
  const ph = H * s.fill * 1.16 * s.hFrac;
  const pw = Math.min(ph / s.aspect, W * 0.9);
  const canTop = H * 0.5 - ph / 2;
  const top = H * (portrait ? 0.13 : 0.1);
  const name = i.brand && i.title.startsWith(i.brand) ? i.title.slice(i.brand.length).trim() || i.title : i.title;
  const nameSize = Math.round(u * 0.085);
  const tag = i.tagline?.trim();
  const nameCy = Math.max(tag ? H * 0.045 + u * 0.1 : H * 0.07 + u * 0.11, Math.min(top + u * 0.11 - (tag ? u * 0.03 : 0), canTop - nameSize * 0.9 - (tag ? u * 0.05 : 0)));
  const blockCx = portrait ? W / 2 : W * 0.4;
  const left = leftAlign ? margin : undefined;

  // the brand over the first shots: gone before the macro, and gone at the end hold when a tagline takes its place
  if (i.brand) {
    const brandPx = Math.round(u * 0.036);
    const brandCy = nameCy - u * 0.11;
    const brandInk = bright ? shade(accent, 0.5) : tint(accent, 0.6);
    const until = s.macro ? s.macro.start : tag ? holdF : undefined;
    say({ text: i.brand.toUpperCase(), px: brandPx, cx: blockCx, cy: brandCy, maxW: W * 0.8, ink: brandInk, inAt: F(0.3), ...(until !== undefined ? { goneBy: Math.max(F(1.2), until) } : {}), ...(left !== undefined ? { left } : {}) });
    if (s.macro && !tag) say({ text: i.brand.toUpperCase(), px: brandPx, cx: blockCx, cy: brandCy, maxW: W * 0.8, ink: brandInk, inAt: holdF, ...(left !== undefined ? { left } : {}) });
  }

  // the shots' own words: a hook line, a feeling, in the lower third, gone before the cut
  const textCy = H * (portrait ? 0.8 : 0.84);
  i.sheet.beats.forEach((b, k) => {
    const f = s.beats[k]!;
    if (!b.text || k === s.beats.length - 1 || f.size === 'macro') return;
    const px = Math.round(u * 0.075);
    const inAt = f.start + F(0.06);
    // the line is gone at the cut; on a short shot it leaves faster, so it is whole on screen for most of the shot
    const box = say({ text: b.text, px, cx: W / 2, cy: textCy, maxW: W * 0.84, ink, inAt, goneBy: f.end + 1, drift: true });
    if (box) plateUnder(W / 2, box.cy, box.w, box.h + box.px * 0.6, box.px, inAt, box.outAt);
  });

  // the end hold: the name, a beat later the tagline, on one plate
  const nameBox = say({ text: name, px: nameSize, cx: blockCx, cy: nameCy, maxW: W * 0.84, ink, inAt: holdF + F(0.1), drift: true, ...(left !== undefined ? { left } : {}) });
  const placedCy = nameBox?.cy ?? nameCy;
  let spanW = nameBox?.w ?? 0;
  let spanTop = placedCy - (nameBox?.h ?? nameSize) / 2;
  let spanBottom = placedCy + (nameBox?.h ?? nameSize) / 2;
  if (tag) {
    const tagPx = Math.round(u * 0.038);
    const tagCy = placedCy + (nameBox?.h ?? nameSize) / 2 + u * 0.055;
    const tagBox = say({ text: tag, heavy: false, px: tagPx, cx: blockCx, cy: tagCy, maxW: W * 0.8, ink: bright ? shade(accent, 0.55) : tint(accent, 0.75), inAt: holdF + F(0.45), ...(left !== undefined ? { left } : {}) });
    if (tagBox) {
      spanW = Math.max(spanW, tagBox.w);
      spanBottom = tagCy + tagBox.h / 2;
    }
  }
  spanTop -= (nameBox?.px ?? nameSize) * 0.35;
  spanBottom += (nameBox?.px ?? nameSize) * 0.35;
  if (nameBox) plateUnder(left !== undefined ? left + spanW / 2 : blockCx, (spanTop + spanBottom) / 2, spanW, spanBottom - spanTop, nameBox.px, holdF + F(0.1));

  // the price beside the product when there is room for it, else under it; never over it (no price when the brief names none)
  if (i.price !== undefined) {
    const priceText = formatPrice(i.price, i.currency);
    const gap = u * 0.03;
    const room = W - W * 0.03 - (s.pcx + pw / 2 + gap);
    const dd = Math.min(u * 0.27, Math.max(room / 1.06, 0));
    const beside = portrait ? dd >= u * 0.19 : true;
    const ddUse = beside ? (portrait ? dd : u * 0.27) : u * 0.24;
    const dcx = !portrait ? W * 0.75 : beside ? s.pcx + pw / 2 + gap + ddUse / 2 : s.pcx;
    const dcy = !portrait ? s.pcy : beside ? s.pcy + ph * 0.18 : Math.min(H - ddUse * 0.62, s.pcy + ph / 2 + gap + ddUse * 0.55);
    const kind = ec.price ?? 'disc';
    const beat = 60 / (i.bpm ?? 120);
    const swing: number[] = [];
    // the coin spins in over 0.6 s, then swings on every other beat until the film ends
    if (ec.pulse !== false) for (let t = s.holdStart + 0.9; t + 0.3 <= frames / fps; t += 2 * beat) swing.push(F(t));
    const tagW = ddUse * 1.5;
    const tagH = ddUse * 0.58;
    const slabW = kind === 'disc' ? ddUse : tagW;
    const slabH = kind === 'disc' ? ddUse : tagH;
    const slabDepth = slabH * 0.16;
    if (kind !== 'plain') {
      const outline = kind === 'disc' ? roundedRect(ddUse, ddUse, ddUse / 2, 16) : roundedRect(tagW, tagH, tagH * 0.28);
      members.push(slabProp(stage, { id: nextId('price-slab'), outline, w: slabW, h: slabH, depthPx: slabDepth, cx: dcx, cy: dcy, z: 0, material: { color: accent, metalness: 0.35, roughness: 0.16, clearcoat: 1 }, inAt: holdF, end: frames, grow: 'spin', swing }, ppu, fps, at));
    }
    const was = i.wasPrice !== undefined && i.wasPrice > i.price ? formatPrice(i.wasPrice, i.currency) : undefined;
    const font = titleFont(face, true).file;
    const fitPx = (t: string, share: number) => Math.round(Math.min(slabH * 0.34, (slabW * share) / Math.max(0.1, lineWidth(drawable(t, font), font, 1))));
    const pricePx = kind === 'plain' ? Math.round(u * 0.09) : fitPx(priceText, 0.74);
    const onPrice = kind === 'plain' ? ink : inkOn(accent);
    const front = kind === 'plain' ? 0 : slabDepth / ppu / 2 + depthOf(pricePx) / 2 + 0.02 + (slabDepth / ppu) * 0.3; // clear of the face while the slab swells and swings
    // plain big type gets the room beside the product (it is moved in from the edge if it still does not fit)
    const priceRoom = kind === 'plain' ? Math.max(u * 0.2, 2 * Math.min(dcx - W * 0.045, W - W * 0.045 - dcx)) : W;
    say({ text: priceText, heavy: true, px: pricePx, cx: dcx, cy: dcy + (was ? pricePx * 0.3 : 0), maxW: priceRoom, ink: onPrice, inAt: holdF + F(0.25), z: front, swing });
    if (was) {
      const wasPx = Math.round(pricePx * 0.5);
      const wy = dcy - pricePx * 0.55;
      const wasBox = say({ text: was, heavy: false, px: wasPx, cx: dcx, cy: wy, maxW: W, ink: onPrice, inAt: holdF + F(0.3), z: front, swing });
      if (wasBox) {
        const lw = wasBox.w * 1.08;
        const lh = Math.max(4, wasPx * 0.12);
        members.push(slabProp(stage, { id: nextId('strike'), outline: roundedRect(lw, lh, lh / 2), w: lw, h: lh, depthPx: lh, cx: dcx, cy: wy, z: front + depthOf(wasPx) / 2 + 0.02, material: { color: '#ff5a6e', metalness: 0, roughness: 0.2, clearcoat: 1 }, inAt: holdF + F(0.5), end: frames, grow: 'across' }, ppu, fps, at));
      }
    }
  }

  // a world holds TITLE_PROPS_MAX props: the shots' plates give way first, then the old price's strike
  while (members.length > TITLE_PROPS_MAX) {
    const drop = members.findIndex((m) => String(m.id).includes('-plate-')) >= 0 ? members.findIndex((m) => String(m.id).includes('-plate-')) : members.length - 1;
    members.splice(drop, 1);
  }
  if (!members.length) return c;
  for (const id of fonts) {
    const src = `/fonts/${id.replace(/^font-/, '')}.typeface.json`;
    c = share(registerAsset(c, { id, kind: 'font', src }), id);
  }
  const out = structuredClone(c);
  const layers = layersOf(out);
  const meta = readDirector(out);
  // over everything else in the scene, the letterbox included
  const world = titlesWorld(stage, W, H, frames);
  layers.push(world, ...members);
  meta.layers[world.id] = { sceneId: ID, role: 'stage3d', z: 0.1 };
  for (const m of members) meta.layers[m.id] = { sceneId: ID, role: 'prop3d', z: 0.1 };
  return writeDirector(out, meta);
}

/** The product's condensation for a finish's wet: nothing for `none`, else the book's amount. */
export function wetLook(f: Finish): { condensation?: number } {
  return f.wet === 'none' ? {} : { condensation: FINISH.wet[f.wet] };
}

/** The set's reflection for a finish's floor: nothing for a matte-less `none`, else the book's strength and fade. */
export function floorShine(f: Finish): { reflection?: Obj } {
  if (f.floor === 'none') return {};
  const { strength, fade } = FINISH.floor[f.floor];
  return { reflection: { strength, fade } };
}

/** The set's rippling floor light for a finish's caustics: nothing for `none`, else the book's brightness, fade and ripple size. */
export function floorLight(f: Finish): { caustics?: Obj } {
  if (!f.caustics || f.caustics === 'none') return {};
  return { caustics: { strength: FINISH.caustics[f.caustics], fade: FINISH.caustics.fade, scale: FINISH.caustics.scale } };
}

/**
 * How much of the rig the product can take. Spots add to the key, so the key and rim give up a share for each unit of spot strength; a pale
 * product (a white tub) also takes less key, rim and spot, and its glow starts higher, or its lid and rim burn to flat white.
 */
export function lightBudget(spots: CinematicInput['spots'], side: string | undefined): { key: number; rim: number; spot: number; bloom?: number } {
  const strength = (spots ?? []).slice(0, SPOT.max).reduce((sum, s) => sum + (s.strength ?? 1), 0);
  const share = Math.max(SPOT.floor, 1 - SPOT.share * strength);
  const pale = side !== undefined && /^#[0-9a-f]{3,6}$/i.test(side) && luma(side) > LIGHT.pale.luma;
  return {
    key: r2(share * (pale ? LIGHT.pale.key : 1)),
    rim: r2(share * (pale ? LIGHT.pale.rim : 1)),
    spot: pale ? LIGHT.pale.spot : 1,
    ...(pale ? { bloom: LIGHT.pale.bloom } : {}),
  };
}

/** The world's spot lights for a board's spots: each stands on its side of the product at the book's distance, aimed at the product's middle; `gain` scales their power. */
export function spotLights(spots: NonNullable<CinematicInput['spots']>, gain = 1): Obj[] {
  return spots.slice(0, SPOT.max).map((s, n) => {
    const [x, y, z] = SPOT.sides[s.side];
    return {
      id: `spot${n + 1}`,
      position: [r2(x * SPOT.distance), r2(PRODUCT_Y + y), r2(z * SPOT.distance)],
      target: [0, r2(PRODUCT_Y), 0],
      intensity: r2((s.strength ?? 1) * SPOT.power * gain),
      angle: Math.round(s.cone ?? SPOT.cone.default),
      penumbra: r2(s.soft ?? SPOT.soft),
      ...(s.color ? { color: s.color } : {}),
    };
  });
}

/** The params a shader cut carries: the book's own, with the shot's `dir` turned into the shader's direction vector for the cuts that travel. */
export function cutParams(cut: string, own: Record<string, number> | undefined, dir: 'left' | 'right' | 'up' | 'down' | undefined): { params?: Obj } {
  const v = dir ? { left: [-1, 0], right: [1, 0], up: [0, 1], down: [0, -1] }[dir] : undefined;
  if (v && (cut === 'whip' || cut === 'lenswhip' || cut === 'leak')) return { params: { ...own, direction: v } };
  return own ? { params: own } : {};
}

/** The world's shader transitions: a cut that names one (zoom, ripple, swirl...) plays it from the first frame of its shot, for as long as the book says or the shot allows. */
export function shaderCuts(sheet: BeatSheet, cam: CameraPlan, fps: number): Obj[] {
  const out: Obj[] = [];
  sheet.beats.forEach((b, n) => {
    const def = n > 0 && b.cut && b.cut !== 'hard' && b.cut !== 'wipe' && b.cut !== 'cloud' && b.cut !== 'flash' && b.cut !== 'pass' && b.cut !== 'match' ? CUT_SHADERS[b.cut] : undefined;
    if (!def) return;
    const f = cam.beats[n]!;
    out.push({ startFrame: f.start, durationFrames: Math.max(2, Math.min(Math.round(def.seconds * fps), Math.round((f.end - f.start) * 0.8))), name: def.shader, ...cutParams(b.cut!, 'params' in def ? def.params : undefined, b.dir) });
  });
  return out.slice(0, CUT_SHADERS.max);
}

/** The lens aperture over the film: the film's own, or a step to a shot's own where its focus names one (a shot's aperture holds until the next shot's first frame). */
export function apertureKeys(cam: CameraPlan, base: number): number | Array<Key<number>> {
  if (!cam.beats.some((f) => f.aperture !== undefined)) return r2(base);
  return uniq(cam.beats.flatMap((f) => [key(f.start, r2(f.aperture ?? base), undefined, true), key(f.end, r2(f.aperture ?? base), undefined, true)]));
}

/** The world's speed ramps: the stretch of frames each ramped shot covers, and its curve, so the world's own motion (a splash, steam, falling pieces) follows the camera. */
export function speedRamps(cam: CameraPlan): Obj[] {
  return cam.beats.flatMap((f) => (f.ramp ? [{ startFrame: f.start, durationFrames: Math.max(1, f.end - f.start + 1), rates: f.ramp.map((p) => ({ at: r2(p.at), rate: r2(p.rate) })) }] : [])).slice(0, 8);
}

/** The world's `post` for a finish: levels to numbers, and the glow swelling when the end hold starts (at `holdFrame`); the glow starts no lower than `minThreshold`. Undefined when nothing is on. */
export function finishPost(f: Finish, holdFrame: number, grade?: Grade, minThreshold = 0): Obj | undefined {
  const post: Obj = {};
  if (f.glow !== 'none') {
    const g = FINISH.glow[f.glow];
    post.bloom = { intensity: [key(0, g.intensity), key(Math.max(1, holdFrame), g.intensity), key(holdFrame + 14, r2(g.intensity * FINISH.holdSwell), EASE_OUT)], threshold: Math.max(g.threshold, minThreshold), radius: 0.7 };
  }
  if (f.vignette !== 'none') post.vignette = { darkness: FINISH.vignette[f.vignette] };
  if (f.grain !== 'none') post.grain = { opacity: FINISH.grain[f.grain] };
  if (f.fringe) post.aberration = { offset: FINISH.fringe };
  if (grade) {
    const tone: Obj = {};
    if (grade.exposure) tone.brightness = r2(grade.exposure);
    if (grade.contrast) tone.contrast = r2(grade.contrast);
    if (grade.saturation) tone.saturation = r2(grade.saturation);
    if (grade.hue) tone.hue = r2(grade.hue);
    if (Object.keys(tone).length) post.grade = tone;
    // split toning needs a tint on at least one side; the other falls back to the cold-shadow, warm-highlight pair
    if (grade.shadows || grade.highlights) post.splitTone = { shadows: grade.shadows ?? '#1d4a6b', highlights: grade.highlights ?? '#ffb877', amount: r2(grade.split ?? 0.5), ...(grade.balance ? { balance: r2(grade.balance) } : {}) };
    if (grade.streak) post.streak = { strength: r2(grade.streak.strength ?? 0.5), ...(grade.streak.color ? { color: grade.streak.color } : {}), ...(grade.streak.reach !== undefined ? { reach: r2(grade.streak.reach) } : {}) };
    if (grade.halation) post.halation = r2(grade.halation);
  }
  return Object.keys(post).length ? post : undefined;
}

/**
 * The world's motion blur: for each shot, the share of a frame the shutter stays open (the shot's own `blur`, else the film's, else none).
 * An exact export draws a blurred frame several times across that time and averages them; a wider shutter gets more pictures to stay smooth.
 */
export function motionBlur(sheet: BeatSheet, cam: CameraPlan, film: number | undefined): Obj | undefined {
  const shots: Array<{ startFrame: number; durationFrames: number; shutter: number }> = [];
  cam.beats.forEach((f, n) => {
    const shutter = r2(sheet.beats[n]!.blur ?? film ?? 0);
    if (shutter > 0.02) shots.push({ startFrame: f.start, durationFrames: Math.max(1, f.end - f.start + 1), shutter });
  });
  if (!shots.length) return undefined;
  const widest = Math.max(...shots.map((s) => s.shutter));
  return { samples: Math.min(10, Math.max(4, Math.round(4 + widest * 8))), shots };
}

/** Keyframe pairs at least `gap` seconds apart (the director refuses two keys on one frame): a key too close to the one before is dropped, the first wins. */
function dedupe(ks: Array<[number, number]>, gap = 0.04): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const k of ks) {
    const prev = out.at(-1);
    if (prev && k[0] - prev[0] < gap) continue;
    out.push(k);
  }
  return out;
}
