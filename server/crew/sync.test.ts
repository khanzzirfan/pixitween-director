import { describe, expect, it } from 'vitest';
import type { StoryboardOp } from '@shared/crew';
import type { Scene, Storyboard } from '@shared/storyboard';
import { addLayer, addScene, newFilmComposition, setCamera } from '../authoring/api';
import { sceneIds } from '../authoring/meta';
import type { Comp, Obj } from '../authoring/types';
import { applyOps } from './storyboard-ops';
import { syncComposition } from './sync';

const scene = (id: string, over: Partial<Scene> = {}): Scene => ({
  id, durationSec: 4, intent: `intent ${id}`, shotType: 'hero', camera: 'static', layersWanted: ['bg', 'product'], mode: 'motion', modeReason: 'a still is enough', ...over,
});
const storyboard = (ids: string[]): Storyboard => ({ title: 'T', aspect: '16:9', durationSec: ids.length * 4, palette: ['#112233'], scenes: ids.map((i) => scene(i)) });

/** A composition that already matches the storyboard: each scene has a bg shape and a headline. */
const build = (sb: Storyboard): Comp => {
  let c = newFilmComposition({ aspect: sb.aspect, title: sb.title, palette: sb.palette });
  for (const s of sb.scenes) {
    c = addScene(c, { id: s.id, durationSec: s.durationSec, mode: s.mode, intent: s.intent });
    c = addLayer(c, { sceneId: s.id, role: 'bg', kind: 'shape', fill: '#223344' });
    c = addLayer(c, { sceneId: s.id, role: 'headline', kind: 'text', text: `Title ${s.id}` });
  }
  return c;
};
const revise = (sb: Storyboard, ops: StoryboardOp[]) => {
  const r = applyOps(sb, ops);
  return { r, sb2: r.storyboard };
};
const precomp = (c: Comp, id: string) => (c.precomps as Record<string, Obj>)[id]!;
const { id: _id, ...newScene } = scene('x');

describe('syncComposition', () => {
  it('a camera-only change applies the camera and needs no builder', () => {
    const sb = storyboard(['s1', 's2']);
    const c = build(sb);
    const { r, sb2 } = revise(sb, [{ op: 'update', sceneId: 's2', patch: { camera: 'pan' } }]);
    const out = syncComposition(c, sb, sb2, r);
    expect(out.needsBuilder).toEqual([]);
    expect(precomp(out.next, 's2').layers).toEqual(precomp(setCamera(c, 's2', 'pan'), 's2').layers);
  });

  it('adding s4 after s2 puts it third in the timeline and asks for a builder', () => {
    const sb = storyboard(['s1', 's2', 's3']);
    const c = build(sb);
    const { r, sb2 } = revise(sb, [{ op: 'add', scene: newScene, after: 's2' }]);
    const out = syncComposition(c, sb, sb2, r);
    expect(out.needsBuilder).toEqual(['s4']);
    expect(sceneIds(out.next)).toEqual(['s1', 's2', 's4', 's3']);
    expect(out.next.durationInFrames).toBe(16 * out.next.fps);
    expect(precomp(out.next, 's4').layers).toEqual([]);
  });

  it('a text change with no headline layer adds s1:headline with that text', () => {
    const sb = storyboard(['s1', 's2']);
    let c = build(sb);
    // drop the headline from s1
    c = JSON.parse(JSON.stringify(c)) as Comp;
    precomp(c, 's1').layers = precomp(c, 's1').layers.filter((l: Obj) => l.id !== 's1:headline');
    delete (c.meta as { director: { layers: Record<string, unknown> } }).director.layers['s1:headline'];
    const { r, sb2 } = revise(sb, [{ op: 'update', sceneId: 's1', patch: { text: 'Cold brew, done right' } }]);
    const out = syncComposition(c, sb, sb2, r);
    const headline = precomp(out.next, 's1').layers.find((l: Obj) => l.id === 's1:headline');
    expect(headline?.source).toBe('Cold brew, done right');
  });

  it('a text change on an existing headline rewrites it', () => {
    const sb = storyboard(['s1', 's2']);
    const { r, sb2 } = revise(sb, [{ op: 'update', sceneId: 's2', patch: { text: 'New words' } }]);
    const out = syncComposition(build(sb), sb, sb2, r);
    expect(precomp(out.next, 's2').layers.find((l: Obj) => l.id === 's2:headline')?.source).toBe('New words');
  });

  it('a duration change moves the later scenes', () => {
    const sb = storyboard(['s1', 's2']);
    const { r, sb2 } = revise(sb, [{ op: 'update', sceneId: 's1', patch: { durationSec: 6 } }]);
    const out = syncComposition(build(sb), sb, sb2, r);
    expect(precomp(out.next, 's1').durationInFrames).toBe(6 * out.next.fps);
    expect(out.next.durationInFrames).toBe(10 * out.next.fps);
    expect(out.needsBuilder).toEqual([]);
  });

  it('removes a scene and its timeline length', () => {
    const sb = storyboard(['s1', 's2', 's3']);
    const { r, sb2 } = revise(sb, [{ op: 'remove', sceneId: 's2' }]);
    const out = syncComposition(build(sb), sb, sb2, r);
    expect(sceneIds(out.next)).toEqual(['s1', 's3']);
    expect(out.next.durationInFrames).toBe(8 * out.next.fps);
  });

  it('moves a scene', () => {
    const sb = storyboard(['s1', 's2', 's3']);
    const { r, sb2 } = revise(sb, [{ op: 'move', sceneId: 's3', after: null }]);
    expect(sceneIds(syncComposition(build(sb), sb, sb2, r).next)).toEqual(['s3', 's1', 's2']);
  });

  it('an intent change needs a builder and a mode change is reported, not applied', () => {
    const sb = storyboard(['s1', 's2', 's3']);
    const { r, sb2 } = revise(sb, [
      { op: 'update', sceneId: 's1', patch: { intent: 'sunset' } },
      { op: 'update', sceneId: 's2', patch: { mode: 'generate' } },
    ]);
    const c = build(sb);
    const out = syncComposition(c, sb, sb2, r);
    expect(out.needsBuilder).toEqual(['s1']);
    expect(out.needsMode).toEqual(['s2']);
    expect(precomp(out.next, 's2')).toEqual(precomp(c, 's2'));
  });

  it('a batch that removes one scene and adds another fits the film length', () => {
    const sb: Storyboard = { ...storyboard(['s1', 's2', 's3', 's4']), scenes: ['s1', 's2', 's3', 's4'].map((i) => scene(i, { durationSec: 7 })), durationSec: 28 };
    const { r, sb2 } = revise(sb, [{ op: 'add', scene: { ...newScene, durationSec: 7 } }, { op: 'remove', sceneId: 's4' }]);
    expect(sceneIds(syncComposition(build(sb), sb, sb2, r).next)).toEqual(['s1', 's2', 's3', 's5']);
  });

  it('is idempotent and does not change its input', () => {
    const sb = storyboard(['s1', 's2']);
    const c = build(sb);
    const copy = structuredClone(c);
    const { r, sb2 } = revise(sb, [{ op: 'add', scene: newScene }, { op: 'update', sceneId: 's1', patch: { camera: 'dolly-in' } }]);
    const once = syncComposition(c, sb, sb2, r);
    expect(c).toEqual(copy);
    const twice = syncComposition(once.next, sb, sb2, { dirty: {} });
    expect(twice.next).toEqual(once.next);
  });
});
