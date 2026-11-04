import { describe, expect, it } from 'vitest';
import basic from '../../fixtures/basic-2d.json';
import primitives from '../../fixtures/three-primitives.json';
import { parseMotionDoc, type MotionDocInput } from '../schema';
import { bakeDoc } from './bake';

function parse(input: unknown) {
  const result = parseMotionDoc(input as MotionDocInput);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

describe('bakeDoc', () => {
  it('bakes duration x fps frames per layer, deterministically', () => {
    const doc = parse(basic);
    const a = bakeDoc(doc);
    const b = bakeDoc(doc);
    expect(a.frameCount).toBe(Math.round(doc.duration * doc.fps));
    for (const layer of a.layers) expect(layer.frames).toHaveLength(a.frameCount);
    expect(a).toEqual(b);
  });

  it('bakes a scaled, centre-anchored shape to its doc-space bounds', () => {
    const doc = parse({
      version: 1,
      width: 800,
      height: 600,
      fps: 10,
      duration: 1,
      layers: [
        { id: 's', type: 'shape', shape: 'rect', width: 200, height: 100, x: 300, y: 200, anchor: [0.5, 0.5], scale: 2, end: 1 },
      ],
    });
    const baked = bakeDoc(doc);
    expect(baked.layers[0].frames[3].bounds).toEqual({ x: 100, y: 100, width: 400, height: 200 });
  });

  it('hides a layer outside [start, end) and fades it in from 0', () => {
    const doc = parse({
      version: 1,
      width: 100,
      height: 100,
      fps: 10,
      duration: 3,
      layers: [
        { id: 'a', type: 'shape', shape: 'rect', width: 10, height: 10, start: 1, end: 2, enter: { name: 'fadeIn' } },
      ],
    });
    const frames = bakeDoc(doc).layers[0].frames;
    expect(frames[9].visible).toBe(false);
    expect(frames[9].bounds).toBeNull();
    expect(frames[10].visible).toBe(true);
    expect(frames[10].opacity).toBe(0);
    expect(frames[19].visible).toBe(true);
    expect(frames[20].visible).toBe(false);
    expect(frames[20].opacity).toBe(0);
  });

  it('bakes boxes and the camera for three layers', () => {
    const doc = parse(primitives);
    const baked = bakeDoc(doc);
    const stage = baked.layers.find((l) => l.type === 'three')!;
    const first = stage.frames[0];
    expect(Object.keys(first.objects ?? {}).sort()).toEqual(['ball', 'box', 'ring']);
    for (const box of Object.values(first.objects ?? {})) {
      for (let i = 0; i < 3; i++) expect(box.min[i]).toBeLessThan(box.max[i]);
    }
    const layer = doc.layers.find((l) => l.type === 'three');
    if (!layer || layer.type !== 'three') throw new Error('no three layer');
    expect(first.camera?.position).toEqual(layer.camera.position);
  });
});
