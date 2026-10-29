import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addLayer, newFilmComposition, registerAsset, setSceneDuration } from '../authoring/api';
import { sceneIds } from '../authoring/meta';
import type { Comp, Obj } from '../authoring/types';
import { fixturePath } from '../test-utils/fixtures';
import { restoreScene, snapshotScene, spliceScene } from './scene-snapshot';

const two = (): Comp => JSON.parse(readFileSync(fixturePath('s03a', 'valid/two-scene-dolly.json'), 'utf8')) as Comp;
const precomp = (c: Comp, id: string) => (c.precomps as Record<string, Obj>)[id]!;
const rootLayer = (c: Comp, id: string) => (c.layers as Obj[]).find((l) => l.id === id)!;
const dir = (c: Comp) => (c.meta as { director: { scenes: Record<string, Obj>; layers: Record<string, Obj> } }).director;
const PHOTO = 'ast_0123456789abcdef0123456789abcdef';

const [S1, S2] = sceneIds(two()) as [string, string];
const withLayers = (c: Comp, sceneId: string, n: number): Comp => {
  let out = c;
  for (let i = 0; i < n; i++) out = addLayer(out, { sceneId, role: 'caption', kind: 'text', text: `extra ${i}` });
  return out;
};

describe('snapshotScene and restoreScene', () => {
  it('restoring undoes three added layers and leaves the other scene untouched', () => {
    const base = two();
    const snap = snapshotScene(base, S1);
    const edited = withLayers(base, S1, 3);
    expect(precomp(edited, S1).layers.length).toBe(precomp(base, S1).layers.length + 3);
    const back = restoreScene(edited, S1, snap);
    expect(precomp(back, S1)).toEqual(precomp(base, S1));
    expect(dir(back).layers).toEqual(dir(base).layers);
    expect(precomp(back, S2)).toEqual(precomp(base, S2));
    expect(rootLayer(back, S2)).toEqual(rootLayer(base, S2));
    expect(dir(back).scenes[S2]).toEqual(dir(base).scenes[S2]);
  });

  it('a longer scene shifts the next one back when the shorter snapshot returns', () => {
    const base = two();
    const fps = base.fps;
    const frames = precomp(base, S1).durationInFrames as number;
    const snap = snapshotScene(base, S1);
    const longer = setSceneDuration(base, S1, frames / fps + 2);
    expect(dir(longer).scenes[S2]!.startFrame).toBe(dir(base).scenes[S2]!.startFrame + 2 * fps);
    const back = restoreScene(longer, S1, snap);
    expect(dir(back).scenes[S2]!.startFrame).toBe(dir(base).scenes[S2]!.startFrame);
    expect(back.durationInFrames).toBe(base.durationInFrames);
  });

  it('snapshots the assets the scene uses and restores them into a composition that lost them', () => {
    let c = registerAsset(two(), { id: PHOTO, kind: 'image', src: '/p.png', width: 10, height: 10 });
    c = addLayer(c, { sceneId: S1, role: 'product', kind: 'image', assetId: PHOTO });
    const snap = snapshotScene(c, S1);
    expect(Object.keys(snap.assets)).toContain(PHOTO);
    const bare = structuredClone(c);
    delete (bare.assets as Record<string, unknown>)[PHOTO];
    expect((restoreScene(bare, S1, snap).assets as Record<string, unknown>)[PHOTO]).toEqual((c.assets as Record<string, unknown>)[PHOTO]);
  });

  it('is pure: neither the composition nor the snapshot is changed', () => {
    const base = two();
    const edited = withLayers(base, S1, 1);
    const snap = snapshotScene(base, S1);
    const baseCopy = structuredClone(base);
    const editedCopy = structuredClone(edited);
    const snapCopy = structuredClone(snap);
    const back = restoreScene(edited, S1, snap);
    expect(base).toEqual(baseCopy);
    expect(edited).toEqual(editedCopy);
    expect(snap).toEqual(snapCopy);
    back.layers.length = 0; // changing the result must not reach the snapshot either
    expect(snap).toEqual(snapCopy);
  });

  it('refuses an unknown scene', () => {
    expect(() => snapshotScene(two(), 'nope')).toThrow(/nope/);
    expect(() => restoreScene(two(), 'nope', snapshotScene(two(), S1))).toThrow(/nope/);
  });
});

describe('spliceScene', () => {
  it('copies the layers, meta.director entries and asset entries of the source scene into the target', () => {
    let source = registerAsset(two(), { id: PHOTO, kind: 'image', src: '/take.png', width: 10, height: 10 });
    source = addLayer(source, { sceneId: S2, role: 'product', kind: 'image', assetId: PHOTO });
    source = withLayers(source, S2, 2);
    const target = two();
    const spliced = spliceScene(target, S2, source);
    expect(precomp(spliced, S2).layers).toEqual(precomp(source, S2).layers);
    const ids = precomp(source, S2).layers.map((l: Obj) => l.id);
    for (const id of ids) expect(dir(spliced).layers[id]).toEqual(dir(source).layers[id]);
    expect((spliced.assets as Record<string, unknown>)[PHOTO]).toEqual((source.assets as Record<string, unknown>)[PHOTO]);
    expect(precomp(spliced, S1)).toEqual(precomp(target, S1));
    expect(sceneIds(spliced)).toEqual(sceneIds(target));
  });

  it('does not change either input', () => {
    const source = withLayers(two(), S2, 1);
    const target = two();
    const a = structuredClone(source);
    const b = structuredClone(target);
    spliceScene(target, S2, source);
    expect(source).toEqual(a);
    expect(target).toEqual(b);
  });

  it('works on a composition built with the authoring core', () => {
    const c = newFilmComposition({ aspect: '16:9', title: 't', palette: ['#111111'] });
    expect(() => snapshotScene(c, 's1')).toThrow();
  });
});
