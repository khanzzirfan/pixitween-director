import { replaceAxisWithStatic, mergePositionAxis } from './axis';
import { HUD_ROLES } from './constants';
import { applyCameraIfSet } from './camera';
import { AuthoringError } from './errors';
import { buildKeys, isAnimated, type Kf, type Vec2 } from './keyframes';
import { layerMeta, readDirector, writeDirector } from './meta';
import type { Comp, Ease, Obj, Prop } from './types';

const locate = (c: Comp, layerId: string) => {
  const lm = layerMeta(c, layerId);
  const out = structuredClone(c);
  const p = (out.precomps as Record<string, Obj>)[lm.sceneId]!;
  const layer = (p.layers as Obj[]).find((l) => l.id === layerId);
  if (!layer) throw new AuthoringError('unknown_layer', `no layer '${layerId}'`);
  return { out, layer, lm, sceneFrames: p.durationInFrames as number };
};

const firstValue = <T>(f: T | Kf<T>[]): T => (isAnimated(f) ? (f as Kf<T>[])[0]!.v : (f as T));

/** Re-capture the camera base from the layer's current static values (camera-affected layers only). */
function refreshBase(out: Comp, layer: Obj, layerId: string, lm: { sceneId: string; role: string }): Comp {
  const meta = readDirector(out);
  if (!meta.scenes[lm.sceneId]?.camera || (HUD_ROLES as readonly string[]).includes(lm.role)) return out;
  const pos = firstValue<Vec2>(layer.transform.position);
  const scale = firstValue<Vec2>(layer.transform.scale);
  meta.layers[layerId]!.base = { x: pos[0], y: pos[1], scale: scale[0] };
  return writeDirector(out, meta);
}

export function setTransform(c: Comp, layerId: string, p: Partial<Record<Prop, number>>): Comp {
  const entries = Object.entries(p).filter(([, v]) => v !== undefined) as Array<[Prop, number]>;
  if (!entries.length) throw new AuthoringError('bad_value', 'nothing to set: pass at least one of x, y, scale, rotation, opacity');
  for (const [k, v] of entries) {
    if (!Number.isFinite(v)) throw new AuthoringError('bad_value', `${k} must be a finite number`);
    if (k === 'opacity' && (v < 0 || v > 1)) throw new AuthoringError('bad_value', `opacity ${v} must be within 0..1`);
    if (k === 'scale' && v < 0) throw new AuthoringError('bad_value', `scale ${v} must be >= 0`);
  }
  const { out, layer, lm } = locate(c, layerId);
  const t = layer.transform;
  if (p.x !== undefined || p.y !== undefined) {
    let pos = firstValue<Vec2>(t.position);
    if (p.x !== undefined) pos = replaceAxisWithStatic(pos, 'x', p.x) as Vec2;
    if (p.y !== undefined) pos = replaceAxisWithStatic(pos, 'y', p.y) as Vec2;
    t.position = pos;
  }
  if (p.scale !== undefined) t.scale = [p.scale, p.scale];
  if (p.rotation !== undefined) t.rotation = p.rotation;
  if (p.opacity !== undefined) t.opacity = p.opacity;
  return applyCameraIfSet(refreshBase(out, layer, layerId, lm), lm.sceneId);
}

export function setKeyframes(c: Comp, layerId: string, prop: Prop, keys: Array<[number, number]>, ease: Ease = 'easeInOut'): Comp {
  const { out, layer, sceneFrames } = locate(c, layerId);
  const fps = c.fps;
  const range = prop === 'opacity' ? { min: 0, max: 1 } : prop === 'scale' ? { min: 0 } : {};
  const kf = buildKeys(keys, ease, fps, sceneFrames, range);
  if (kf.length === 1) return setTransform(c, layerId, { [prop]: kf[0]!.v });
  const t = layer.transform;
  if (prop === 'x' || prop === 'y') t.position = mergePositionAxis(t.position, prop, kf, fps);
  else if (prop === 'scale') t.scale = kf.map((k) => ({ ...k, v: [k.v, k.v] }));
  else t[prop] = kf;
  return out;
}
