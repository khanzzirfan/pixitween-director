import { describe, expect, it } from 'vitest';
import type { AepLayer } from '@shared/aep/layer';
import type { AepCompositionJson } from '@shared/aep/composition';
import { parseMotionDoc } from '@engine/schema';
import { validateTargets } from '@engine/timeline';
import { aepToMotion } from './index';
import { convertModel3D } from './model3d';

type AepModel3DLayer = Extract<AepLayer, { kind: 'model3d' }>;

const LABEL = 'ast_a1e1adc5894c7aaefff8fc95e6b419d0';

// Copied from the stored film `film_778f5325b5c6` (version 18), layer `hero:product3d`.
function heroLayer(): AepModel3DLayer {
  return {
    id: 'hero:product3d',
    name: 'product3d',
    kind: 'model3d',
    inPoint: 0,
    outPoint: 120,
    transform: {
      position: [
        { t: 0, v: [974.78, 554.21], easeOut: [0.42, 0, 0.58, 1] },
        { t: 120, v: [945.22, 568.99] },
      ],
      anchor: [220.5, 648],
      scale: [0.7503, 0.7503],
      rotation: 0,
      opacity: 1,
    },
    viewport: { width: 441, height: 1296 },
    source: { type: 'primitive', shape: 'can', proportions: { width: 1, height: 3.075 } },
    textures: { label: LABEL, side: '#e8e0ce' },
    material: { roughness: 0.35, metalness: 0.55 },
    view: {
      rotation: [
        { t: 0, v: [4, -18, 0], easeIn: [0.42, 0, 0.58, 1], easeOut: [0.42, 0, 0.58, 1] },
        { t: 120, v: [4, 18, 0] },
      ],
    },
    lighting: { preset: 'studio', environment: 'room', key: { azimuth: 20, elevation: 75 } },
    shadow: { opacity: 0.35, softness: 0.6 },
    camera: { fov: 30, fit: 1.5 },
  } as AepModel3DLayer;
}

describe('convertModel3D', () => {
  it('converts the stored product3d can to a three layer', () => {
    const { layer } = convertModel3D(heroLayer(), 30);
    expect(layer).toBeDefined();
    if (!layer) return;
    expect(layer.type).toBe('three');
    expect([layer.width, layer.height]).toEqual([441, 1296]);
    expect(layer.background).toBe('transparent');
    expect(layer.objects).toHaveLength(1);
    const obj = layer.objects[0];
    expect(obj.geometry.type).toBe('cylinder');
    if (obj.geometry.type === 'cylinder') {
      expect(obj.geometry.height).toBe(3.075);
      expect(obj.geometry.radiusTop).toBe(0.5);
    }
    expect(obj.material.map).toBe(LABEL);
    expect(obj.material.color).toBe('#e8e0ce');
    expect(obj.rotation).toEqual([4, -18, 0]);
  });

  it('turns view.rotation keyframes into a rotation.y tween', () => {
    const { layer } = convertModel3D(heroLayer(), 30);
    const obj = layer!.objects[0];
    const t = layer!.tweens.find((tw) => tw.target === `object:${obj.id}`);
    expect(t).toBeDefined();
    expect(t!.from).toEqual({ 'rotation.y': -18 });
    expect(t!.to).toEqual({ 'rotation.y': 18 });
    expect(t!.at).toBe(0);
    expect(t!.duration).toBe(4);
  });

  it('places the camera so height x fit fills the viewport', () => {
    const { layer } = convertModel3D(heroLayer(), 30);
    expect(layer!.camera.fov).toBe(30);
    expect(Math.abs(layer!.camera.position[2] - (3.075 * 1.5) / (2 * Math.tan((15 * Math.PI) / 180)))).toBeLessThan(1e-6);
  });

  it('drops an extrude source with a warning', () => {
    const l = { ...heroLayer(), source: { type: 'extrude', contour: [[0, 0], [1, 0], [1, 1]], depth: 1 } } as unknown as AepModel3DLayer;
    const r = convertModel3D(l, 30);
    expect(r.layer).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/extrude/);
  });

  it('converts a glTF source', () => {
    const l = { ...heroLayer(), source: { type: 'gltf', assetId: 'ast_model', animation: { clip: 'Walk', speed: 2 } } } as AepModel3DLayer;
    const obj = convertModel3D(l, 30).layer!.objects[0];
    expect(obj.geometry).toMatchObject({ type: 'gltf', asset: 'ast_model' });
    expect(obj.animation).toMatchObject({ clip: 'Walk', speed: 2, loop: true });
  });

  it('produces a doc that passes parseMotionDoc and validateTargets', () => {
    const comp = {
      fps: 30,
      width: 1920,
      height: 1080,
      durationInFrames: 120,
      assets: { [LABEL]: { type: 'image', src: `/api/assets/${LABEL}`, width: 2048, height: 1024 } },
      layers: [heroLayer()],
    } as unknown as AepCompositionJson;
    const { doc } = aepToMotion(comp);
    const parsed = parseMotionDoc(doc);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(validateTargets(parsed.doc)).toEqual([]);
    expect(doc.layers[0].type).toBe('three');
  });
});
