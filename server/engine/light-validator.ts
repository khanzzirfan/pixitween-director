// Engine-independent subset of the engine's `aepCompositionSchema` (composition.ts refinements 1-5
// plus the shape checks an agent can get wrong). Browser-safe: no node: imports.
import { parseModel3D } from '../product3d/types';

export interface CompositionIssue {
  path: string;
  message: string;
}
export type ValidationResult = { ok: true; data: unknown } | { ok: false; issues: CompositionIssue[] };

const KINDS = ['image', 'video', 'audio', 'gif', 'lottie', 'svg', 'text', 'shape', 'null', 'precomp', 'camera', 'light', 'model3d', 'stage3d', 'actor3d', 'prop3d'];
/** The engine rejects a model3d layer in a composition declaring an older schema. */
const MODEL3D_MIN_VERSION = [1, 4, 0] as const;
/** stage3d and its actor3d / prop3d members arrived with schema 1.11.0 (engine aep-31). */
const STAGE3D_MIN_VERSION = [1, 11, 0] as const;
const STAGE_LIMITS = { actor3d: 3, prop3d: 6 } as const;
const versionAtLeast = (v: string, min: readonly number[]): boolean => {
  const p = v.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((p[i] ?? 0) !== min[i]) return (p[i] ?? 0) > min[i]!;
  return true;
};
const ASSET_KINDS = ['image', 'video', 'audio', 'gif', 'lottie', 'svg'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const positive = (v: unknown): v is number => finite(v) && v > 0;

function checkAnimatable(v: unknown, path: string, issues: CompositionIssue[], check: (x: unknown, p: string) => void) {
  if (Array.isArray(v) && v.length > 0 && isObj(v[0])) {
    v.forEach((k, i) => {
      if (!isObj(k) || !finite(k.t)) issues.push({ path: `${path}[${i}].t`, message: 'keyframe needs a finite t (frames)' });
      else if (!('v' in k)) issues.push({ path: `${path}[${i}].v`, message: 'keyframe needs a value v' });
      else check(k.v, `${path}[${i}].v`);
    });
  } else if (Array.isArray(v) && v.length === 0) {
    issues.push({ path, message: 'keyframe array must not be empty' });
  } else {
    check(v, path);
  }
}

function checkTransform(t: unknown, path: string, issues: CompositionIssue[]) {
  if (!isObj(t)) return issues.push({ path, message: 'transform is required' });
  const vec2 = (x: unknown, p: string) => {
    if (!Array.isArray(x) || x.length !== 2 || !x.every(finite)) issues.push({ path: p, message: 'expected [x, y] numbers' });
  };
  const num = (x: unknown, p: string) => {
    if (!finite(x)) issues.push({ path: p, message: 'expected a finite number' });
  };
  const opacity = (x: unknown, p: string) => {
    if (!finite(x) || x < 0 || x > 1) issues.push({ path: p, message: 'opacity must be within [0, 1]' });
  };
  for (const [key, check] of [['position', vec2], ['anchor', vec2], ['scale', vec2], ['rotation', num], ['opacity', opacity]] as const) {
    if (!(key in t)) issues.push({ path: `${path}.${key}`, message: `transform.${key} is required` });
    else checkAnimatable(t[key], `${path}.${key}`, issues, check);
  }
}

function validateComp(c: unknown, path: string, issues: CompositionIssue[]): void {
  if (!isObj(c)) return void issues.push({ path: path || '$', message: 'composition must be an object' });
  const at = (k: string) => (path ? `${path}.${k}` : k);

  const version = c.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) issues.push({ path: at('version'), message: "version must be a semver string like '1.9.0'" });
  else if (version.split('.')[0] !== '1') issues.push({ path: at('version'), message: 'unsupported schema version: major must be 1' });
  if (typeof c.id !== 'string' || !c.id) issues.push({ path: at('id'), message: 'id must be a non-empty string' });
  for (const k of ['width', 'height', 'fps', 'durationInFrames']) {
    if (!positive(c[k])) issues.push({ path: at(k), message: `${k} must be a positive number (size, fps and duration)` });
  }
  if (!Array.isArray(c.layers)) issues.push({ path: at('layers'), message: 'layers must be an array' });
  if (!isObj(c.assets)) issues.push({ path: at('assets'), message: 'assets must be an object' });
  if (!Array.isArray(c.layers) || !isObj(c.assets)) return;

  const assets = c.assets;
  const precomps = isObj(c.precomps) ? c.precomps : {};
  const layers = c.layers as unknown[];
  const ids = new Set<string>();
  const byId = new Map<string, Obj>();

  layers.forEach((l, i) => {
    const lp = at(`layers[${i}]`);
    if (!isObj(l)) return void issues.push({ path: lp, message: 'layer must be an object' });
    if (typeof l.id !== 'string' || !l.id) issues.push({ path: `${lp}.id`, message: 'layer id must be a non-empty string' });
    else if (ids.has(l.id)) issues.push({ path: `${lp}.id`, message: `duplicate layer id '${l.id}': layer ids must be unique` });
    else {
      ids.add(l.id);
      byId.set(l.id, l);
    }
    if (typeof l.kind !== 'string' || !KINDS.includes(l.kind)) return void issues.push({ path: `${lp}.kind`, message: `unknown layer kind '${String(l.kind)}'` });
    if (!finite(l.inPoint) || !finite(l.outPoint)) issues.push({ path: lp, message: 'inPoint and outPoint must be finite numbers (frames)' });
    const isMember = l.kind === 'actor3d' || l.kind === 'prop3d';
    if (l.kind !== 'camera' && l.kind !== 'light' && !isMember) checkTransform(l.transform, `${lp}.transform`, issues);
    if (l.kind === 'precomp') {
      if (typeof l.compId !== 'string' || !l.compId) issues.push({ path: `${lp}.compId`, message: 'precomp needs compId' });
      if (!positive(l.width) || !positive(l.height)) issues.push({ path: lp, message: 'precomp needs positive width and height' });
      if (typeof l.compId === 'string' && l.compId) {
        const a = assets[l.compId];
        if (isObj(a)) {
          if (a.type !== 'composition') issues.push({ path: `${lp}.compId`, message: `compId '${l.compId}' resolves to an asset that is not a composition` });
        } else if (!(l.compId in precomps)) {
          issues.push({ path: `${lp}.compId`, message: `precomp compId '${l.compId}' is not an asset or an inline precomp` });
        }
      }
    }
    if (l.kind === 'stage3d' || isMember) {
      if (typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) && !versionAtLeast(version, STAGE3D_MIN_VERSION)) {
        issues.push({ path: at('version'), message: `${l.kind} layers require schema >= 1.11.0 (got ${version})` });
      }
    }
    if (l.kind === 'stage3d') {
      const cam = isObj(l.camera) ? l.camera : undefined;
      const vec3 = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(finite);
      if (!cam || !vec3(cam.position) || !vec3(cam.target)) issues.push({ path: `${lp}.camera`, message: 'stage3d camera is locked: position and target must be a static [x, y, z] (no keyframes)' });
    }
    if (isMember) {
      if (typeof l.stage !== 'string' || !l.stage) issues.push({ path: `${lp}.stage`, message: `${l.kind} needs stage, the id of its stage3d layer` });
      if (l.kind === 'actor3d' && (typeof l.assetId !== 'string' || !(l.assetId in assets))) issues.push({ path: `${lp}.assetId`, message: `actor3d '${String(l.id)}' references unknown assetId '${String(l.assetId)}' in this composition's assets` });
    }
    if (l.kind === 'model3d') {
      if (typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) && !versionAtLeast(version, MODEL3D_MIN_VERSION)) {
        issues.push({ path: at('version'), message: `model3d layers require schema >= 1.4.0 (got ${version})` });
      }
      const parsed = parseModel3D(l);
      if (!parsed.ok) for (const i of parsed.issues) issues.push({ path: `${lp}.${i.path}`.replace(/\.$/, ''), message: i.message });
      else {
        const refs: Array<[string, string | undefined]> = [
          ['textures.label', parsed.layer.textures?.label],
          ['textures.front', parsed.layer.textures?.front],
          ['source.assetId', parsed.layer.source.type === 'gltf' ? parsed.layer.source.assetId : undefined],
        ];
        for (const [where, id] of refs) {
          if (id && !(id in assets)) issues.push({ path: `${lp}.${where}`, message: `model3d layer '${l.id}' references unknown assetId '${id}' in this composition's assets` });
        }
      }
    }
    if (ASSET_KINDS.includes(l.kind as string)) {
      if (typeof l.assetId !== 'string' || !l.assetId || !(l.assetId in assets)) {
        issues.push({ path: `${lp}.assetId`, message: `layer '${String(l.id)}' references unknown assetId '${String(l.assetId)}' in this composition's assets` });
      }
    }
  });

  const worlds = new Map<string, { actor3d: number; prop3d: number; products: number }>();
  for (const l of layers) if (isObj(l) && l.kind === 'stage3d' && typeof l.id === 'string') worlds.set(l.id, { actor3d: 0, prop3d: 0, products: 0 });
  layers.forEach((l, i) => {
    if (!isObj(l) || (l.kind !== 'actor3d' && l.kind !== 'prop3d') || typeof l.stage !== 'string') return;
    const w = worlds.get(l.stage);
    if (!w) return void issues.push({ path: at(`layers[${i}].stage`), message: `${l.kind} '${String(l.id)}' names stage '${l.stage}', which is not a stage3d layer in this composition` });
    w[l.kind]++;
    if (l.kind === 'prop3d' && l.role === 'product') w.products++;
    if (w[l.kind] > STAGE_LIMITS[l.kind]) issues.push({ path: at(`layers[${i}]`), message: `stage '${l.stage}' holds at most ${STAGE_LIMITS[l.kind]} ${l.kind === 'actor3d' ? 'actors' : 'props'}` });
    if (w.products > 1) issues.push({ path: at(`layers[${i}]`), message: `stage '${l.stage}' holds one product` });
  });

  layers.forEach((l, i) => {
    if (!isObj(l) || typeof l.parent !== 'string') return;
    if (!byId.has(l.parent)) issues.push({ path: at(`layers[${i}].parent`), message: `parent '${l.parent}' is not a layer in this composition` });
  });
  for (const [id, l] of byId) {
    const seen = new Set([id]);
    let cur = l;
    while (typeof cur.parent === 'string' && byId.has(cur.parent)) {
      if (seen.has(cur.parent)) {
        issues.push({ path: at('layers'), message: `parent cycle involving layer '${id}'` });
        break;
      }
      seen.add(cur.parent);
      cur = byId.get(cur.parent)!;
    }
  }

  for (const [key, inner] of Object.entries(precomps)) validateComp(inner, at(`precomps.${key}`), issues);
}

export function lightValidate(json: unknown): ValidationResult {
  const issues: CompositionIssue[] = [];
  validateComp(json, '', issues);
  return issues.length ? { ok: false, issues } : { ok: true, data: json };
}
