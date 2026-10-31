/// <reference types="vite/client" />
import { afterEach, describe, expect, it } from 'vitest';
import { MotionClock } from '../core/clock';
import { parseMotionDoc } from '../schema/doc';
import type { MotionDoc } from '../schema/doc';
import type { Layer } from '../schema/layer';
import { compileTweens, expandPresets, primeTimeline, validateTargets } from './index';
import type { PresetBase, PresetContext, Resolve } from './index';

const DEG_TO_RAD = Math.PI / 180;

/** The default duration of the `fadeInUp` enter preset (engine/docs/02-timeline.md, "Presets"). */
const FADE_IN_UP_DURATION = 0.7;

const clocks: MotionClock[] = [];

afterEach(() => {
  for (const clock of clocks.splice(0)) clock.destroy();
});

/** A fake 2D node: `rotation` is in radians, exactly as the runtime's display stores it. */
interface FakeNode {
  x: number;
  y: number;
  alpha: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

interface Compiled {
  layer: Layer;
  node: FakeNode;
  start: number;
}

/** The tweenable layer properties the presets use, and the unit each one is in. */
const NUMERIC_PROPS: Record<string, 'number' | 'deg'> = {
  x: 'number',
  y: 'number',
  alpha: 'number',
  rotation: 'deg',
  scaleX: 'number',
  scaleY: 'number',
};

function baseOf(layer: Layer): PresetBase {
  const [scaleX, scaleY] = typeof layer.scale === 'number' ? [layer.scale, layer.scale] : layer.scale;
  return { x: layer.x, y: layer.y, alpha: layer.alpha, rotation: layer.rotation, scaleX, scaleY };
}

function makeNode(layer: Layer): FakeNode {
  const base = baseOf(layer);
  return {
    x: base.x,
    y: base.y,
    alpha: base.alpha,
    rotation: base.rotation * DEG_TO_RAD,
    scaleX: base.scaleX,
    scaleY: base.scaleY,
  };
}

/** The layer's local bounds × scale, as `MotionNode.size()` reports them (offline approximation). */
function localSize(layer: Layer): { width: number; height: number } {
  switch (layer.type) {
    case 'shape':
      return { width: layer.width, height: layer.height };
    case 'image':
      return { width: layer.width ?? 0, height: layer.height ?? 0 };
    case 'text':
      return { width: 0, height: layer.style.fontSize };
    default:
      return { width: 0, height: 0 };
  }
}

function resolverFor(node: FakeNode): Resolve {
  return (target, prop) => {
    if (target !== undefined) return null;
    const kind = NUMERIC_PROPS[prop];
    if (!kind) return null;
    return { obj: node, key: prop, kind };
  };
}

const fixtures = import.meta.glob('../../fixtures/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

function fixture(name: string): unknown {
  const raw = fixtures[`../../fixtures/${name}`];
  if (!raw) throw new Error(`missing fixture ${name}`);
  return raw;
}

function parse(raw: unknown): MotionDoc {
  const result = parseMotionDoc(raw);
  if (!result.ok) throw new Error(`did not parse: ${JSON.stringify(result.errors)}`);
  return result.doc;
}

/** Compiles every layer (and group child) of `doc` onto one clock and primes it, as the runtime does. */
function compileFixture(doc: MotionDoc): { clock: MotionClock; compiled: Compiled[]; errors: string[] } {
  const clock = new MotionClock({ duration: doc.duration, fps: doc.fps });
  clocks.push(clock);
  const compiled: Compiled[] = [];
  const errors: string[] = [];

  const walk = (layers: Layer[], parentStart: number): void => {
    for (const layer of layers) {
      const start = parentStart + layer.start;
      const node = makeNode(layer);
      compiled.push({ layer, node, start });

      const ctx: PresetContext = {
        base: baseOf(layer),
        size: localSize(layer),
        stage: { width: doc.width, height: doc.height },
        layerLength: (layer.end ?? doc.duration) - layer.start,
      };
      const expanded = expandPresets(layer, ctx);
      errors.push(...expanded.errors);
      const result = compileTweens(clock.timeline, [...expanded.tweens, ...layer.tweens], {
        layerStart: start,
        resolve: resolverFor(node),
        layerId: layer.id,
      });
      errors.push(...result.errors);

      if (layer.type === 'group') walk(layer.children, start);
    }
  };

  walk(doc.layers, 0);
  primeTimeline(clock.timeline, 0);
  return { clock, compiled, errors };
}

describe('basic-2d fixture', () => {
  it('compiles the whole fixture with zero compile and target errors', () => {
    const doc = parse(fixture('basic-2d.json'));
    expect(validateTargets(doc)).toEqual([]);

    const { compiled, errors } = compileFixture(doc);
    expect(errors).toEqual([]);
    expect(compiled.map((entry) => entry.layer.id)).toEqual(['bg', 'product', 'title', 'badge', 'hero', 'chip', 'chip-label']);
  });

  it('starts an enter-preset layer transparent and lands on its base alpha after the enter duration', () => {
    const doc = parse(fixture('basic-2d.json'));
    const { clock, compiled } = compileFixture(doc);
    const product = compiled.find((entry) => entry.layer.id === 'product');
    if (!product) throw new Error('basic-2d has no product layer');
    const base = baseOf(product.layer);
    expect(base.alpha).toBe(1);

    clock.seek(product.start);
    expect(product.node.alpha).toBe(0);

    clock.seek(product.start + FADE_IN_UP_DURATION);
    expect(product.node.alpha).toBeCloseTo(base.alpha, 6);
  });

  it('is deterministic: 40 %, then 0, then 40 % again gives identical values on every fake node', () => {
    const doc = parse(fixture('basic-2d.json'));
    const { clock, compiled } = compileFixture(doc);
    const snapshot = (): Record<string, FakeNode> =>
      Object.fromEntries(compiled.map(({ layer, node }) => [layer.id, { ...node }]));

    clock.seek(doc.duration * 0.4);
    const at40 = snapshot();
    clock.seek(0);
    clock.seek(doc.duration * 0.4);
    expect(snapshot()).toEqual(at40);
  });
});
