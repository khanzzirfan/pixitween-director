// @vitest-environment node
// AEP soft-light -> the engine's soft-light blend. See engine/docs/10-aep-adapter.md ("Base transform").
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAepComposition } from '@shared/aep/parse';
import type { Layer } from '@engine/schema';
import { buildRetailClip } from '../../../../server/authoring/retail-clip';
import { LOOKS } from '../../../../server/authoring/looks';
import { aepToMotion } from './index';
import { mapBaseLayer, type AepBaseLayer } from './baseLayer';

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

/** The same build the demo script makes (scripts/retail-demo.ts), written to a temp file and read back. */
function convert(film: unknown): { doc: ReturnType<typeof aepToMotion>['doc']; warnings: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'pixitween-us005-'));
  const file = join(dir, 'retail-clip.json');
  writeFileSync(file, JSON.stringify(film, null, 2));
  const comp = parseAepComposition(JSON.parse(readFileSync(file, 'utf8')) as unknown);
  return aepToMotion(comp);
}

function retailClip(look: keyof typeof LOOKS) {
  return buildRetailClip({
    aspect: '9:16',
    look,
    plate,
    product,
    title: 'Coffee Co. Cold Brew 330ml',
    subtitle: '330 ml  |  Smooth, low acid',
    price: 4.5,
    wasPrice: 5.99,
    brand: 'Coffee Co.',
    accent: '#7a3b12',
    frame: false,
  });
}

/** The blend modes the doc's layers hold. */
function blendModes(doc: { layers: Layer[] }): string[] {
  const found: string[] = [];
  const walk = (layers: Layer[]): void => {
    for (const layer of layers) {
      found.push(layer.blendMode);
      if (layer.type === 'group') walk(layer.children);
    }
  };
  walk(doc.layers);
  return found;
}

describe('mapBaseLayer: soft light', () => {
  it('passes soft-light through without a warning', () => {
    const layer: AepBaseLayer = {
      id: 'grade',
      inPoint: 0,
      outPoint: 90,
      transform: {
        position: [0, 0],
        anchor: [0, 0],
        scale: [1, 1],
        rotation: 0,
        opacity: 0.5,
      },
      blendMode: 'soft-light',
    };

    const { base, warnings } = mapBaseLayer(layer, 30);

    expect(base.blendMode).toBe('soft-light');
    expect(warnings).toEqual([]);
  });
});

describe('aepToMotion: the director films keep their soft-light grade', () => {
  const looks = Object.keys(LOOKS) as Array<keyof typeof LOOKS>;
  // A look with no grade (opacity 0) writes no grade layer at all.
  const graded = looks.filter((look) => LOOKS[look].grade.opacity > 0);

  it('covers every look', () => {
    expect(looks.length).toBeGreaterThanOrEqual(6);
    expect(graded.length).toBeGreaterThanOrEqual(4);
  });

  for (const look of looks) {
    it(`converts the ${look} look without warning about its soft-light grade`, () => {
      const { doc, warnings } = convert(retailClip(look));

      expect(warnings.filter((warning) => warning.includes("unsupported blendMode 'soft-light'"))).toEqual([]);
      if (LOOKS[look].grade.opacity > 0) {
        // The look's grade is a full-frame layer that blends soft-light.
        expect(blendModes(doc)).toContain('soft-light');
      }
    });
  }
});
