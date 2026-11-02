import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { describe, expect, it, vi } from 'vitest';
import { buildText3D, type Text3DSpec } from './build';
import { layoutText3D } from './layout';
import { parseTypeface } from './typeface';

const data = JSON.parse(readFileSync(resolve(process.cwd(), 'web/public/fonts/helvetiker_bold.typeface.json'), 'utf8'));
const font = new FontLoader().parse(data);
const spec = (text: string, extra: Partial<Text3DSpec> = {}): Text3DSpec => ({
  type: 'text3d',
  font: 'f',
  text,
  size: 0.5,
  depth: 0.1,
  curveSegments: 8,
  align: 'center',
  lineHeight: 1.2,
  letterSpacing: 0,
  ...extra,
});
const mat = () => new THREE.MeshStandardMaterial();

describe('buildText3D', () => {
  it('builds Hello with shared geometry for the repeated l', () => {
    const r = buildText3D(spec('Hello'), font, mat());
    expect([r.glyphs.length, r.words.length, r.lines.length, r.stats.uniqueGeometries]).toEqual([5, 1, 1, 4]);
    expect(r.meshes[2].geometry).toBe(r.meshes[3].geometry);
    expect(r.meshes[2].material).not.toBe(r.meshes[3].material);
    expect(r.stats.triangles).toBeGreaterThan(0);
  });

  it('centres the block on the origin', () => {
    const r = buildText3D(spec('AB CD'), font, mat());
    r.root.updateMatrixWorld(true);
    const c = new THREE.Box3().setFromObject(r.root).getCenter(new THREE.Vector3());
    expect(Math.abs(c.x)).toBeLessThan(1e-6);
    expect(Math.abs(c.y)).toBeLessThan(1e-6);
  });

  it('reproduces layout positions through the hierarchy', () => {
    const s = spec('Hi there\nyou');
    const r = buildText3D(s, font, mat());
    const layout = layoutText3D(s.text, parseTypeface(data), s);
    layout.glyphs.forEach((g, i) => {
      // Sum local positions up to (not including) the root, which only recentres the ink.
      const sum = new THREE.Vector3().add(r.meshes[i].position);
      for (let o: THREE.Object3D | null = r.glyphs[i]; o && o !== r.root; o = o.parent) sum.add(o.position);
      expect(Math.abs(sum.x - g.x)).toBeLessThan(1e-6);
      expect(Math.abs(sum.y - g.y)).toBeLessThan(1e-6);
      expect(r.meshes[i].position.length()).toBeLessThan(1e-6);
    });
  });

  it('warns about missing characters', () => {
    const r = buildText3D(spec('a中b'), font, mat());
    expect(r.glyphs.length).toBe(2);
    expect(r.warnings[0]).toContain('中');
  });

  it('disposes each geometry and material once', () => {
    const r = buildText3D(spec('Hello'), font, mat());
    const geoms = new Set(r.meshes.map((m) => m.geometry));
    const gSpies = [...geoms].map((g) => vi.spyOn(g, 'dispose'));
    const mSpies = r.meshes.map((m) => vi.spyOn(m.material as THREE.Material, 'dispose'));
    r.dispose();
    r.dispose();
    gSpies.forEach((s) => expect(s).toHaveBeenCalledTimes(1));
    mSpies.forEach((s) => expect(s).toHaveBeenCalledTimes(1));
    expect(gSpies.length).toBe(4);
  });
});
