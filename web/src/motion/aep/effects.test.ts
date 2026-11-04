// @vitest-environment node
// AEP layer effects -> MotionDoc layer effects. See engine/docs/10-aep-adapter.md ("Effects").
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AepCompositionJson } from '@shared/aep/composition';
import type { AepEffect } from '@shared/aep/effect';
import type { AepLayer } from '@shared/aep/layer';
import { parseAepComposition } from '@shared/aep/parse';
import type { Layer, MotionDoc } from '@engine/schema';
import { buildRetailClip } from '../../../../server/authoring/retail-clip';
import { buildVariantFilm } from '../../../../server/authoring/variant-film';
import { pickLook, type LookId } from '../../../../server/authoring/looks';
import { aepToMotion } from './index';
import { convertEffects, engineAngle, stageScale } from './effects';

const COMP = { width: 1080, height: 1920 };

/** The offset the engine's drop shadow puts the shadow at, in doc space (y down). */
function docOffset(angleDeg: number, distance: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: distance * Math.cos(rad), y: distance * Math.sin(rad) };
}

function effectsOf(...names: string[]): AepEffect[] {
  return names.map((name) => ({ name, params: {} }) as unknown as AepEffect);
}

describe('convertEffects', () => {
  it("maps drop-shadow to the engine's dropShadow, with the distance scaled from the player's 960 px stage to the comp", () => {
    const warnings: string[] = [];
    const converted = convertEffects(
      's1:product',
      [{ name: 'drop-shadow', params: { distance: 40, direction: 180, softness: 30, opacity: 0.5, color: '#000000' } }],
      COMP,
      warnings,
    );

    expect(converted).toHaveLength(1);
    expect(converted[0].type).toBe('dropShadow');
    expect(converted[0].enabled).toBe(true);
    expect(converted[0].params.alpha).toBe(0.5);
    expect(converted[0].params.color).toBe('#000000');
    // The player measured the distance on its 960 px stage; the comp is 1920 px tall.
    expect(converted[0].params.distance).toBe(40 * stageScale(COMP));
    expect(warnings).toEqual([]);
  });

  it('puts a direction-180 shadow below the layer', () => {
    const warnings: string[] = [];
    const [shadow] = convertEffects(
      's1:product',
      [{ name: 'drop-shadow', params: { distance: 40, direction: 180, softness: 30, opacity: 0.5, color: '#000000' } }],
      COMP,
      warnings,
    );

    const angle = shadow.params.angle as number;
    const distance = shadow.params.distance as number;
    const offset = docOffset(angle, distance);
    expect(offset.y).toBeGreaterThan(0); // down in doc space
    expect(Math.abs(offset.x)).toBeLessThan(1e-6);
  });

  it("maps gaussian-blur to the engine's gaussianBlur, scaled the same way", () => {
    const warnings: string[] = [];
    const converted = convertEffects('s1:bg', [{ name: 'gaussian-blur', params: { blurriness: 88.32 } }], COMP, warnings);

    expect(converted).toEqual([
      { id: 'fx0', type: 'gaussianBlur', enabled: true, params: { strength: 88.32 * stageScale(COMP) } },
    ]);
    expect(warnings).toEqual([]);
  });

  it("maps glow to the engine's glow", () => {
    const warnings: string[] = [];
    const converted = convertEffects(
      's1:halo',
      [{ name: 'glow', params: { radius: 12, intensity: 3, opacity: 0.5, color: '#ff0000' } }],
      COMP,
      warnings,
    );

    expect(converted[0].type).toBe('glow');
    expect(converted[0].params).toEqual({ color: '#ff0000', strength: 1.5, distance: 12 * stageScale(COMP) });
    expect(warnings).toEqual([]);
  });

  it("maps brightness-contrast and hue-saturation to the engine's own effects", () => {
    const warnings: string[] = [];
    const converted = convertEffects(
      's1:grade',
      [
        { name: 'brightness-contrast', params: { brightness: 0.2, contrast: 0.3 } },
        { name: 'hue-saturation', params: { 'master-hue': 30, 'master-saturation': 50 } },
      ],
      COMP,
      warnings,
    );

    expect(converted.map((effect) => effect.type)).toEqual(['brightnessContrast', 'hueSaturation']);
    expect(converted[0].params).toEqual({ brightness: 0.2, contrast: 0.3 });
    expect(converted[1].params).toEqual({ hue: 30, saturation: 0.5 });
    expect(warnings).toEqual([]);
  });

  it('keeps the order of the effects on a layer and their ids apart', () => {
    const warnings: string[] = [];
    const converted = convertEffects(
      's1:product',
      [
        { name: 'gaussian-blur', params: { blurriness: 4 } },
        { name: 'drop-shadow', params: { distance: 8, direction: 180, softness: 4, opacity: 0.4, color: '#000000' } },
      ],
      COMP,
      warnings,
    );

    expect(converted.map((effect) => effect.id)).toEqual(['fx0', 'fx1']);
    expect(converted.map((effect) => effect.type)).toEqual(['gaussianBlur', 'dropShadow']);
    expect(warnings).toEqual([]);
  });

  it('keeps a disabled effect disabled', () => {
    const warnings: string[] = [];
    const converted = convertEffects(
      's1:product',
      [{ name: 'drop-shadow', enabled: false, params: { distance: 8, direction: 180 } }],
      COMP,
      warnings,
    );

    expect(converted[0].enabled).toBe(false);
  });

  it('names the layer in the warning for an effect the engine has no counterpart for', () => {
    const warnings: string[] = [];
    const converted = convertEffects('s1:product', effectsOf('levels'), COMP, warnings);

    expect(converted).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('s1:product');
    expect(warnings[0]).toContain('levels');
  });

  it('says a keyframed param is not animated yet and keeps its first value', () => {
    const warnings: string[] = [];
    const converted = convertEffects(
      's1:bg',
      [{ name: 'gaussian-blur', params: { blurriness: [{ t: 0, v: 6 }, { t: 30, v: 20 }] } }],
      COMP,
      warnings,
    );

    expect(converted[0].params.strength).toBe(6 * stageScale(COMP));
    expect(warnings.join(' ')).toMatch(/animated gaussian-blur blurriness is not supported yet/);
  });
});

describe('engineAngle', () => {
  it('turns the AEP direction (clockwise from up) into the engine angle (clockwise from the right)', () => {
    expect(engineAngle(180)).toBe(90); // down
    expect(engineAngle(90)).toBe(0); // right
    expect(engineAngle(270)).toBe(180); // left
    expect(engineAngle(135)).toBe(45); // down-right, the upstream default
  });
});

describe('aepToMotion', () => {
  const composition = (layer: AepLayer): AepCompositionJson =>
    ({
      id: 'c1',
      name: 'test',
      width: COMP.width,
      height: COMP.height,
      fps: 30,
      durationInFrames: 90,
      bgColor: '#000000',
      assets: { ast_1: { type: 'image', src: '/api/assets/ast_1', width: 256, height: 752 } },
      layers: [layer],
    }) as unknown as AepCompositionJson;

  it('warns about an unsupported effect and still returns a valid doc', () => {
    const layer = {
      kind: 'image',
      id: 's1:product',
      inPoint: 0,
      outPoint: 90,
      assetId: 'ast_1',
      effects: [{ name: 'levels', params: { 'input-black': 0 } }],
      transform: { position: [540, 960], anchor: [128, 376], scale: [1, 1], rotation: 0, opacity: 1 },
    } as unknown as AepLayer;

    const { doc, warnings } = aepToMotion(composition(layer));

    expect(doc.layers).toHaveLength(1);
    expect(warnings.some((warning) => warning.includes('s1:product') && warning.includes('levels'))).toBe(true);
  });

  it('puts an image layer\'s drop shadow in the layer effects', () => {
    const layer = {
      kind: 'image',
      id: 's1:product',
      inPoint: 0,
      outPoint: 90,
      assetId: 'ast_1',
      effects: [{ name: 'drop-shadow', params: { distance: 40, direction: 180, softness: 30, opacity: 0.5, color: '#000000' } }],
      transform: { position: [540, 960], anchor: [128, 376], scale: [1, 1], rotation: 0, opacity: 1 },
    } as unknown as AepLayer;

    const { doc, warnings } = aepToMotion(composition(layer));
    const image = doc.layers[0] as Extract<Layer, { type: 'image' }>;

    expect(image.effects).toHaveLength(1);
    expect(image.effects[0].type).toBe('dropShadow');
    expect(image.effects[0].params.alpha).toBe(0.5);
    expect(image.effects[0].params.distance).toBe(40 * stageScale(COMP));
    expect(warnings).toEqual([]);
  });
});

/** The AEP side: how many effects of a name a layer kind holds. */
function aepEffectCounts(comp: AepCompositionJson): Map<string, number> {
  const counts = new Map<string, number>();
  const walk = (layers: AepLayer[], precomps: Record<string, AepCompositionJson> | undefined): void => {
    for (const layer of layers) {
      for (const effect of 'effects' in layer ? (layer.effects ?? []) : []) {
        const key = `${layer.kind}:${effect.name}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    for (const nested of Object.values(precomps ?? {})) walk(nested.layers, nested.precomps);
  };
  walk(comp.layers, comp.precomps);
  return counts;
}

/** The MotionDoc side: how many effects of a type a layer kind holds. */
function docEffectCounts(doc: MotionDoc): Map<string, number> {
  const counts = new Map<string, number>();
  const walk = (layers: Layer[]): void => {
    for (const layer of layers) {
      for (const effect of layer.effects) {
        const key = `${layer.type}:${effect.type}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      if (layer.type === 'group') walk(layer.children);
    }
  };
  walk(doc.layers);
  return counts;
}

/** The AEP effect name -> the engine effect type it becomes. */
const ENGINE_EFFECT: Record<string, string> = {
  'drop-shadow': 'dropShadow',
  'gaussian-blur': 'gaussianBlur',
  glow: 'glow',
  'brightness-contrast': 'brightnessContrast',
  'hue-saturation': 'hueSaturation',
};

describe('the director films keep their effects', () => {
  // The same builds the demo scripts make (scripts/variant-demo.ts, scripts/retail-demo.ts), written
  // to a temp file and read back, so the test walks the film as the player does.
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

  const films: { name: string; film: unknown; imageEffects: { dropShadow: number; gaussianBlur: number } }[] = [
    {
      name: 'variant-film.json',
      // One act per variant, and every act's pack carries the shadow.
      imageEffects: { dropShadow: 3, gaussianBlur: 0 },
      film: buildVariantFilm({
        aspect: '9:16',
        brand: 'Coffee Co.',
        tagline: 'Pick your cold brew',
        accent: '#7a3b12',
        variants: [
          { product, name: 'Original', color: '#3b2314', price: 4.5 },
          { product, name: 'Vanilla Cream', color: '#e8c872', price: 4.75 },
          { product, name: 'Mocha', color: '#a0522d', price: 4.75 },
        ],
        music: { id: 'bed', src: '/cartoon/bed.wav', level: 0.6 },
      }),
    },
    {
      name: 'retail-clip.json',
      // The pack carries the shadow, the plate the blur.
      imageEffects: { dropShadow: 1, gaussianBlur: 1 },
      film: buildRetailClip({
        aspect: '9:16',
        look: pickLook({ title, category: 'beverage', width: product.width, height: product.height }).look as LookId,
        plate,
        product,
        title,
        subtitle: '330 ml  |  Smooth, low acid',
        price: 4.5,
        brand: 'Coffee Co.',
        accent: '#7a3b12',
        frame: false,
      }),
    },
  ];

  for (const { name, film, imageEffects } of films) {
    it(`${name} converts with the same effects on its layers as the AEP holds`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'pixitween-us003-'));
      const file = join(dir, name);
      writeFileSync(file, JSON.stringify(film, null, 2));
      const comp = parseAepComposition(JSON.parse(readFileSync(file, 'utf8')) as unknown);

      const { doc } = aepToMotion(comp);
      const aepCounts = aepEffectCounts(comp);
      const docCounts = docEffectCounts(doc);

      // Every effect the AEP holds on an image or shape layer is an effect on the same layer of the doc.
      for (const [key, count] of aepCounts) {
        const [kind, name] = key.split(':');
        if (kind !== 'image' && kind !== 'shape') continue;
        const engineType = ENGINE_EFFECT[name];
        expect(engineType, `${key} has no engine effect`).toBeDefined();
        expect(docCounts.get(`${kind}:${engineType}`) ?? 0).toBe(count);
      }

      // The image layers hold the effects the story names, the same number as on the AEP side.
      expect(aepCounts.get('image:drop-shadow') ?? 0).toBe(imageEffects.dropShadow);
      expect(aepCounts.get('image:gaussian-blur') ?? 0).toBe(imageEffects.gaussianBlur);
      expect(docCounts.get('image:dropShadow') ?? 0).toBe(imageEffects.dropShadow);
      expect(docCounts.get('image:gaussianBlur') ?? 0).toBe(imageEffects.gaussianBlur);
      expect(imageEffects.dropShadow).toBeGreaterThan(0);

      // A text layer's shadow lives in the text style, not in the layer's effects.
      const aepTextShadows = aepCounts.get('text:drop-shadow') ?? 0;
      const docTextShadows = countTextShadows(doc);
      expect(docTextShadows).toBe(aepTextShadows);
    });
  }
});

function countTextShadows(doc: MotionDoc): number {
  let count = 0;
  const walk = (layers: Layer[]): void => {
    for (const layer of layers) {
      if (layer.type === 'text' && layer.style.dropShadow) count += 1;
      if (layer.type === 'group') walk(layer.children);
    }
  };
  walk(doc.layers);
  return count;
}
