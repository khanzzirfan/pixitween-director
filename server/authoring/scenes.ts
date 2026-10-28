import { MAX_FILM_SECONDS, MAX_SCENES } from './constants';
import { applyCameraIfSet } from './camera';
import { AuthoringError, hintList } from './errors';
import { readDirector, sceneIds, sceneMeta, writeDirector } from './meta';
import type { Comp, Obj } from './types';
import { secToFrames } from './units';
import { AEP_VERSION } from './constants';

const SCENE_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const precomps = (c: Comp): Record<string, Obj> => (c.precomps ?? {}) as Record<string, Obj>;

/** Recompute, in root-layer order, every start frame, the precomp and root-layer windows, the director meta and the root duration. */
export function sequenceScenes(c: Comp): Comp {
  const out = structuredClone(c);
  const meta = readDirector(out);
  let start = 0;
  for (const layer of out.layers as Obj[]) {
    if (layer.kind !== 'precomp') continue;
    const frames = precomps(out)[layer.id]!.durationInFrames as number;
    layer.inPoint = start;
    layer.outPoint = start + frames;
    if (meta.scenes[layer.id]) {
      meta.scenes[layer.id]!.startFrame = start;
      meta.scenes[layer.id]!.durationFrames = frames;
    }
    start += frames;
  }
  out.durationInFrames = Math.max(1, start);
  return writeDirector(out, meta);
}

const totalFrames = (c: Comp) => Object.values(precomps(c)).reduce((n, p) => n + (p.durationInFrames as number), 0);

export function addScene(c: Comp, s: { id: string; durationSec: number; mode: 'motion' | 'generate'; intent?: string }): Comp {
  if (!SCENE_ID.test(s.id)) throw new AuthoringError('bad_value', `scene id '${s.id}' must match ${SCENE_ID.source} (lowercase, no colon)`);
  if (precomps(c)[s.id] || sceneIds(c).includes(s.id)) throw new AuthoringError('duplicate_scene', `scene '${s.id}' already exists`, hintList(sceneIds(c)));
  if (sceneIds(c).length >= MAX_SCENES) throw new AuthoringError('scene_limit', `a film has at most ${MAX_SCENES} scenes`);
  if (!Number.isFinite(s.durationSec) || s.durationSec < 1 || s.durationSec > 30) throw new AuthoringError('bad_duration', `durationSec ${s.durationSec} must be between 1 and 30 seconds`);
  const frames = secToFrames(s.durationSec, c.fps);
  if ((totalFrames(c) + frames) / c.fps > MAX_FILM_SECONDS) throw new AuthoringError('film_too_long', `a film is at most ${MAX_FILM_SECONDS} s long`);

  const out = structuredClone(c);
  out.precomps = {
    ...precomps(out),
    [s.id]: { version: AEP_VERSION, id: s.id, name: s.id, width: out.width, height: out.height, fps: out.fps, durationInFrames: frames, assets: {}, layers: [] },
  } as never;
  out.layers.push({
    kind: 'precomp', id: s.id, name: s.id, inPoint: 0, outPoint: 0, compId: s.id, width: out.width, height: out.height,
    transform: { position: [0, 0], anchor: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
  } as never);
  const meta = readDirector(out);
  meta.scenes[s.id] = { precompId: s.id, startFrame: 0, durationFrames: frames, mode: s.mode, ...(s.intent ? { intent: s.intent } : {}) };
  return sequenceScenes(writeDirector(out, meta));
}

const clampKeys = (field: unknown, last: number): unknown => {
  if (!Array.isArray(field) || !field.length || typeof field[0] !== 'object' || Array.isArray(field[0])) return field;
  const out: Obj[] = [];
  for (const k of field as Obj[]) {
    const kk = { ...k, t: Math.min(k.t, last) };
    if (out.length && out[out.length - 1]!.t === kk.t) out[out.length - 1] = kk; // dedupe by frame, keep the last
    else out.push(kk);
  }
  return out;
};

export function setSceneDuration(c: Comp, sceneId: string, sec: number): Comp {
  sceneMeta(c, sceneId);
  if (!Number.isFinite(sec) || sec < 1 || sec > 30) throw new AuthoringError('bad_duration', `durationSec ${sec} must be between 1 and 30 seconds`);
  const frames = secToFrames(sec, c.fps);
  const out = structuredClone(c);
  const p = precomps(out)[sceneId]!;
  const total = totalFrames(out) - p.durationInFrames + frames;
  if (total / c.fps > MAX_FILM_SECONDS) throw new AuthoringError('film_too_long', `a film is at most ${MAX_FILM_SECONDS} s long`);
  const old = p.durationInFrames as number;
  p.durationInFrames = frames;
  for (const l of p.layers as Obj[]) {
    if (l.outPoint === old) l.outPoint = frames;
    for (const f of ['position', 'anchor', 'scale', 'rotation', 'opacity']) if (l.transform?.[f] !== undefined) l.transform[f] = clampKeys(l.transform[f], frames);
  }
  return applyCameraIfSet(sequenceScenes(out), sceneId);
}

export function swapScenes(c: Comp, a: string, b: string): Comp {
  sceneMeta(c, a);
  sceneMeta(c, b);
  const out = structuredClone(c);
  const ia = out.layers.findIndex((l) => l.id === a);
  const ib = out.layers.findIndex((l) => l.id === b);
  [out.layers[ia], out.layers[ib]] = [out.layers[ib]!, out.layers[ia]!];
  return sequenceScenes(out);
}

export function removeScene(c: Comp, sceneId: string): Comp {
  sceneMeta(c, sceneId);
  const out = structuredClone(c);
  delete precomps(out)[sceneId];
  out.layers = out.layers.filter((l) => l.id !== sceneId);
  const meta = readDirector(out);
  delete meta.scenes[sceneId];
  for (const [id, lm] of Object.entries(meta.layers)) if (lm.sceneId === sceneId) delete meta.layers[id];
  return sequenceScenes(writeDirector(out, meta));
}
