import { describe, expect, it } from 'vitest';
import { parseMotionDoc } from './doc';
import type { MotionDocError } from './doc';

function doc(overrides: Record<string, unknown> = {}): unknown {
  return {
    version: 1,
    width: 1920,
    height: 1080,
    duration: 6,
    assets: {
      plate: { type: 'image', url: '/plate.png' },
      can: { type: 'gltf', url: '/can.glb' },
    },
    layers: [{ id: 'bg', type: 'image', asset: 'plate' }],
    ...overrides,
  };
}

function mustParse(input: unknown) {
  const result = parseMotionDoc(input);
  if (!result.ok) throw new Error(`expected ok true, got errors: ${JSON.stringify(result.errors)}`);
  return result.doc;
}

function mustFail(input: unknown): MotionDocError[] {
  const result = parseMotionDoc(input);
  if (result.ok) throw new Error('expected ok false');
  return result.errors;
}

const paths = (errors: MotionDocError[]) => errors.map((error) => error.path);

describe('parseMotionDoc', () => {
  it('parses a valid doc and fills the defaults', () => {
    const parsed = mustParse(doc());
    expect(parsed.fps).toBe(30);
    expect(parsed.background).toBe('#000000');
    expect(parsed.effects).toEqual([]);
    expect(parsed.assets.plate).toEqual({ type: 'image', url: '/plate.png' });
    expect(parsed.layers).toHaveLength(1);
    expect(parsed.layers[0].end).toBe(6);
  });

  it('never throws on null, a string or an array', () => {
    for (const input of [null, 'nope', [], 42]) {
      const errors = mustFail(input);
      expect(errors.length).toBeGreaterThan(0);
      expect(typeof errors[0].path).toBe('string');
      expect(typeof errors[0].message).toBe('string');
    }
  });
});

describe('cross-field rules', () => {
  it('rule 1: duplicate layer ids point at the second id', () => {
    const errors = mustFail(
      doc({
        layers: [
          { id: 'a', type: 'image', asset: 'plate' },
          { id: 'a', type: 'image', asset: 'plate' },
        ],
      }),
    );
    expect(paths(errors)).toContain('layers[1].id');
  });

  it('rule 1: duplicate object and effect ids inside a layer', () => {
    const errors = mustFail(
      doc({
        effects: [
          { id: 'f', type: 'blur' },
          { id: 'f', type: 'vignette' },
        ],
        layers: [
          {
            id: 'h',
            type: 'three',
            width: 512,
            height: 512,
            objects: [
              { id: 'o', geometry: { type: 'box', size: [1, 1, 1] } },
              { id: 'o', geometry: { type: 'box', size: [1, 1, 1] } },
            ],
          },
        ],
      }),
    );
    expect(paths(errors)).toContain('effects[1].id');
    expect(paths(errors)).toContain('layers[0].objects[1].id');
  });

  it('rule 2: an image layer pointing at a gltf asset', () => {
    const errors = mustFail(doc({ layers: [{ id: 'bg', type: 'image', asset: 'can' }] }));
    expect(paths(errors)).toContain('layers[0].asset');
  });

  it('rule 2: a gltf object pointing at an image asset', () => {
    const errors = mustFail(
      doc({
        layers: [
          {
            id: 'h',
            type: 'three',
            width: 512,
            height: 512,
            objects: [{ id: 'o', geometry: { type: 'gltf', asset: 'plate' } }],
          },
        ],
      }),
    );
    expect(paths(errors)).toContain('layers[0].objects[0].geometry.asset');
  });

  it('rule 2: an unknown asset', () => {
    const errors = mustFail(doc({ layers: [{ id: 'bg', type: 'image', asset: 'missing' }] }));
    expect(paths(errors)).toContain('layers[0].asset');
  });

  it('rule 3: end must be greater than start', () => {
    const errors = mustFail(doc({ layers: [{ id: 'bg', type: 'image', asset: 'plate', start: 3, end: 3 }] }));
    expect(paths(errors)).toContain('layers[0].end');
  });

  it('rule 3: a child end past its group length', () => {
    const errors = mustFail(
      doc({
        layers: [
          {
            id: 'g',
            type: 'group',
            start: 0,
            end: 2,
            children: [{ id: 'c', type: 'image', asset: 'plate', start: 0, end: 3 }],
          },
        ],
      }),
    );
    expect(paths(errors)).toContain('layers[0].children[0].end');
  });

  it('rule 4: a top-level end after the duration', () => {
    const errors = mustFail(doc({ layers: [{ id: 'bg', type: 'image', asset: 'plate', end: 7 }] }));
    expect(paths(errors)).toContain('layers[0].end');
  });

  it('rule 4: a missing end defaults to the duration', () => {
    const parsed = mustParse(doc());
    expect(parsed.layers[0].end).toBe(6);
  });

  it('rule 5: a repeated tween past the layer length', () => {
    const layer = (repeat: number) => ({
      id: 'bg',
      type: 'image',
      asset: 'plate',
      start: 0,
      end: 5,
      tweens: [{ at: 4, duration: 1, repeat, to: { alpha: 0 } }],
    });
    const errors = mustFail(doc({ layers: [layer(1)] }));
    expect(paths(errors)).toContain('layers[0].tweens[0]');
    const parsed = mustParse(doc({ layers: [layer(0)] }));
    expect(parsed.layers[0].tweens[0].repeat).toBe(0);
  });

  it('rule 6: enter plus exit longer than the layer', () => {
    const errors = mustFail(
      doc({
        layers: [
          {
            id: 'bg',
            type: 'image',
            asset: 'plate',
            start: 0,
            end: 1,
            enter: { name: 'fadeIn' },
            exit: { name: 'fadeOut' },
          },
        ],
      }),
    );
    expect(paths(errors)).toContain('layers[0].enter');
  });

  it('rule 7: more than 200 layers', () => {
    const layers = Array.from({ length: 201 }, (_, index) => ({ id: `l${index}`, type: 'image', asset: 'plate' }));
    const errors = mustFail(doc({ layers }));
    expect(paths(errors)).toContain('layers');
  });

  it('rule 7: a group nested more than four deep', () => {
    const errors = mustFail(
      doc({
        layers: [
          {
            id: 'g1',
            type: 'group',
            children: [
              {
                id: 'g2',
                type: 'group',
                children: [
                  {
                    id: 'g3',
                    type: 'group',
                    children: [
                      {
                        id: 'g4',
                        type: 'group',
                        children: [
                          {
                            id: 'g5',
                            type: 'group',
                            children: [{ id: 'leaf', type: 'image', asset: 'plate' }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(paths(errors)).toContain('layers[0].children[0].children[0].children[0].children[0]');
  });

  it('rule 8: a loop target on an image layer', () => {
    const errors = mustFail(
      doc({ layers: [{ id: 'bg', type: 'image', asset: 'plate', loop: { name: 'spin', target: 'object:can' } }] }),
    );
    expect(paths(errors)).toContain('layers[0].loop.target');
  });

  it('rule 8: a loop target on a three layer with the object', () => {
    const parsed = mustParse(
      doc({
        layers: [
          {
            id: 'h',
            type: 'three',
            width: 512,
            height: 512,
            objects: [{ id: 'can', geometry: { type: 'box', size: [1, 1, 1] } }],
            loop: { name: 'spin', target: 'object:can' },
          },
        ],
      }),
    );
    if (parsed.layers[0].type !== 'three') throw new Error('expected a three layer');
    expect(parsed.layers[0].loop?.target).toBe('object:can');
  });

  it('rule 8: a loop target that names a missing object', () => {
    const errors = mustFail(
      doc({
        layers: [
          {
            id: 'h',
            type: 'three',
            width: 512,
            height: 512,
            objects: [{ id: 'box', geometry: { type: 'box', size: [1, 1, 1] } }],
            loop: { name: 'spin', target: 'object:can' },
          },
        ],
      }),
    );
    expect(paths(errors)).toContain('layers[0].loop.target');
  });

  it('rule 8: a target on enter or exit is rejected', () => {
    const errors = mustFail(
      doc({ layers: [{ id: 'bg', type: 'image', asset: 'plate', enter: { name: 'fadeIn', target: 'object:can' } }] }),
    );
    expect(paths(errors)).toContain('layers[0].enter.target');
  });
});

describe('camera rules', () => {
  const threeLayer = (overrides: Record<string, unknown> = {}) => ({
    id: 'h',
    type: 'three',
    width: 512,
    height: 512,
    objects: [{ id: 'can', geometry: { type: 'box', size: [0.6, 1.8, 0.6] } }],
    ...overrides,
  });

  const path = {
    keys: [
      { t: 0, position: [0, 1, 6], lookAt: [0, 0.6, 0] },
      { t: 1, position: [2, 3, 4], lookAt: [1, 1, 0] },
    ],
  };

  it('parses a shot and a path', () => {
    const parsed = mustParse(doc({ layers: [threeLayer({ camera: { shot: { subject: 'object:can', size: 'closeUp' } } })] }));
    const layer = parsed.layers[0];
    if (layer.type !== 'three') throw new Error('expected a three layer');
    expect(layer.camera.shot?.size).toBe('closeUp');
    expect(layer.camera.path).toBeUndefined();

    const withPath = mustParse(doc({ layers: [threeLayer({ camera: { path } })] }));
    const pathLayer = withPath.layers[0];
    if (pathLayer.type !== 'three') throw new Error('expected a three layer');
    expect(pathLayer.camera.path?.curve).toBe('smooth');
    expect(pathLayer.camera.path?.keys).toHaveLength(2);
  });

  it('rule: a path and a camera position tween is an error', () => {
    const errors = mustFail(
      doc({
        layers: [
          threeLayer({
            camera: { path },
            tweens: [{ target: 'camera', at: 0, duration: 1, to: { 'position.z': 2 } }],
          }),
        ],
      }),
    );
    expect(paths(errors)).toContain('layers[0].camera.path');
  });

  it('rule: a path and a camera lookAt tween is an error', () => {
    const errors = mustFail(
      doc({
        layers: [
          threeLayer({
            camera: { path },
            tweens: [{ target: 'camera', at: 0, duration: 1, to: { 'lookAt.y': 1 } }],
          }),
        ],
      }),
    );
    expect(paths(errors)).toContain('layers[0].camera.path');
  });

  it('rule: a path key after the layer is an error', () => {
    const errors = mustFail(
      doc({
        layers: [
          threeLayer({
            end: 1,
            camera: {
              path: {
                keys: [
                  { t: 0, position: [0, 1, 6], lookAt: [0, 0.6, 0] },
                  { t: 3, position: [2, 3, 4], lookAt: [1, 1, 0] },
                ],
              },
            },
          }),
        ],
      }),
    );
    expect(paths(errors)).toContain('layers[0].camera.path.keys[1].t');
  });

  it('rule: a shot subject that names no object of the layer is an error', () => {
    const errors = mustFail(
      doc({ layers: [threeLayer({ camera: { shot: { subject: 'object:nope', size: 'wide' } } })] }),
    );
    expect(paths(errors)).toContain('layers[0].camera.shot.subject');
  });

  it('parses a camera preset with a shot on a three layer', () => {
    const parsed = mustParse(
      doc({
        layers: [
          threeLayer({
            end: 6,
            enter: { name: 'cameraTo', params: { shot: { subject: 'object:can', size: 'medium' } } },
            loop: { name: 'orbit', params: { degrees: 45 } },
          }),
        ],
      }),
    );
    const layer = parsed.layers[0];
    if (layer.type !== 'three') throw new Error('expected a three layer');
    expect(layer.enter?.name).toBe('cameraTo');
    expect(layer.loop?.name).toBe('orbit');
  });

  it('rule: a camera preset on a layer without a camera is an error', () => {
    const errors = mustFail(doc({ layers: [{ id: 'i', type: 'image', asset: 'a', enter: { name: 'crane' } }] }));
    expect(paths(errors)).toContain('layers[0].enter.name');
  });

  it('rule: cameraTo without a shot is an error', () => {
    const errors = mustFail(doc({ layers: [threeLayer({ enter: { name: 'cameraTo' } })] }));
    expect(paths(errors)).toContain('layers[0].enter.params.shot');
  });
});

describe('effects scope rules', () => {
  const text = (effects: unknown[]) => ({ id: 't', type: 'text', text: 'hi', effects });
  const three = (effects: unknown[]) => ({ id: 'h', type: 'three', width: 64, height: 64, objects: [{ id: 'o', geometry: { type: 'box', size: [1, 1, 1] } }], effects });

  it('accepts a glow on a text layer with enabled true', () => {
    const parsed = mustParse(doc({ layers: [text([{ id: 'g', type: 'glow' }])] }));
    const layer = parsed.layers[0];
    expect(layer.effects[0]).toEqual({ id: 'g', type: 'glow', enabled: true, params: {} });
  });

  it('rejects a glow on a three layer and a dof on a 2D layer', () => {
    expect(paths(mustFail(doc({ layers: [three([{ id: 'g', type: 'glow' }])] })))).toContain('layers[0].effects[0].type');
    expect(paths(mustFail(doc({ layers: [text([{ id: 'd', type: 'dof' }])] })))).toContain('layers[0].effects[0].type');
  });

  it('accepts dof and bloom on a three layer', () => {
    mustParse(doc({ layers: [three([{ id: 'd', type: 'dof' }, { id: 'b', type: 'bloom' }])] }));
  });

  it('accepts a doc-level vignette and rejects a doc-level outline', () => {
    mustParse(doc({ effects: [{ id: 'v', type: 'vignette' }] }));
    expect(paths(mustFail(doc({ effects: [{ id: 'o', type: 'outline' }] })))).toContain('effects[0].type');
  });
});
