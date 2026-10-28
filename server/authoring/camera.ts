import { CAMERA_FACTORS, EASE_HANDLES, depthWeight } from './constants';
import { isAnimated, type Kf, type Vec2 } from './keyframes';
import { readDirector, sceneMeta, writeDirector } from './meta';
import type { CameraMove, Comp, Obj } from './types';

const AFFECTED = new Set(['bg', 'product', 'subject', 'clip']);
const EPS = 1e-6;
const firstOf = <T>(f: T | Kf<T>[]): T => (isAnimated(f) ? (f as Kf<T>[])[0]!.v : (f as T));
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Two keys at 0 and D with easeInOut on the first, or a static value when start and end are the same. */
function keyed<T extends number | Vec2>(from: T, to: T, D: number): T | Kf<T>[] {
  const same = Array.isArray(from) ? (from as number[]).every((v, i) => Math.abs(v - (to as number[])[i]!) <= EPS) : Math.abs((from as number) - (to as number)) <= EPS;
  if (same) return from;
  return [{ t: 0, v: from, easeOut: [...EASE_HANDLES.easeInOut!] as Kf<T>['easeOut'] }, { t: D, v: to }];
}

/**
 * 2D parallax camera (design 5.6): per-layer keyframes by depth. HUD layers (headline, caption) are never touched.
 * The layer's base {x, y, scale} is captured once and reused, so calling this again never compounds. Idempotent.
 */
export function setCamera(c: Comp, sceneId: string, move: CameraMove, strength = 0.5): Comp {
  const sm = sceneMeta(c, sceneId);
  const s = clamp01(strength);
  const a = 2 * s;
  const D = sm.durationFrames;
  const W = c.width;
  const centre: Vec2 = [c.width / 2, c.height / 2];
  const out = structuredClone(c);
  const meta = readDirector(out);
  const layers = (out.precomps as Record<string, Obj>)[sceneId]!.layers as Obj[];

  for (const layer of layers) {
    const lm = meta.layers[layer.id];
    if (!lm || !AFFECTED.has(lm.role)) continue;
    const pos = firstOf<Vec2>(layer.transform.position);
    const scl = firstOf<Vec2>(layer.transform.scale);
    const base = (lm.base ??= { x: pos[0], y: pos[1], scale: scl[0] });
    const w = depthWeight(lm.z ?? 0);

    let position: Vec2 | Kf<Vec2>[] = [base.x, base.y];
    const scale = base.scale;
    let scaleTo = base.scale;
    let rotation: number | Kf<number>[] = 0;
    let to: Vec2 = [base.x, base.y];
    let from: Vec2 = [base.x, base.y];

    if (move === 'dolly-in') {
      const g = CAMERA_FACTORS.dollyGrowth * a * w;
      scaleTo = base.scale * (1 + g);
      to = [base.x + (base.x - centre[0]) * g, base.y + (base.y - centre[1]) * g];
    } else if (move === 'pan' || move === 'parallax') {
      const P = (move === 'pan' ? CAMERA_FACTORS.panTravel : CAMERA_FACTORS.parallaxPan) * W * a * w;
      from = [base.x + P / 2, base.y];
      to = [base.x - P / 2, base.y];
      if (move === 'parallax') scaleTo = base.scale * (1 + CAMERA_FACTORS.parallaxGrowth * a * w);
    } else if (move === 'orbit') {
      const P = CAMERA_FACTORS.orbitPan * W * a * w;
      const Q = P / 2;
      from = [base.x + P / 2, base.y - Q / 2];
      to = [base.x - P / 2, base.y + Q / 2];
      const r = CAMERA_FACTORS.orbitRotationDeg * a * w;
      rotation = keyed(-r, r, D);
    }

    position = keyed(from, to, D);
    const sc = keyed<number>(scale, scaleTo, D);
    layer.transform.position = position;
    layer.transform.scale = isAnimated(sc) ? (sc as Kf<number>[]).map((k) => ({ ...k, v: [k.v, k.v] as Vec2 })) : [sc as number, sc as number];
    layer.transform.rotation = rotation;
  }

  meta.scenes[sceneId]!.camera = { move, strength: s };
  return writeDirector(out, meta);
}

/** Re-runs the scene's stored camera (after an edit changed its layers or length); a scene without a camera is returned unchanged. */
export function applyCameraIfSet(c: Comp, sceneId: string): Comp {
  const cam = readDirector(c).scenes[sceneId]?.camera;
  return cam ? setCamera(c, sceneId, cam.move, cam.strength) : c;
}
