/// <reference types="vite/client" />
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMotionDoc } from '../src/schema/doc';
import type { MotionDoc } from '../src/schema/doc';
import { validateTargets } from '../src/timeline/targets';
import { expandPresets } from '../src/timeline/presets';
import { CAMERA_PRESET_NAMES, EFFECT_SCOPES } from '../src/schema/enums';
import { SHOT_SIZES } from '../src/schema/shot';
import { EFFECTS } from '../src/effects/table';

const fixtures = Object.entries(
  import.meta.glob('./*.json', { eager: true, import: 'default' }) as Record<string, unknown>,
);

const publicDir = fileURLToPath(new URL('../../web/public', import.meta.url));

function parseOrThrow(path: string, raw: unknown): MotionDoc {
  const result = parseMotionDoc(raw);
  if (!result.ok) {
    throw new Error(`${path} did not parse: ${JSON.stringify(result.errors, null, 2)}`);
  }
  return result.doc;
}

function rootRelativeUrls(doc: MotionDoc): string[] {
  return Object.values(doc.assets)
    .map((asset) => asset.url)
    .filter((url) => url.startsWith('/'));
}

function fixture(path: string): unknown {
  const match = fixtures.find(([key]) => key === path);
  if (!match) throw new Error(`missing fixture ${path}`);
  return match[1];
}

describe.each(fixtures)('%s', (path, raw) => {
  it('parses with ok true', () => {
    const result = parseMotionDoc(raw);
    if (!result.ok) throw new Error(`${path}: ${JSON.stringify(result.errors, null, 2)}`);
    expect(result.ok).toBe(true);
  });

  it('references only assets that exist under web/public', () => {
    const missing = rootRelativeUrls(parseOrThrow(path, raw)).filter((url) => !existsSync(join(publicDir, url.slice(1))));
    expect(missing).toEqual([]);
  });
});

describe('fixture contents', () => {
  it('ships the engine fixtures', () => {
    expect(fixtures.map(([path]) => path).sort()).toEqual([
      './basic-2d.json',
      './camera-moves.json',
      './effects-2d.json',
      './polystar.json',
      './showcase-product-turntable.json',
      './showcase-robot-dance.json',
      './showcase-title-card.json',
      './soft-light.json',
      './three-gltf.json',
      './three-postfx.json',
      './three-primitives.json',
      './three-text.json',
    ]);
  });

  it('three-gltf plays the Wave clip on robot.glb and spins object:can', () => {
    const doc = parseOrThrow('three-gltf', fixture('./three-gltf.json'));
    expect(doc.assets.robot).toEqual({ type: 'gltf', url: '/cartoon/characters/robot.glb' });
    const layer = doc.layers.find((candidate) => candidate.type === 'three');
    if (!layer || layer.type !== 'three') throw new Error('three-gltf has no three layer');
    const robot = layer.objects.find((object) => object.geometry.type === 'gltf' && object.geometry.asset === 'robot');
    expect(robot?.animation?.clip).toBe('Wave');
    expect(layer.loop?.target).toBe('object:can');
  });

  it('three-postfx has a transparent hero layer with tweened bloom and vignette', () => {
    const doc = parseOrThrow('three-postfx', fixture('./three-postfx.json'));
    const hero = doc.layers.find((candidate) => candidate.id === 'hero');
    if (!hero || hero.type !== 'three') throw new Error('three-postfx has no three hero layer');
    expect(hero.background).toBe('transparent');
    const ids = hero.effects.map((effect) => effect.id);
    expect(ids).toEqual(expect.arrayContaining(['bloom', 'vignette']));
    for (const id of ['bloom', 'vignette']) {
      expect(hero.tweens.some((tween) => tween.target === `effect:${id}`)).toBe(true);
    }
  });

  it('effects-2d has no target errors and uses every 2D-capable effect, each tweened by a valid param', () => {
    const doc = parseOrThrow('effects-2d', fixture('./effects-2d.json'));
    expect(validateTargets(doc)).toEqual([]);

    const expectedTypes = Object.entries(EFFECT_SCOPES)
      .filter(([, scope]) => scope === 'any' || scope === '2d')
      .map(([type]) => type)
      .sort();

    const effectsById = new Map<string, { id: string; type: string }>();
    const tweensByTarget = new Map<string, Array<{ to?: Record<string, unknown>; from?: Record<string, unknown> }>>();
    for (const layer of doc.layers) {
      for (const effect of layer.effects) effectsById.set(effect.id, effect);
      for (const tween of layer.tweens) {
        if (!tween.target) continue;
        const list = tweensByTarget.get(tween.target) ?? [];
        list.push(tween);
        tweensByTarget.set(tween.target, list);
      }
    }

    expect(Array.from(effectsById.values()).map((effect) => effect.type).sort()).toEqual(expectedTypes);

    for (const effect of effectsById.values()) {
      const def = EFFECTS[effect.type as keyof typeof EFFECTS];
      if (!def) throw new Error(`no effect table entry for "${effect.type}"`);
      const tweens = tweensByTarget.get(`effect:${effect.id}`) ?? [];
      expect(tweens.length, `effect "${effect.id}" (${effect.type}) has no tween`).toBeGreaterThan(0);
      for (const tween of tweens) {
        for (const map of ['to', 'from'] as const) {
          for (const key of Object.keys(tween[map] ?? {})) {
            expect(def.tweenable[key], `"${key}" is not tweenable on "${effect.type}"`).toBeDefined();
          }
        }
      }
    }
  });

  it('polystar holds a 16-point star and a 6-point polygon, and they draw without target errors', () => {
    const doc = parseOrThrow('polystar', fixture('./polystar.json'));
    expect(validateTargets(doc)).toEqual([]);

    const star = doc.layers.find((layer) => layer.id === 'star');
    if (!star || star.type !== 'shape') throw new Error('polystar has no star layer');
    expect(star.shape).toBe('polystar');
    expect(star.starType).toBe('star');
    expect(star.points).toBe(16);
    expect(star.outerRadius).toBe(220);
    expect(star.innerRadius).toBe(95);

    const polygon = doc.layers.find((layer) => layer.id === 'polygon');
    if (!polygon || polygon.type !== 'shape') throw new Error('polystar has no polygon layer');
    expect(polygon.shape).toBe('polystar');
    expect(polygon.starType).toBe('polygon');
    expect(polygon.points).toBe(6);
    expect(polygon.outerRadius).toBe(150);
  });

  it('three-text uses the glyph presets and a staggered words tween with zero target and preset errors', () => {
    const doc = parseOrThrow('three-text', fixture('./three-text.json'));
    expect(validateTargets(doc)).toEqual([]);
    const layer = doc.layers.find((candidate) => candidate.type === 'three');
    if (!layer || layer.type !== 'three') throw new Error('three-text has no three layer');
    expect([layer.enter?.name, layer.loop?.name, layer.exit?.name]).toEqual(['glyphPop', 'glyphWave', 'glyphFadeOut']);
    expect(layer.tweens.some((tween) => /^(words|lines):/.test(tween.target ?? '') && tween.stagger)).toBe(true);
    const length = (layer.end ?? doc.duration) - layer.start;
    const expanded = expandPresets(layer, {
      base: {},
      size: { width: layer.width, height: layer.height },
      stage: { width: doc.width, height: doc.height },
      layerLength: length,
    } as never);
    expect(expanded.errors).toEqual([]);
  });

  it('camera-moves has no target errors and covers every shot size and every camera preset', () => {
    const doc = parseOrThrow('camera-moves', fixture('./camera-moves.json'));
    expect(validateTargets(doc)).toEqual([]);

    const sizes = new Set<string>();
    const presets = new Set<string>();
    let paths = 0;

    for (const layer of doc.layers) {
      if (layer.type !== 'three') continue;
      if (layer.camera.shot) sizes.add(layer.camera.shot.size);
      if (layer.camera.path) paths += 1;
      for (const key of ['enter', 'exit', 'loop'] as const) {
        const ref = layer[key];
        if (!ref) continue;
        const shot = ref.params?.shot;
        if (shot && typeof shot === 'object' && 'size' in shot) sizes.add(shot.size);
        presets.add(ref.name);
      }
    }

    expect([...sizes].sort()).toEqual([...SHOT_SIZES].sort());
    expect([...presets].filter((name) => CAMERA_PRESET_NAMES.includes(name as never)).sort()).toEqual(
      [...CAMERA_PRESET_NAMES].sort(),
    );
    expect(paths).toBeGreaterThan(0);
  });
});
