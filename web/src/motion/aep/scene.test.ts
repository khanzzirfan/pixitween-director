import { describe, expect, it } from 'vitest';
import type { AepLayer } from '@shared/aep/layer';
import type { AepCompositionJson } from '@shared/aep/composition';
import { convertLayers } from './scene';

const baseTransform = {
  position: [0, 0] as [number, number],
  anchor: [0, 0] as [number, number],
  scale: [1, 1] as [number, number],
  rotation: 0,
  opacity: 1,
};

function titleLayer(): AepLayer {
  return {
    kind: 'shape',
    id: 'title',
    inPoint: 0,
    outPoint: 120,
    path: { kind: 'rect', size: [10, 10] },
    transform: baseTransform,
  };
}

function bgLayer(): AepLayer {
  return {
    kind: 'shape',
    id: 'bg',
    inPoint: 0,
    outPoint: 120,
    path: { kind: 'rect', size: [10, 10] },
    transform: baseTransform,
  };
}

describe('convertLayers', () => {
  it('keeps the stored back-first order (bg first)', () => {
    const { layers, warnings } = convertLayers([bgLayer(), titleLayer()], {}, undefined, 30);
    expect(layers.map((l) => l.id)).toEqual(['bg', 'title']);
    expect(warnings).toHaveLength(0);
  });

  it('converts a precomp layer at inPoint 120..240 to a group with start 4, end 8, children starting at 0', () => {
    const precompLayer: AepLayer = {
      kind: 'precomp',
      id: 'scene1',
      inPoint: 120,
      outPoint: 240,
      compId: 'comp_scene1',
      width: 100,
      height: 100,
      transform: baseTransform,
    };
    const nested: AepCompositionJson = {
      version: '1.0.0',
      id: 'comp_scene1',
      width: 100,
      height: 100,
      fps: 30,
      durationInFrames: 120,
      layers: [bgLayer()],
      assets: {},
    };

    const { layers, warnings } = convertLayers([precompLayer], {}, { comp_scene1: nested }, 30);
    expect(warnings).toHaveLength(0);
    expect(layers).toHaveLength(1);
    const group = layers[0];
    expect(group.type).toBe('group');
    expect(group.start).toBe(4);
    expect(group.end).toBe(8);
    if (group.type === 'group') {
      expect(group.children).toHaveLength(1);
      expect(group.children[0].start).toBe(0);
    }
  });

  it('converts an audio layer at frames 0..720 with level 0.7 to one cue', () => {
    const audioLayer: AepLayer = {
      kind: 'audio',
      id: 'music',
      inPoint: 0,
      outPoint: 720,
      assetId: 'track',
      level: 0.7,
      transform: baseTransform,
    };
    const assets = { track: { type: 'audio' as const, src: '/api/assets/track.mp3' } };

    const { layers, audio, warnings } = convertLayers([audioLayer], assets, undefined, 30);
    expect(layers).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(audio).toHaveLength(1);
    expect(audio[0]).toMatchObject({ startSec: 0, endSec: 24, level: 0.7 });
  });

  it('converts a bare stage3d layer to one three layer without warnings', () => {
    const stage3dLayer: AepLayer = {
      kind: 'stage3d',
      id: 'world',
      inPoint: 0,
      outPoint: 120,
      viewport: { width: 100, height: 100 },
      camera: { position: [0, 0, 5], target: [0, 0, 0], fov: 50 },
      transform: baseTransform,
    };

    const { layers, warnings } = convertLayers([stage3dLayer], {}, undefined, 30);
    expect(layers).toHaveLength(1);
    expect(layers[0].type).toBe('three');
    expect(warnings).toHaveLength(0);
  });

  it('gives a precomp the rotation unit of its parent, unless it declares its own', () => {
    const precompLayer: AepLayer = {
      kind: 'precomp',
      id: 'scene1',
      inPoint: 0,
      outPoint: 120,
      compId: 'comp_scene1',
      width: 100,
      height: 100,
      transform: baseTransform,
    };
    const tilted = (rotation: number): AepLayer => ({
      kind: 'shape',
      id: 'tilted',
      inPoint: 0,
      outPoint: 120,
      path: { kind: 'rect', size: [10, 10] },
      transform: { ...baseTransform, rotation },
    });
    const nested = (): AepCompositionJson => ({
      version: '1.0.0',
      id: 'comp_scene1',
      width: 100,
      height: 100,
      fps: 30,
      durationInFrames: 120,
      layers: [tilted(22)],
      assets: {},
    });

    // The parent writes degrees, so the precomp inherits them.
    const inherited = convertLayers([precompLayer], {}, { comp_scene1: nested() }, 30, undefined, { rotationUnit: 'deg' });
    const inheritedChild = inherited.layers[0].type === 'group' ? inherited.layers[0].children[0] : undefined;
    expect(inheritedChild?.rotation).toBe(22);

    // The precomp declares radians for itself, so its own layer is converted.
    const own = convertLayers(
      [precompLayer],
      {},
      { comp_scene1: { ...nested(), meta: { rotationUnit: 'rad' } } },
      30,
      undefined,
      { rotationUnit: 'deg' },
    );
    const ownChild = own.layers[0].type === 'group' ? own.layers[0].children[0] : undefined;
    expect(ownChild?.rotation).toBeCloseTo(22 * (180 / Math.PI), 2);
  });
});
