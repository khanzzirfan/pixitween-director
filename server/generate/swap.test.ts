import { describe, expect, it } from 'vitest';
import { addLayer, addScene, registerAsset, sceneInfo } from '../authoring/api';
import { deepFreeze, mugScene } from '../authoring/test-helpers';
import { getValidator } from '../engine/validate';
import { coverBox, revertToMotion, swapInClip } from './swap';

const ASSET = { id: 'ast_ffffffffffffffffffffffffffffffff', url: '/api/assets/ast_ffffffffffffffffffffffffffffffff' };
const frame = { width: 1920, height: 1080 };
const clipSize = { width: 1280, height: 720 };
const layerIds = (c: ReturnType<typeof mugScene>, scene: string) => ((c.precomps as Record<string, { layers: Array<{ id: string }> }>)[scene]!.layers).map((l) => l.id);
const layer = (c: ReturnType<typeof mugScene>, scene: string, id: string) => (c.precomps as Record<string, { layers: Array<Record<string, unknown>> }>)[scene]!.layers.find((l) => l.id === id)!;

describe('coverBox', () => {
  it('covers the frame with a top-left origin', () => {
    expect(coverBox({ width: 1920, height: 1080 }, { width: 320, height: 180 })).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    const b = coverBox({ width: 1080, height: 1920 }, { width: 1920, height: 1080 });
    expect(b.h).toBe(1920);
    expect(b.w).toBeCloseTo(3413.33, 1);
    expect(b.x).toBeCloseTo(-1166.67, 1);
  });
});

describe('swapInClip', () => {
  it('puts the clip above bg and product, below the headline, and hides the motion layers', async () => {
    const before = deepFreeze(mugScene());
    const out = swapInClip(before, { sceneId: 's1', asset: ASSET, clipSec: 4, frame, clipSize });
    expect(layerIds(out, 's1')).toEqual(['s1:bg', 's1:product', 's1:clip', 's1:headline']);
    expect(layer(out, 's1', 's1:bg').hidden).toBe(true);
    expect(layer(out, 's1', 's1:product').hidden).toBe(true);
    expect(layer(out, 's1', 's1:headline').hidden).toBeUndefined();
    const v = await getValidator();
    expect(v.validate(out)).toMatchObject({ ok: true });
    const dir = (out.meta as { director: { layers: Record<string, { role: string; assetId?: string }> } }).director;
    expect(dir.layers['s1:clip']).toMatchObject({ role: 'clip', assetId: ASSET.id });
    expect(out.assets[ASSET.id]).toMatchObject({ type: 'video', duration: 120 });
    expect((out.precomps as Record<string, { assets: Record<string, unknown> }>).s1!.assets[ASSET.id]).toMatchObject({ duration: 120 });
  });

  it('puts the clip last without text, and shortens the scene to a shorter clip', () => {
    let c = mugScene();
    c = addScene(c, { id: 's2', durationSec: 3, mode: 'generate' });
    c = registerAsset(c, { id: 'ast_00000000000000000000000000000001', kind: 'image', src: 'x', width: 10, height: 10 });
    c = addLayer(c, { sceneId: 's2', role: 'bg', kind: 'shape', fill: '#000' });
    const out = swapInClip(c, { sceneId: 's2', asset: ASSET, clipSec: 2.2, frame, clipSize });
    expect(layerIds(out, 's2').at(-1)).toBe('s2:clip');
    const s2 = sceneInfo(out).find((s) => s.id === 's2')!;
    expect(s2.durationSec).toBeCloseTo(2.2, 2);

    const long = swapInClip(c, { sceneId: 's1', asset: ASSET, clipSec: 2.5, frame, clipSize });
    expect(sceneInfo(long).find((s) => s.id === 's1')!.durationSec).toBeCloseTo(2.5, 2);
    expect(sceneInfo(long).find((s) => s.id === 's2')!.startSec).toBeCloseTo(2.5, 2);
  });
});

describe('revertToMotion', () => {
  it('restores the composition exactly, including a shortened scene', () => {
    const before = mugScene();
    const swapped = swapInClip(before, { sceneId: 's1', asset: ASSET, clipSec: 2.5, frame, clipSize });
    expect(revertToMotion(swapped, 's1', 4)).toEqual(before);
    const same = swapInClip(before, { sceneId: 's1', asset: ASSET, clipSec: 4, frame, clipSize });
    expect(revertToMotion(same, 's1', 4)).toEqual(before);
  });

  it('is a no-op without a clip layer', () => {
    const c = mugScene();
    expect(revertToMotion(c, 's1', 4)).toEqual(c);
  });

  it('keeps an asset that another layer still uses', () => {
    let c = mugScene();
    c = addScene(c, { id: 's2', durationSec: 3, mode: 'motion' });
    c = swapInClip(c, { sceneId: 's1', asset: ASSET, clipSec: 4, frame, clipSize });
    c = swapInClip(c, { sceneId: 's2', asset: ASSET, clipSec: 3, frame, clipSize });
    const out = revertToMotion(c, 's1', 4);
    expect(out.assets[ASSET.id]).toBeDefined();
    expect((out.precomps as Record<string, { assets: Record<string, unknown> }>).s2!.assets[ASSET.id]).toBeDefined();
    expect((out.precomps as Record<string, { assets: Record<string, unknown> }>).s1!.assets[ASSET.id]).toBeUndefined();
  });
});
