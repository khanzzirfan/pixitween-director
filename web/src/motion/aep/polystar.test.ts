// @vitest-environment node
// AEP polystar shapes -> MotionDoc polystar shapes. See engine/docs/10-aep-adapter.md ("Shapes").
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AepCompositionJson } from '@shared/aep/composition';
import type { AepLayer } from '@shared/aep/layer';
import { parseAepComposition } from '@shared/aep/parse';
import type { Layer } from '@engine/schema';
import { buildRetailClip } from '../../../../server/authoring/retail-clip';
import { aepToMotion } from './index';
import { convertShape } from './layers2d';

type AepShapeLayer = Extract<AepLayer, { kind: 'shape' }>;

/** An AEP shape layer with the given path, centred in a 1080x1920 comp. */
function shapeLayer(path: unknown): AepShapeLayer {
  return {
    kind: 'shape',
    id: 'clip:badge',
    inPoint: 0,
    outPoint: 120,
    path,
    fill: '#0a7a3d',
    transform: { position: [540, 960], anchor: [100, 100], scale: [1, 1], rotation: 0, opacity: 1 },
  } as unknown as AepShapeLayer;
}

const composition = (layer: AepLayer): AepCompositionJson =>
  ({
    id: 'c1',
    name: 'test',
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 120,
    bgColor: '#000000',
    assets: {},
    layers: [layer],
  }) as unknown as AepCompositionJson;

describe('convertShape: a polystar', () => {
  it('maps the AEP polystar to the engine polystar, with the size its outer radius twice over', () => {
    const { layer, warnings } = convertShape(
      shapeLayer({ kind: 'polystar', starType: 'star', points: 16, outerRadius: 100, innerRadius: 43 }),
      30,
    );

    expect(layer.shape).toBe('polystar');
    expect(layer.points).toBe(16);
    expect(layer.outerRadius).toBe(100);
    expect(layer.innerRadius).toBe(43);
    expect(layer.starType).toBe('star');
    expect(layer.width).toBe(200);
    expect(layer.height).toBe(200);
    expect(warnings).toEqual([]);
  });

  it('takes the first keyframe of a keyed point count and radius', () => {
    const { layer, warnings } = convertShape(
      shapeLayer({
        kind: 'polystar',
        starType: 'polygon',
        points: [{ t: 0, v: 6 }, { t: 30, v: 12 }],
        outerRadius: [{ t: 0, v: 80 }, { t: 30, v: 120 }],
      }),
      30,
    );

    expect(layer.points).toBe(6);
    expect(layer.outerRadius).toBe(80);
    expect(layer.starType).toBe('polygon');
    expect(warnings).toEqual([]);
  });

  it('names the layer when the star cannot be drawn as it is', () => {
    const { layer, warnings } = convertShape(
      shapeLayer({ kind: 'polystar', starType: 'star', points: 2, outerRadius: 100, innerRadius: 400 }),
      30,
    );

    expect(layer.points).toBe(3);
    expect(layer.innerRadius).toBe(100);
    expect(warnings.join(' ')).toContain('clip:badge');
    expect(warnings).toHaveLength(2);
  });

  it('says a polystar with its own rotation or roundness is not supported yet', () => {
    const { warnings } = convertShape(
      shapeLayer({ kind: 'polystar', starType: 'star', points: 16, outerRadius: 100, innerRadius: 43, rotation: 12, outerRoundness: 0.2 }),
      30,
    );

    expect(warnings.join(' ')).toContain('clip:badge');
    expect(warnings.join(' ')).toMatch(/rotation is not supported/);
    expect(warnings.join(' ')).toMatch(/roundness is not supported/);
  });

  it('puts the star in the doc when the whole composition is converted', () => {
    const { doc, warnings } = aepToMotion(
      composition(shapeLayer({ kind: 'polystar', starType: 'star', points: 16, outerRadius: 100, innerRadius: 43 })),
    );

    expect(warnings).toEqual([]);
    expect(doc.layers).toHaveLength(1);
    const star = doc.layers[0] as Extract<Layer, { type: 'shape' }>;
    expect(star.shape).toBe('polystar');
    expect(star.points).toBe(16);
    expect(star.outerRadius).toBe(100);
    expect(star.innerRadius).toBe(43);
    expect(star.width).toBe(200);
  });
});

describe('aepToMotion: the director films keep their stars', () => {
  const product = {
    id: 'ast_5f70b53ecd06e5ce73d07b8d26bd69f0',
    src: '/api/assets/ast_5f70b53ecd06e5ce73d07b8d26bd69f0',
    width: 256,
    height: 752,
  };
  const plate = {
    id: 'ast_e7b2d1aa618305df4333d651eef26655',
    src: '/api/assets/ast_e7b2d1aa618305df4333d651eef26655',
    width: 720,
    height: 1280,
  };
  const title = 'Coffee Co. Cold Brew 330ml';

  // The same build the demo script makes (scripts/retail-demo.ts), written to a temp file and read
  // back, so the film is walked as the player walks it.
  const clip = (look: 'price-promo' | 'ingredient-orbit') =>
    buildRetailClip({
      aspect: '9:16',
      look,
      plate,
      product,
      title,
      subtitle: '330 ml  |  Smooth, low acid',
      price: 4.5,
      wasPrice: 5.99,
      brand: 'Coffee Co.',
      accent: '#7a3b12',
      frame: false,
    });

  function convert(film: unknown): { doc: ReturnType<typeof aepToMotion>['doc']; warnings: string[] } {
    const dir = mkdtempSync(join(tmpdir(), 'pixitween-us004-'));
    const file = join(dir, 'retail-clip.json');
    writeFileSync(file, JSON.stringify(film, null, 2));
    const comp = parseAepComposition(JSON.parse(readFileSync(file, 'utf8')) as unknown);
    return aepToMotion(comp);
  }

  /** The stars the doc holds. */
  function stars(doc: { layers: Layer[] }): Array<Extract<Layer, { type: 'shape' }>> {
    const found: Array<Extract<Layer, { type: 'shape' }>> = [];
    const walk = (layers: Layer[]): void => {
      for (const layer of layers) {
        if (layer.type === 'shape' && layer.shape === 'polystar') found.push(layer);
        if (layer.type === 'group') walk(layer.children);
      }
    };
    walk(doc.layers);
    return found;
  }

  it('converts the price-promo look without dropping its shapes', () => {
    const { doc, warnings } = convert(clip('price-promo'));

    expect(warnings.filter((warning) => warning.includes('unsupported shape path'))).toEqual([]);
    // The light rays and the burst badge around the price.
    const found = stars(doc);
    expect(found).toHaveLength(2);
    expect(found.map((star) => star.points)).toEqual([14, 16]);
    expect(found.every((star) => star.starType === 'star')).toBe(true);
  });

  it('converts a burst price look without dropping its shapes', () => {
    const { doc, warnings } = convert(clip('ingredient-orbit'));

    expect(warnings.filter((warning) => warning.includes('unsupported shape path'))).toEqual([]);
    // The burst badge around the price.
    const found = stars(doc);
    expect(found).toHaveLength(1);
    expect(found[0].points).toBe(16);
  });
});
