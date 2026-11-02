import { describe, expect, it } from 'vitest';
import type { StoryboardOp } from '@shared/crew';
import type { Scene, Storyboard } from '@shared/storyboard';
import { StoryboardOpError, applyOps, nextSceneId } from './storyboard-ops';

const scene = (id: string, over: Partial<Scene> = {}): Scene => ({
  id, durationSec: 4, intent: `intent ${id}`, shotType: 'hero', camera: 'static', layersWanted: ['bg', 'product'], mode: 'motion', modeReason: 'a still is enough', ...over,
});
const board = (ids: string[], over: Partial<Scene> = {}): Storyboard => ({
  title: 'T', aspect: '16:9', durationSec: ids.length * 4, palette: ['#112233'], scenes: ids.map((i) => scene(i, over)),
});
const ids = (sb: Storyboard) => sb.scenes.map((s) => s.id);
const { id: _id, ...newScene } = scene('x');

describe('add', () => {
  it('puts a scene after s2 with the next id and marks it for a rebuild', () => {
    const r = applyOps(board(['s1', 's2', 's3']), [{ op: 'add', scene: newScene, after: 's2' }]);
    expect(ids(r.storyboard)).toEqual(['s1', 's2', 's4', 's3']);
    expect(r.added).toEqual(['s4']);
    expect(r.dirty).toEqual({ s4: ['rebuild'] });
  });
  it('null goes first and omitting `after` goes last', () => {
    expect(ids(applyOps(board(['s1', 's2']), [{ op: 'add', scene: newScene, after: null }]).storyboard)).toEqual(['s3', 's1', 's2']);
    expect(ids(applyOps(board(['s1', 's2']), [{ op: 'add', scene: newScene }]).storyboard)).toEqual(['s1', 's2', 's3']);
  });
  it('keeps an explicit id and refuses a duplicate', () => {
    expect(ids(applyOps(board(['s1', 's2']), [{ op: 'add', scene: { ...newScene, id: 'sunset' } }]).storyboard)).toContain('sunset');
    expect(() => applyOps(board(['s1', 's2']), [{ op: 'add', scene: { ...newScene, id: 's1' } }])).toThrow(StoryboardOpError);
  });
  it('refuses an unknown `after`', () => {
    expect(() => applyOps(board(['s1', 's2']), [{ op: 'add', scene: newScene, after: 's9' }])).toThrow(/s9/);
  });
});

describe('stable ids', () => {
  it('does not reuse s3 after it was removed in the same batch', () => {
    const r = applyOps(board(['s1', 's2', 's3']), [{ op: 'remove', sceneId: 's3' }, { op: 'add', scene: newScene }]);
    expect(r.added).toEqual(['s4']);
    expect(r.removed).toEqual(['s3']);
  });
  it('does not reuse an id removed in an earlier batch', () => {
    expect(applyOps(board(['s1', 's2']), [{ op: 'add', scene: newScene }], ['s3', 's4']).added).toEqual(['s5']);
  });
  it('nextSceneId counts current and removed ids, and ignores non-numeric ones', () => {
    expect(nextSceneId(board(['s1', 'sunset']))).toBe('s2');
    expect(nextSceneId(board(['s1', 's2']), ['s7'])).toBe('s8');
  });
});

describe('update', () => {
  it('a camera-only patch is dirty for camera only', () => {
    expect(applyOps(board(['s1', 's2']), [{ op: 'update', sceneId: 's2', patch: { camera: 'pan' } }]).dirty).toEqual({ s2: ['camera'] });
  });
  it('an intent patch is a rebuild', () => {
    expect(applyOps(board(['s1', 's2']), [{ op: 'update', sceneId: 's2', patch: { intent: 'sunset' } }]).dirty).toEqual({ s2: ['rebuild'] });
  });
  it('maps text, duration and mode to their own kinds', () => {
    const r = applyOps(board(['s1', 's2']), [
      { op: 'update', sceneId: 's1', patch: { text: 'Hello' } },
      { op: 'update', sceneId: 's2', patch: { durationSec: 5, mode: 'generate' } },
    ]);
    expect(r.dirty).toEqual({ s1: ['text'], s2: ['duration', 'mode'] });
    expect(r.storyboard.durationSec).toBe(9);
  });
  it('a change that is only a reason or a credit estimate is not dirty', () => {
    expect(applyOps(board(['s1', 's2']), [{ op: 'update', sceneId: 's1', patch: { modeReason: 'new reason' } }]).dirty).toEqual({});
  });
  it('a scene added and then edited in one batch stays a plain rebuild', () => {
    const r = applyOps(board(['s1', 's2']), [{ op: 'add', scene: newScene }, { op: 'update', sceneId: 's3', patch: { camera: 'pan' } }]);
    expect(r.dirty).toEqual({ s3: ['rebuild'] });
    expect(r.storyboard.scenes[2]!.camera).toBe('pan');
  });
  it('refuses an unknown scene', () => {
    expect(() => applyOps(board(['s1', 's2']), [{ op: 'update', sceneId: 's9', patch: { camera: 'pan' } }])).toThrow(/s9/);
  });
});

describe('remove and move', () => {
  it('remove reports the id and drops its dirt', () => {
    const r = applyOps(board(['s1', 's2', 's3']), [{ op: 'update', sceneId: 's3', patch: { camera: 'pan' } }, { op: 'remove', sceneId: 's3' }]);
    expect(ids(r.storyboard)).toEqual(['s1', 's2']);
    expect(r.removed).toEqual(['s3']);
    expect(r.dirty).toEqual({});
  });
  it('a scene added and removed in one batch is reported as neither', () => {
    const r = applyOps(board(['s1', 's2']), [{ op: 'add', scene: newScene }, { op: 'remove', sceneId: 's3' }]);
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
  });
  it('move reorders without marking anything dirty', () => {
    const r = applyOps(board(['s1', 's2', 's3']), [{ op: 'move', sceneId: 's3', after: null }]);
    expect(ids(r.storyboard)).toEqual(['s3', 's1', 's2']);
    expect(r.dirty).toEqual({});
    expect(ids(applyOps(board(['s1', 's2', 's3']), [{ op: 'move', sceneId: 's1', after: 's2' }]).storyboard)).toEqual(['s2', 's1', 's3']);
  });
});

describe('validation', () => {
  it('refuses seven scenes and leaves the input unchanged', () => {
    const sb = board(['s1', 's2', 's3', 's4', 's5', 's6'], { durationSec: 3 });
    const before = structuredClone(sb);
    expect(() => applyOps(sb, [{ op: 'add', scene: newScene }])).toThrow(StoryboardOpError);
    expect(sb).toEqual(before);
  });
  it('refuses a total over 30 seconds', () => {
    const sb = board(['s1', 's2', 's3', 's4'], { durationSec: 7 });
    expect(() => applyOps(sb, [{ op: 'add', scene: { ...newScene, durationSec: 7 } }])).toThrow(/30/);
  });
  it('refuses a third generate scene', () => {
    const sb: Storyboard = { ...board(['s1', 's2', 's3', 's4']), scenes: board(['s1', 's2', 's3', 's4']).scenes.map((s, i) => (i < 2 ? { ...s, mode: 'generate' as const } : s)) };
    expect(() => applyOps(sb, [{ op: 'update', sceneId: 's3', patch: { mode: 'generate' } }])).toThrow(/generate/);
  });
  it('applies nothing when a later op in the batch fails', () => {
    const sb = board(['s1', 's2']);
    const ops: StoryboardOp[] = [{ op: 'update', sceneId: 's1', patch: { camera: 'pan' } }, { op: 'remove', sceneId: 's9' }];
    expect(() => applyOps(sb, ops)).toThrow(StoryboardOpError);
    expect(sb.scenes[0]!.camera).toBe('static');
  });
  it('refuses a malformed op with the zod message', () => {
    expect(() => applyOps(board(['s1', 's2']), [{ op: 'move', sceneId: 's1' } as unknown as StoryboardOp])).toThrow(StoryboardOpError);
  });
});
