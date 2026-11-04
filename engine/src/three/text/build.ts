import * as THREE from 'three';
import type { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { type Geometry3D } from '../../schema/layer3d';
import { layoutText3D, type TextLayout } from './layout';
import { parseTypeface } from './typeface';

export type Text3DSpec = Extract<Geometry3D, { type: 'text3d' }>;

export interface Text3DStats {
  glyphCount: number;
  uniqueGeometries: number;
  triangles: number;
  buildMs: number;
}

export interface Text3DResult {
  /** Origin-centred block: root -> line groups -> word groups -> glyph groups -> mesh. */
  root: THREE.Group;
  /** Glyph groups (pivot at the glyph's own centre), in layout order. */
  glyphs: THREE.Group[];
  /** Word groups (pivot at the word centre). */
  words: THREE.Group[];
  /** Line groups (pivot at the line centre). */
  lines: THREE.Group[];
  /** Glyph meshes, parallel to `glyphs`. */
  meshes: THREE.Mesh[];
  layout: TextLayout;
  warnings: string[];
  stats: Text3DStats;
  /** Disposes every unique geometry and every material once; later calls do nothing. */
  dispose(): void;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Builds the glyph hierarchy. Each group sits at its own centre with children positioned relative to
 * it, so a line, word or glyph can be scaled or rotated about its own centre. Geometries are shared
 * per distinct character; every glyph gets its own clone of `material`.
 */
export function buildText3D(spec: Text3DSpec, font: Pick<Font, 'data'>, material: THREE.Material): Text3DResult {
  const t0 = now();
  const metrics = parseTypeface(font.data);
  const layout = layoutText3D(spec.text, metrics, {
    size: spec.size,
    align: spec.align,
    lineHeight: spec.lineHeight,
    letterSpacing: spec.letterSpacing,
  });
  const warnings = layout.skipped.map((s) => `Character "${s.char}" at index ${s.index} is missing from the font and was skipped`);

  // Line centre relative to the baseline, so a glyph's geometry is centred on its line-box centre.
  const lineCentre = ((metrics.ascender + metrics.descender) / 2 / metrics.resolution) * spec.size;
  const geometries = new Map<string, THREE.BufferGeometry>();
  const geometryFor = (ch: string): THREE.BufferGeometry => {
    let geometry = geometries.get(ch);
    if (!geometry) {
      const advance = metrics.advance(ch, spec.size);
      geometry = new TextGeometry(ch, {
        font: font as Font,
        size: spec.size,
        depth: spec.depth,
        curveSegments: spec.curveSegments,
        bevelEnabled: spec.bevel !== undefined,
        bevelThickness: spec.bevel?.thickness ?? 0,
        bevelSize: spec.bevel?.size ?? 0,
        bevelSegments: spec.bevel?.segments ?? 0,
      });
      geometry.translate(-advance / 2, -lineCentre, -spec.depth / 2);
      geometries.set(ch, geometry);
    }
    return geometry;
  };

  const root = new THREE.Group();
  root.name = 'text3d';
  const lines: THREE.Group[] = layout.lines.map((l) => {
    const g = new THREE.Group();
    g.name = `line:${l.index}`;
    g.position.set(l.x, l.y, 0);
    root.add(g);
    return g;
  });
  const words: THREE.Group[] = layout.words.map((w) => {
    const line = layout.lines[w.lineIndex];
    const g = new THREE.Group();
    g.name = `word:${w.index}`;
    g.position.set(w.x - line.x, w.y - line.y, 0);
    lines[w.lineIndex].add(g);
    return g;
  });
  const materials: THREE.Material[] = [];
  const glyphs: THREE.Group[] = [];
  const meshes: THREE.Mesh[] = [];
  let triangles = 0;
  for (const glyph of layout.glyphs) {
    const word = layout.words[glyph.wordIndex];
    const group = new THREE.Group();
    group.name = `glyph:${glyphs.length}`;
    group.position.set(glyph.x - word.x, glyph.y - word.y, 0);
    const geometry = geometryFor(glyph.char);
    const mat = material.clone();
    materials.push(mat);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = glyph.char;
    group.add(mesh);
    words[glyph.wordIndex].add(group);
    glyphs.push(group);
    meshes.push(mesh);
    triangles += (geometry.index ? geometry.index.count : (geometry.getAttribute('position')?.count ?? 0)) / 3;
  }

  // Ink is rarely symmetric inside the advance boxes (side bearings, ascender/descender), so shift the
  // root so the rendered block is centred on the origin. Group positions stay equal to the layout.
  if (glyphs.length) {
    root.updateMatrixWorld(true);
    const centre = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
    root.position.set(-centre.x, -centre.y, 0);
    root.updateMatrixWorld(true);
  }

  let disposed = false;
  return {
    root,
    glyphs,
    words,
    lines,
    meshes,
    layout,
    warnings,
    stats: { glyphCount: glyphs.length, uniqueGeometries: geometries.size, triangles, buildMs: now() - t0 },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries.values()) geometry.dispose();
      for (const mat of materials) mat.dispose();
    },
  };
}
