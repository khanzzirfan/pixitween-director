import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createStageCamera, configure2DMaterial, toWorldRotation, toWorldY } from './stage';
import { applyBaseTransform, blendingFor, createLayerObjects, resolveBaseTarget } from './transform';

const layerBase = { id: 'l', x: 0, y: 0, rotation: 0, scale: 1 as number | [number, number], anchor: [0.5, 0.5] as [number, number] };

describe('stage space', () => {
  it('maps the doc to an orthographic camera in pixels', () => {
    const camera = createStageCamera(1920, 1080);
    expect(camera.left).toBe(0);
    expect(camera.right).toBe(1920);
    expect(camera.top).toBe(0);
    expect(camera.bottom).toBe(-1080);
    expect(toWorldY(100)).toBe(-100);
    expect(toWorldRotation(Math.PI / 2)).toBe(-Math.PI / 2);
  });

  it('configures 2D materials for layer-order drawing', () => {
    const material = new THREE.MeshBasicMaterial();
    configure2DMaterial(material);
    expect(material.transparent).toBe(true);
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(material.toneMapped).toBe(false);
  });
});

describe('applyBaseTransform', () => {
  it('places, rotates, scales and anchors the layer', () => {
    const { display, content } = createLayerObjects({ id: 'a' });
    applyBaseTransform(display, content, { ...layerBase, x: 100, y: 50, rotation: 90, scale: [2, 3], anchor: [0.5, 1] }, { width: 40, height: 20 });
    expect(display.position.toArray()).toEqual([100, -50, 0]);
    expect(display.rotation.z).toBeCloseTo(-Math.PI / 2, 12);
    expect(display.scale.toArray()).toEqual([2, 3, 1]);
    expect(content.position.toArray()).toEqual([-20, 20, 0]);
    expect(content.parent).toBe(display);
  });

  it('overrides the anchor with a pixel pivot when given', () => {
    const { display, content } = createLayerObjects({ id: 'b' });
    applyBaseTransform(
      display,
      content,
      { ...layerBase, x: 960, y: 540, anchor: [0.5, 0.5], pivot: [192, 336] },
      { width: 384, height: 672 },
    );
    expect(content.position.toArray()).toEqual([-192, 336, 0]);
    expect(display.position.toArray()).toEqual([960, -540, 0]);
  });
});

describe('resolveBaseTarget', () => {
  const make = () => {
    const { display } = createLayerObjects({ id: 'n' });
    return { display, alpha: { value: 1 } };
  };

  it('writes doc-space y and reads it back', () => {
    const node = make();
    const ref = resolveBaseTarget(node, 'y');
    if (!ref) throw new Error('no ref');
    (ref.obj as Record<string, number>)[ref.key] = 30;
    expect(node.display.position.y).toBe(-30);
    expect((ref.obj as Record<string, number>)[ref.key]).toBe(30);
  });

  it('rotation is a deg target that writes clockwise radians', () => {
    const node = make();
    const ref = resolveBaseTarget(node, 'rotation');
    expect(ref?.kind).toBe('deg');
    (ref!.obj as Record<string, number>)[ref!.key] = Math.PI / 2;
    expect(node.display.rotation.z).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('scale writes both axes; alpha writes the node alpha', () => {
    const node = make();
    const scale = resolveBaseTarget(node, 'scale')!;
    (scale.obj as Record<string, number>)[scale.key] = 2;
    expect(node.display.scale.x).toBe(2);
    expect(node.display.scale.y).toBe(2);
    const alpha = resolveBaseTarget(node, 'alpha')!;
    (alpha.obj as Record<string, number>)[alpha.key] = 0.25;
    expect(node.alpha.value).toBe(0.25);
  });

  it('refuses skew and unknown props', () => {
    const node = make();
    expect(resolveBaseTarget(node, 'skewX')).toBeNull();
    expect(resolveBaseTarget(node, 'nope')).toBeNull();
  });
});

describe('blendingFor', () => {
  it('maps the four blend modes', () => {
    expect(blendingFor('normal').blending).toBe(THREE.NormalBlending);
    expect(blendingFor('add').blending).toBe(THREE.AdditiveBlending);
    expect(blendingFor('multiply')).toMatchObject({ blending: THREE.MultiplyBlending, premultipliedAlpha: true });
    expect(blendingFor('screen')).toMatchObject({
      premultipliedAlpha: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcColorFactor,
    });
  });
});
