import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { gsap } from 'gsap';
import { describe, expect, it } from 'vitest';
import { buildText3D } from './build';
import { resolveUnitTargets } from './targets';

const data = JSON.parse(readFileSync(resolve(process.cwd(), 'web/public/fonts/helvetiker_bold.typeface.json'), 'utf8'));
const font = new FontLoader().parse(data);
const build = () =>
  buildText3D(
    { type: 'text3d', font: 'f', text: 'Hi there', size: 0.5, depth: 0.1, curveSegments: 8, align: 'center', lineHeight: 1.2, letterSpacing: 0 },
    font,
    new THREE.MeshStandardMaterial(),
  );
const write = (ref: { obj: object; key: string }, v: number) => ((ref.obj as Record<string, number>)[ref.key] = v);

describe('resolveUnitTargets', () => {
  it('offset.y on glyphs is relative to rest', () => {
    const t = build();
    const refs = resolveUnitTargets(t, 'glyphs', 'offset.y')!;
    expect(refs).toHaveLength(7);
    const restY = t.glyphs[2].position.y;
    write(refs[2], 0.5);
    expect(t.glyphs[2].position.y).toBeCloseTo(restY + 0.5);
    write(refs[2], 0);
    expect(t.glyphs[2].position.y).toBeCloseTo(restY);
  });

  it('counts words/lines and gates alpha', () => {
    const t = build();
    expect(resolveUnitTargets(t, 'words', 'offset.y')).toHaveLength(2);
    expect(resolveUnitTargets(t, 'lines', 'offset.y')).toHaveLength(1);
    expect(resolveUnitTargets(t, 'words', 'alpha')).toBeNull();
    const refs = resolveUnitTargets(t, 'glyphs', 'alpha')!;
    write(refs[0], 0.4);
    const m = t.meshes[0].material as THREE.Material;
    expect([m.opacity, m.transparent]).toEqual([0.4, true]);
  });

  it('rotation.z is deg and a GSAP tween ends at PI/2', () => {
    const t = build();
    const ref = resolveUnitTargets(t, 'glyphs', 'rotation.z')![0];
    expect(ref.kind).toBe('deg');
    const state = { v: 0 };
    gsap.to(state, { v: 90, duration: 1, onUpdate: () => write(ref, (state.v * Math.PI) / 180) }).progress(1);
    expect(t.glyphs[0].rotation.z).toBeCloseTo(Math.PI / 2);
  });
});
