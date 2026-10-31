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
    expect(parsed.filters).toEqual([]);
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

  it('rule 1: duplicate object and filter ids inside a layer', () => {
    const errors = mustFail(
      doc({
        filters: [
          { id: 'f', type: 'blur' },
          { id: 'f', type: 'glow' },
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
    expect(paths(errors)).toContain('filters[1].id');
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
