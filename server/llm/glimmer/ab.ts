// Owned by S9. Six art-free scripted edits and a scorer, so the Glimmer vs Spark comparison is measured the same way every time.
import { addLayer, addScene, newFilmComposition, registerAsset, sceneInfo, type Comp } from '../../authoring/api';

type Obj = Record<string, any>;

export function buildSampleFilm(): Comp {
  let c = newFilmComposition({ aspect: '16:9', title: 'Cold brew', palette: ['#111827'] });
  c = registerAsset(c, { id: 'mug', kind: 'image', src: '/api/assets/mug', width: 384, height: 672 });
  for (const id of ['s1', 's2', 's3']) {
    c = addScene(c, { id, durationSec: 4, mode: 'motion' });
    c = addLayer(c, { sceneId: id, role: 'bg', kind: 'shape', fill: '#111827' });
    c = addLayer(c, { sceneId: id, role: 'product', kind: 'image', assetId: 'mug' });
    c = addLayer(c, { sceneId: id, role: 'headline', kind: 'text', text: `Headline ${id}` });
  }
  return addLayer(c, { sceneId: 's3', role: 'caption', kind: 'text', text: 'Small print' });
}

export interface ScriptedEdit {
  id: string;
  message: string;
  selection?: { sceneId?: string; layerId?: string };
}

export const SCRIPTED_EDITS: ScriptedEdit[] = [
  { id: 'bigger-product-last-scene', message: 'Make the mug bigger in the last scene' },
  { id: 'longer-intro', message: 'Make the first scene two seconds longer' },
  { id: 'headline-up', message: 'Move the headline up in scene 2' },
  { id: 'swap-scenes', message: 'Swap scenes 2 and 3' },
  { id: 'fade-headline-out', message: 'Fade the headline out over the last second of scene 1' },
  { id: 'remove-caption', message: 'Remove the caption in scene 3' },
];

const layerOf = (c: Comp, sceneId: string, layerId: string): Obj | undefined =>
  (((c.precomps as Obj | undefined)?.[sceneId]?.layers ?? []) as Obj[]).find((l) => l.id === layerId);

const isKeys = (f: unknown): f is Array<{ t: number; v: unknown }> => Array.isArray(f) && f.length > 0 && typeof f[0] === 'object' && f[0] !== null && !Array.isArray(f[0]);
/** The start and the end of a transform field, whether it is a plain value or keyframes. */
function span<T>(field: unknown): { first: T; last: T; lastT?: number } | undefined {
  if (field === undefined) return undefined;
  if (isKeys(field)) return { first: field[0]!.v as T, last: field.at(-1)!.v as T, lastT: field.at(-1)!.t };
  return { first: field as T, last: field as T };
}

const duration = (c: Comp, id: string) => sceneInfo(c).find((s) => s.id === id)?.durationSec;
const start = (c: Comp, id: string) => sceneInfo(c).find((s) => s.id === id)?.startSec;

type Check = (before: Comp, after: Comp) => string[];

const CHECKS: Record<string, Check> = {
  'bigger-product-last-scene': (b, a) => {
    const s = span<[number, number]>(layerOf(a, 's3', 's3:product')?.transform?.scale);
    const was = span<[number, number]>(layerOf(b, 's3', 's3:product')?.transform?.scale);
    if (!s || !was) return ['s3:product has no scale'];
    return s.last[0] >= was.first[0] * 1.2 ? [] : [`final scale ${s.last[0]} is not 1.2x the starting ${was.first[0]}`];
  },
  'longer-intro': (b, a) => {
    const grew = (duration(a, 's1') ?? 0) - (duration(b, 's1') ?? 0);
    const moved = (start(a, 's2') ?? 0) - (start(b, 's2') ?? 0);
    const reasons: string[] = [];
    if (grew < 1.9 || grew > 2.1) reasons.push(`scene 1 grew by ${grew.toFixed(2)} s, wanted about 2`);
    if (Math.abs(moved - grew) > 0.05) reasons.push(`scene 2 moved by ${moved.toFixed(2)} s, not by the same amount`);
    return reasons;
  },
  'headline-up': (b, a) => {
    const was = span<[number, number]>(layerOf(b, 's2', 's2:headline')?.transform?.position);
    const now = span<[number, number]>(layerOf(a, 's2', 's2:headline')?.transform?.position);
    if (!was || !now) return ['s2:headline has no position'];
    return was.first[1] - now.last[1] >= 40 ? [] : [`headline moved up by ${(was.first[1] - now.last[1]).toFixed(0)} px, wanted at least 40`];
  },
  'swap-scenes': (_b, a) => {
    const order = sceneInfo(a).map((s) => s.id).join(',');
    return order === 's1,s3,s2' ? [] : [`scene order is ${order}, wanted s1,s3,s2`];
  },
  'fade-headline-out': (_b, a) => {
    const o = span<number>(layerOf(a, 's1', 's1:headline')?.transform?.opacity);
    if (!o || o.lastT === undefined) return ['s1:headline opacity has no keyframes'];
    const sec = o.lastT / (a.fps || 30);
    const reasons: string[] = [];
    if (o.last !== 0) reasons.push(`final opacity is ${o.last}, wanted 0`);
    if (sec < 2.9 || sec > 4) reasons.push(`the fade ends at ${sec.toFixed(2)} s, wanted between 2.9 and 4`);
    return reasons;
  },
  'remove-caption': (_b, a) => (layerOf(a, 's3', 's3:caption') ? ['s3:caption still exists'] : []),
};

export function scoreEdit(editId: string, before: Comp, after: Comp): { pass: boolean; reasons: string[] } {
  const check = CHECKS[editId];
  if (!check) return { pass: false, reasons: [`unknown edit '${editId}'`] };
  const reasons = check(before, after);
  return { pass: reasons.length === 0, reasons };
}
