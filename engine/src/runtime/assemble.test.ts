import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MotionNode, NodeFactory } from '../core/types';
import { setEffectChainFactoryForTests, type EffectChain } from '../effects/chain';
import { parseMotionDoc, type MotionDocInput } from '../schema';
import { createThreeNode, type ThreeNode } from '../three/threeNode';
import { frameShot } from '../three/camera/frameShot';
import { assemble } from './assemble';

function parse(input: MotionDocInput) {
  const result = parseMotionDoc(input);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

function meshesOf(node: { display: THREE.Object3D }): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  node.display.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh);
  });
  return meshes;
}

const baseCtx = { renderer: null, textures: new Map(), factories: {} };

describe('assemble', () => {
  afterEach(() => {
    setEffectChainFactoryForTests(null);
  });

  it('builds nodes and the stage in layer order, with later meshes drawn on top', () => {
    const doc = parse({
      version: 1,
      width: 100,
      height: 100,
      duration: 2,
      layers: [
        { id: 'a', type: 'shape', shape: 'rect', width: 10, height: 10, start: 0, end: 2 },
        { id: 'b', type: 'shape', shape: 'rect', width: 10, height: 10, start: 0, end: 2 },
        {
          id: 'grp',
          type: 'group',
          start: 0,
          end: 2,
          children: [{ id: 'c', type: 'shape', shape: 'rect', width: 10, height: 10, start: 0, end: 2 }],
        },
      ],
    });

    const result = assemble(doc, baseCtx);

    expect(result.nodes).toHaveLength(4);
    expect(result.stage.children).toHaveLength(3);
    expect(result.stage.children.map((child) => child.name)).toEqual(['a', 'b', 'grp']);

    const nodeA = result.nodes.find((n) => n.id === 'a')!;
    const nodeB = result.nodes.find((n) => n.id === 'b')!;
    expect(meshesOf(nodeB)[0].renderOrder).toBeGreaterThan(meshesOf(nodeA)[0].renderOrder);
  });

  it('a fadeIn enter preset starts alpha at 0 and ends at the base alpha', () => {
    const doc = parse({
      version: 1,
      width: 100,
      height: 100,
      duration: 2,
      layers: [
        {
          id: 's',
          type: 'shape',
          shape: 'rect',
          width: 10,
          height: 10,
          start: 0.3,
          end: 2,
          alpha: 0.8,
          enter: { name: 'fadeIn', duration: 0.5 },
        },
      ],
    });

    const result = assemble(doc, baseCtx);
    const node = result.nodes[0];

    result.clock.seek(node.start);
    expect(node.alpha.value).toBe(0);

    result.clock.seek(node.start + 0.5);
    expect(node.alpha.value).toBeCloseTo(0.8);
  });

  it('isolates a layer with an enabled effect and routes effect:<id> tweens to the chain ref', () => {
    const ref = { obj: { strength: 0 }, key: 'strength', kind: 'number' as const };
    const fakeChain: EffectChain = {
      render: vi.fn(),
      setSize: vi.fn(),
      resolveTarget: vi.fn((id: string, prop: string) => (id === 'g' && prop === 'strength' ? ref : null)),
      dispose: vi.fn(),
      errors: [],
    };
    setEffectChainFactoryForTests(() => fakeChain);

    const doc = parse({
      version: 1,
      width: 100,
      height: 100,
      duration: 2,
      layers: [
        {
          id: 's',
          type: 'shape',
          shape: 'rect',
          width: 10,
          height: 10,
          start: 0,
          end: 2,
          effects: [{ id: 'g', type: 'glow' }],
          tweens: [{ target: 'effect:g', at: 0, duration: 1, to: { strength: 5 } }],
        },
      ],
    });

    const result = assemble(doc, baseCtx);
    const node = result.nodes[0];

    expect(node.display.children).not.toContain(node.content);
    expect(node.display.children).toHaveLength(1);
    expect((node.display.children[0] as THREE.Mesh).isMesh).toBe(true);

    result.clock.seek(1);
    expect(ref.obj.strength).toBeCloseTo(5);
  });

  it('an unknown tween property becomes one warning with the layer id; destroy destroys every node and the clock', () => {
    const fakeChain: EffectChain = {
      render: vi.fn(),
      setSize: vi.fn(),
      resolveTarget: vi.fn((id: string, prop: string) => (id === 'g' && prop === 'strength' ? { obj: { strength: 0 }, key: 'strength', kind: 'number' as const } : null)),
      dispose: vi.fn(),
      errors: [],
    };
    setEffectChainFactoryForTests(() => fakeChain);

    const doc = parse({
      version: 1,
      width: 100,
      height: 100,
      duration: 2,
      layers: [
        { id: 'a', type: 'shape', shape: 'rect', width: 10, height: 10, start: 0, end: 2 },
        { id: 'b', type: 'shape', shape: 'rect', width: 10, height: 10, start: 0, end: 2 },
        {
          id: 'grp',
          type: 'group',
          start: 0,
          end: 2,
          children: [
            {
              id: 'c',
              type: 'shape',
              shape: 'rect',
              width: 10,
              height: 10,
              start: 0,
              end: 2,
              effects: [{ id: 'g', type: 'glow' }],
              tweens: [{ target: 'effect:g', at: 0, duration: 1, to: { bogus: 1 } }],
            },
          ],
        },
      ],
    });

    const result = assemble(doc, baseCtx);

    const unknownPropertyWarnings = result.warnings.filter((w) => w.includes('unknown property'));
    expect(unknownPropertyWarnings).toHaveLength(1);
    expect(unknownPropertyWarnings[0]).toContain('c');

    const nodeSpies = result.nodes.map((node) => vi.spyOn(node, 'destroy'));
    const clockSpy = vi.spyOn(result.clock, 'destroy');

    result.destroy();

    for (const spy of nodeSpies) expect(spy).toHaveBeenCalledTimes(1);
    expect(clockSpy).toHaveBeenCalledTimes(1);
  });

  it('a layer from 1 to 2 is invisible at 0.5, visible at 1.5, invisible at 2', () => {
    const doc = parse({
      version: 1,
      width: 100,
      height: 100,
      duration: 3,
      layers: [{ id: 's', type: 'shape', shape: 'rect', width: 10, height: 10, start: 1, end: 2 }],
    });

    const result = assemble(doc, baseCtx);
    const node = result.nodes[0];

    result.clock.seek(0.5);
    expect(node.display.visible).toBe(false);

    result.clock.seek(1.5);
    expect(node.display.visible).toBe(true);

    result.clock.seek(2);
    expect(node.display.visible).toBe(false);
  });

  function fakeThreeFactory(update: (timeSec: number, frame: number) => void): NodeFactory {
    return (layer, _ctx, parentStart): MotionNode => {
      const display = new THREE.Group();
      const node: MotionNode = {
        id: layer.id,
        layer,
        display,
        content: display,
        start: parentStart + layer.start,
        end: parentStart + (layer.end ?? layer.start),
        children: [],
        alpha: { value: 1 },
        warnings: [],
        size: () => ({ width: 1, height: 1 }),
        resolveTarget: () => null,
        applyOpacity: () => {},
        update,
        ready: Promise.resolve(),
        destroy: () => {},
      };
      return node;
    };
  }

  it('a fake three node from 0 to 3 gets update(1, 30) on seek(1) and no update on seek(4)', () => {
    const update = vi.fn();
    const doc = parse({
      version: 1,
      width: 100,
      height: 100,
      fps: 30,
      duration: 4,
      layers: [
        {
          id: 't',
          type: 'three',
          width: 100,
          height: 100,
          start: 0,
          end: 3,
          objects: [{ id: 'box', geometry: { type: 'box', size: [1, 1, 1] } }],
        },
      ],
    });

    const result = assemble(doc, { ...baseCtx, factories: { three: fakeThreeFactory(update) } });

    result.clock.seek(1);
    expect(update).toHaveBeenCalledWith(1, 30);

    update.mockClear();
    result.clock.seek(4);
    expect(update).not.toHaveBeenCalled();
  });

  it('renders the stage exactly once per seek: plain renderer.render with no stage effects', () => {
    const render = vi.fn();
    const renderer = { render } as unknown as THREE.WebGLRenderer;

    const doc = parse({
      version: 1,
      width: 100,
      height: 100,
      duration: 2,
      layers: [{ id: 's', type: 'shape', shape: 'rect', width: 10, height: 10, start: 0, end: 2 }],
    });

    const result = assemble(doc, { ...baseCtx, renderer });
    render.mockClear();

    result.clock.seek(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('renders the stage exactly once per seek through the stage chain when stage effects are enabled', () => {
    const fakeChain: EffectChain = {
      render: vi.fn(),
      setSize: vi.fn(),
      resolveTarget: vi.fn(() => null),
      dispose: vi.fn(),
      errors: [],
    };
    setEffectChainFactoryForTests(() => fakeChain);

    const doc = parse({
      version: 1,
      width: 100,
      height: 100,
      duration: 2,
      effects: [{ id: 'v', type: 'vignette' }],
      layers: [{ id: 's', type: 'shape', shape: 'rect', width: 10, height: 10, start: 0, end: 2 }],
    });

    const result = assemble(doc, baseCtx);
    (fakeChain.render as ReturnType<typeof vi.fn>).mockClear();

    result.clock.seek(1);
    expect(fakeChain.render).toHaveBeenCalledTimes(1);
  });

  it('a three layer with a camera path gives the same camera after seeking away and back', () => {
    const fakeChain: EffectChain = {
      render: vi.fn(),
      setSize: vi.fn(),
      resolveTarget: vi.fn(() => null),
      dispose: vi.fn(),
      errors: [],
    };
    setEffectChainFactoryForTests(() => fakeChain);

    const doc = parse({
      version: 1,
      width: 100,
      height: 100,
      duration: 4,
      layers: [
        {
          id: 't',
          type: 'three',
          width: 100,
          height: 100,
          start: 0,
          end: 4,
          objects: [{ id: 'can', geometry: { type: 'box', size: [0.6, 1.8, 0.6] } }],
          camera: {
            path: {
              keys: [
                { t: 0, position: [0, 1, 6], lookAt: [0, 0.6, 0] },
                { t: 2, position: [2, 3, 4], lookAt: [1, 1, 0] },
              ],
              curve: 'linear',
            },
          },
        },
      ],
    });

    const result = assemble(doc, { ...baseCtx, factories: { three: createThreeNode } });
    const node = result.nodes[0] as ThreeNode;

    result.clock.seek(1);
    const first = node.rig!.camera.position.toArray();
    expect(first).toEqual([1, 2, 5]);

    result.clock.seek(0);
    expect(node.rig!.camera.position.toArray()).toEqual([0, 1, 6]);

    result.clock.seek(1);
    expect(node.rig!.camera.position.toArray()).toEqual(first);
  });

  it('a camera rig tween moves the camera over its rest pose', () => {
    const fakeChain: EffectChain = {
      render: vi.fn(),
      setSize: vi.fn(),
      resolveTarget: vi.fn(() => null),
      dispose: vi.fn(),
      errors: [],
    };
    setEffectChainFactoryForTests(() => fakeChain);

    const doc = parse({
      version: 1,
      width: 100,
      height: 100,
      duration: 4,
      layers: [
        {
          id: 't',
          type: 'three',
          width: 100,
          height: 100,
          start: 0,
          end: 4,
          objects: [{ id: 'can', geometry: { type: 'box', size: [0.6, 1.8, 0.6] } }],
          camera: { position: [0, 1, 6], lookAt: [0, 1, 0] },
          tweens: [{ target: 'camera', at: 0, duration: 2, ease: 'none', to: { 'rig.dolly': 2 } }],
        },
      ],
    });

    const result = assemble(doc, { ...baseCtx, factories: { three: createThreeNode } });
    const node = result.nodes[0] as ThreeNode;

    // The rest pose stands still; the dolly rides on top of it.
    result.clock.seek(0);
    expect(node.rig!.camera.position.toArray()).toEqual([0, 1, 6]);

    result.clock.seek(2);
    expect(node.rig!.camera.position.toArray()).toEqual([0, 1, 4]);
  });

  it('a crane preset lifts the camera over its rest pose', () => {
    const fakeChain: EffectChain = {
      render: vi.fn(),
      setSize: vi.fn(),
      resolveTarget: vi.fn(() => null),
      dispose: vi.fn(),
      errors: [],
    };
    setEffectChainFactoryForTests(() => fakeChain);

    const doc = parse({
      version: 1,
      width: 100,
      height: 100,
      duration: 4,
      layers: [
        {
          id: 't',
          type: 'three',
          width: 100,
          height: 100,
          start: 0,
          end: 4,
          objects: [{ id: 'can', geometry: { type: 'box', size: [0.6, 1.8, 0.6] } }],
          camera: { position: [0, 1, 6], lookAt: [0, 1, 0] },
          enter: { name: 'crane', duration: 2 },
        },
      ],
    });

    const result = assemble(doc, { ...baseCtx, factories: { three: createThreeNode } });
    const node = result.nodes[0] as ThreeNode;

    result.clock.seek(0);
    expect(node.rig!.camera.position.toArray()).toEqual([0, 1, 6]);

    result.clock.seek(2);
    expect(node.rig!.camera.position.toArray()).toEqual([0, 2, 6]);
  });

  it('a cameraTo preset moves the camera to the shot it frames', () => {
    const fakeChain: EffectChain = {
      render: vi.fn(),
      setSize: vi.fn(),
      resolveTarget: vi.fn(() => null),
      dispose: vi.fn(),
      errors: [],
    };
    setEffectChainFactoryForTests(() => fakeChain);

    const doc = parse({
      version: 1,
      width: 100,
      height: 100,
      duration: 4,
      layers: [
        {
          id: 't',
          type: 'three',
          width: 100,
          height: 100,
          start: 0,
          end: 4,
          objects: [{ id: 'can', geometry: { type: 'box', size: [0.6, 1.8, 0.6] } }],
          camera: { shot: { subject: 'object:can', size: 'medium' } },
          enter: { name: 'cameraTo', duration: 1, params: { shot: { subject: 'object:can', size: 'closeUp' } } },
        },
      ],
    });

    const result = assemble(doc, { ...baseCtx, factories: { three: createThreeNode } });
    const node = result.nodes[0] as ThreeNode;

    // A box geometry is centred on the origin, so the can's world box is half a unit around it.
    const framed = frameShot(
      { subject: 'object:can', size: 'closeUp' },
      new THREE.Box3(new THREE.Vector3(-0.3, -0.9, -0.3), new THREE.Vector3(0.3, 0.9, 0.3)),
      1,
    );

    result.clock.seek(1);
    expect(node.rig!.camera.position.x).toBeCloseTo(framed.position[0], 6);
    expect(node.rig!.camera.position.y).toBeCloseTo(framed.position[1], 6);
    expect(node.rig!.camera.position.z).toBeCloseTo(framed.position[2], 6);
    expect(node.rig!.camera.fov).toBeCloseTo(framed.fov, 6);
  });

  it('compiles a staggered glyph tween with start offsets 0, each and 2*each', () => {
    const values = [{ v: 0 }, { v: 0 }, { v: 0 }];
    const factory: NodeFactory = (layer, ctx, parentStart) => {
      const node = fakeThreeFactory(() => {})(layer, ctx, parentStart);
      node.resolveTargets = (target) => (target === 'glyphs:t' ? values.map((obj) => ({ obj, key: 'v', kind: 'number' as const })) : null);
      return node;
    };
    const doc = parse({
      version: 1,
      width: 100,
      height: 100,
      fps: 30,
      duration: 4,
      layers: [
        {
          id: 'l',
          type: 'three',
          width: 100,
          height: 100,
          objects: [{ id: 'box', geometry: { type: 'box', size: [1, 1, 1] } }],
          tweens: [{ target: 'glyphs:t', at: 0, duration: 1, ease: 'none', to: { 'offset.x': 10 }, stagger: { each: 0.5 } }],
        },
      ],
    });
    const result = assemble(doc, { ...baseCtx, factories: { three: factory } });
    result.clock.seek(0.5);
    expect(values[0].v).toBeCloseTo(5, 5);
    expect(values[1].v).toBeCloseTo(0, 5);
    expect(values[2].v).toBeCloseTo(0, 5);
    result.clock.seek(1);
    expect(values[0].v).toBeCloseTo(10, 5);
    expect(values[1].v).toBeCloseTo(5, 5);
    expect(values[2].v).toBeCloseTo(0, 5);
    result.destroy();
  });

  it('hands a soft-light layer the frame behind it and draws that frame first', () => {
    // The visibility of every stage child, as each render saw it.
    const frames: boolean[][] = [];
    const renderer = {
      render: vi.fn((scene: THREE.Scene) => {
        frames.push(scene.children.map((child) => child.visible));
      }),
      getRenderTarget: vi.fn(() => null),
      setRenderTarget: vi.fn(),
    } as unknown as THREE.WebGLRenderer;

    const doc = parse({
      version: 1,
      width: 100,
      height: 80,
      duration: 2,
      layers: [
        { id: 'plate', type: 'shape', shape: 'rect', width: 100, height: 80, start: 0, end: 2 },
        { id: 'grade', type: 'shape', shape: 'rect', width: 100, height: 80, start: 0, end: 2, blendMode: 'soft-light' },
        { id: 'caption', type: 'shape', shape: 'rect', width: 10, height: 10, start: 0, end: 2 },
      ],
    });

    const result = assemble(doc, { ...baseCtx, renderer });
    frames.length = 0;

    result.clock.seek(1);
    // The frame behind the grade, then the stage.
    expect(frames).toHaveLength(2);
    // The grade and everything drawn after it are left out of the frame behind the grade.
    expect(frames[0]).toEqual([true, false, false]);
    expect(frames[1]).toEqual([true, true, true]);

    const grade = result.nodes[1];
    const material = meshesOf(grade)[0].material as THREE.ShaderMaterial;
    expect(material.uniforms.uBackdrop.value).toBeInstanceOf(THREE.Texture);
    expect(material.uniforms.uStage.value.toArray()).toEqual([100, 80]);
    expect(material.uniforms.uAlpha.value).toBe(1);
  });

  it('warns about a soft-light layer that also has effects', () => {
    const fakeChain: EffectChain = {
      render: vi.fn(),
      setSize: vi.fn(),
      resolveTarget: vi.fn(() => null),
      dispose: vi.fn(),
      errors: [],
    };
    setEffectChainFactoryForTests(() => fakeChain);

    const doc = parse({
      version: 1,
      width: 100,
      height: 80,
      duration: 2,
      layers: [
        {
          id: 'grade',
          type: 'shape',
          shape: 'rect',
          width: 100,
          height: 80,
          start: 0,
          end: 2,
          blendMode: 'soft-light',
          effects: [{ id: 'g', type: 'glow' }],
        },
      ],
    });

    const result = assemble(doc, baseCtx);

    expect(result.warnings.join(' ')).toContain('a soft-light layer with effects is not supported');
  });
});
