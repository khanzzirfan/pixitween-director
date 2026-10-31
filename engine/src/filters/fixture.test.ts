/// <reference types="vite/client" />
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FILTER_2D_TYPES, type Filter2DType } from '../schema/enums';
import { parseMotionDoc } from '../schema/doc';
import type { MotionDoc } from '../schema/doc';
import type { Layer } from '../schema/layer';
import { buildFilters } from './build';
import { FILTERS } from './registry';

// GlitchFilter draws its displacement map onto a real 2D canvas; web/src/test-setup.ts stubs
// getContext to null, so give it a minimal recording double while these tests build filters.
const originalGetContext = HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => ({
    clearRect: () => {},
    fillRect: () => {},
    fillStyle: '',
  })) as never;
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

const fixtures = import.meta.glob('../../fixtures/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

function filters2d(): MotionDoc {
  const raw = fixtures['../../fixtures/filters-2d.json'];
  if (!raw) throw new Error('missing fixture filters-2d.json');
  const result = parseMotionDoc(raw);
  if (!result.ok) throw new Error(`filters-2d.json did not parse: ${JSON.stringify(result.errors)}`);
  return result.doc;
}

function flatten(layers: Layer[]): Layer[] {
  const out: Layer[] = [];
  for (const layer of layers) {
    out.push(layer);
    if (layer.type === 'group') out.push(...flatten(layer.children));
  }
  return out;
}

describe('filters-2d fixture', () => {
  it('parses with parseMotionDoc and uses all 15 filter types', () => {
    const doc = filters2d();
    const used = new Set<Filter2DType>();
    for (const filter of doc.filters) used.add(filter.type);
    for (const layer of flatten(doc.layers)) for (const filter of layer.filters) used.add(filter.type);

    expect([...used].sort()).toEqual([...FILTER_2D_TYPES].sort());
  });

  it('builds every layer and the stage with zero errors', () => {
    const doc = filters2d();
    const built = flatten(doc.layers).map((layer) => buildFilters(layer.filters));
    built.push(buildFilters(doc.filters));

    for (const result of built) expect(result.errors).toEqual([]);
    for (const result of built) result.destroy();
  });

  it('tweens one tweenable param per filter via filter:<id>', () => {
    const doc = filters2d();
    for (const layer of flatten(doc.layers)) {
      const declared = new Set(layer.filters.map((filter) => filter.id));
      const referenced = new Set<string>();

      for (const tween of layer.tweens) {
        if (!tween.target?.startsWith('filter:')) continue;
        const id = tween.target.slice('filter:'.length);
        referenced.add(id);

        const spec = layer.filters.find((filter) => filter.id === id);
        if (!spec) throw new Error(`layer "${layer.id}" tweens undeclared filter "${id}"`);
        const tweenable = FILTERS[spec.type].tweenable;
        for (const key of Object.keys(tween.to)) {
          expect(key in tweenable).toBe(true);
        }
      }

      expect(referenced).toEqual(declared);
    }
  });
});
