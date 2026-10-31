/// <reference types="vite/client" />
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMotionDoc } from '../src/schema/doc';
import type { MotionDoc } from '../src/schema/doc';

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
  it('ships the four m1 fixtures', () => {
    expect(fixtures.map(([path]) => path).sort()).toEqual([
      './basic-2d.json',
      './three-gltf.json',
      './three-postfx.json',
      './three-primitives.json',
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
    const ids = hero.postFx.map((effect) => effect.id);
    expect(ids).toEqual(expect.arrayContaining(['bloom', 'vignette']));
    for (const id of ['bloom', 'vignette']) {
      expect(hero.tweens.some((tween) => tween.target === `postfx:${id}`)).toBe(true);
    }
  });
});
