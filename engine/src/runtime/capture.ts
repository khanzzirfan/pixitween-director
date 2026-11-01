import * as THREE from 'three';
import type { ThreeNode } from '../three/threeNode';
import type { Layer, MotionDoc } from '../schema';

// Capture (engine/docs/08-agent-tools.md, "Capture and the export pack"): exact frames as PNG, a
// contact sheet, and depth / normal passes. Browser only; the pure parts (grid maths, frame list)
// are unit tested, and the pass restore is tested against a fake runtime.

export type PassKind = 'depth' | 'normal';

/** One three layer ready to be drawn by a pass: its scene, camera and place on the canvas (doc px, y down). */
export interface PassTarget {
  /** Layer id (camera data is keyed by it). */
  id?: string;
  scene: THREE.Scene;
  camera: THREE.Camera;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Meshes that must not appear in a pass (the shadow catcher). */
  hide?: THREE.Object3D[];
}

/** The slice of MotionRuntime that capture needs; a fake satisfies it in tests. */
export interface CaptureRuntime {
  renderFrame(frame: number): Promise<HTMLCanvasElement>;
  getCanvas(): HTMLCanvasElement;
  getTime(): number;
  getFps(): number;
  /** The loaded doc, for the pack summary. */
  getDoc(): MotionDoc | null;
  getRenderer(): THREE.WebGLRenderer;
  /** Visible three layers at the current time. */
  passTargets(): PassTarget[];
  /** Seeks to `sec` and draws it. */
  seek(sec: number): void;
  /** Redraws the current time through the normal pipeline. */
  redraw(): void;
}

// ---- pure parts ----

export interface GridLayout {
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  labelHeight: number;
  width: number;
  height: number;
  /** Top-left of each cell (image area; the label sits under it). */
  cells: Array<{ x: number; y: number }>;
}

export function gridLayout(count: number, cols: number, cellWidth: number, cellHeight: number, labelHeight: number): GridLayout {
  const c = Math.max(1, Math.min(Math.floor(cols), Math.max(1, count)));
  const rows = Math.max(1, Math.ceil(count / c));
  const rowHeight = cellHeight + labelHeight;
  const cells = Array.from({ length: count }, (_, i) => ({ x: (i % c) * cellWidth, y: Math.floor(i / c) * rowHeight }));
  return { cols: c, rows, cellWidth, cellHeight, labelHeight, width: c * cellWidth, height: rows * rowHeight, cells };
}

/** `count` frames spread evenly over [from, to], inclusive, rounded and de-duplicated. */
export function evenFrames(count: number, from: number, to: number): number[] {
  if (count <= 1) return [Math.round(from)];
  const frames = Array.from({ length: count }, (_, i) => Math.round(from + ((to - from) * i) / (count - 1)));
  return frames.filter((f, i) => frames.indexOf(f) === i);
}

export function cellLabel(frame: number, fps: number): string {
  return `f${frame}  ${(frame / fps).toFixed(2)}s`;
}

// ---- canvas helpers ----

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('capture: canvas.toBlob returned null'))), 'image/png');
  });
}

/** PNG of the exact frame. */
export async function captureFrame(rt: CaptureRuntime, frame: number): Promise<Blob> {
  const canvas = await rt.renderFrame(frame);
  return toBlob(canvas);
}

const CELL_WIDTH = 320;
const LABEL_HEIGHT = 22;

/** PNG grid of the frames, with the frame number and time written under each cell. */
export async function contactSheet(rt: CaptureRuntime, frames: number[], cols = 4): Promise<Blob> {
  const fps = rt.getFps();
  const prev = rt.getTime();
  const source = rt.getCanvas();
  const cellHeight = Math.round((CELL_WIDTH * source.height) / source.width);
  const layout = gridLayout(frames.length, cols, CELL_WIDTH, cellHeight, LABEL_HEIGHT);

  const sheet = document.createElement('canvas');
  sheet.width = layout.width;
  sheet.height = layout.height;
  const ctx = sheet.getContext('2d');
  if (!ctx) throw new Error('capture: no 2d context for the contact sheet');
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.font = '14px monospace';
  ctx.textBaseline = 'middle';

  try {
    for (let i = 0; i < frames.length; i += 1) {
      const canvas = await rt.renderFrame(frames[i]);
      const { x, y } = layout.cells[i];
      ctx.drawImage(canvas, x, y, layout.cellWidth, layout.cellHeight);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(cellLabel(frames[i], fps), x + 6, y + layout.cellHeight + layout.labelHeight / 2);
    }
  } finally {
    rt.seek(prev);
  }
  return toBlob(sheet);
}

/** MeshDepthMaterial with view distance mapped linearly: `near` = white, `far` = black. */
function linearDepthMaterial(near: number, far: number): THREE.MeshDepthMaterial {
  const material = new THREE.MeshDepthMaterial();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNear = { value: near };
    shader.uniforms.uFar = { value: far };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uNear;\nuniform float uFar;\nvoid main() {')
      .replace(
        /float fragCoordZ = [^;]+;/g,
        'float fragCoordZ = clamp((vHighPrecisionZW[1] - uNear) / (uFar - uNear), 0.0, 1.0);',
      );
  };
  return material;
}

/** View-space depth range [near, far] of everything in the scene, so a depth pass uses the full grey range. */
function depthRange(scene: THREE.Scene, camera: THREE.Camera): [number, number] | null {
  const box = new THREE.Box3().setFromObject(scene);
  if (box.isEmpty()) return null;
  camera.updateMatrixWorld();
  const inverse = camera.matrixWorldInverse;
  let near = Infinity;
  let far = -Infinity;
  const p = new THREE.Vector3();
  for (let i = 0; i < 8; i += 1) {
    p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(inverse);
    near = Math.min(near, -p.z);
    far = Math.max(far, -p.z);
  }
  if (!(far > 0)) return null;
  return [Math.max(near * 0.95, 0.001), far * 1.05];
}

/**
 * Depth (near = white) or normal pass of the visible three layers at `frame`: every scene is drawn
 * with an override material on a black background, 2D layers are not drawn. All renderer and scene
 * state is put back and the normal pipeline redrawn, so the next normal render is unchanged.
 */
export async function renderPass(rt: CaptureRuntime, frame: number, pass: PassKind): Promise<Blob> {
  const prevTime = rt.getTime();
  await rt.renderFrame(frame);

  const renderer = rt.getRenderer();
  const canvas = rt.getCanvas();
  const targets = rt.passTargets();
  const materials: THREE.Material[] = [];
  let material: THREE.Material = pass === 'depth' ? new THREE.MeshDepthMaterial() : new THREE.MeshNormalMaterial();
  materials.push(material);

  const savedColor = new THREE.Color();
  renderer.getClearColor(savedColor);
  const savedAlpha = renderer.getClearAlpha();
  const savedAutoClear = renderer.autoClear;
  const savedViewport = new THREE.Vector4();
  renderer.getViewport(savedViewport);
  const savedScissor = new THREE.Vector4();
  renderer.getScissor(savedScissor);
  const savedScissorTest = renderer.getScissorTest();
  const savedTarget = renderer.getRenderTarget();
  const saved = targets.map((t) => ({
    target: t,
    override: t.scene.overrideMaterial,
    background: t.scene.background,
    hidden: (t.hide ?? []).map((o) => [o, o.visible] as const),
  }));

  let blob: Promise<Blob>;
  try {
    renderer.setRenderTarget(null);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
    renderer.setClearColor(0x000000, 1);
    renderer.autoClear = false;
    renderer.clear();
    for (const { target } of saved) {
      target.scene.background = null;
      for (const o of target.hide ?? []) o.visible = false;
      if (pass === 'depth') {
        const range = depthRange(target.scene, target.camera) ?? [0.1, 100];
        material = linearDepthMaterial(range[0], range[1]);
        materials.push(material);
      }
      target.scene.overrideMaterial = material;
      const glY = canvas.height - target.y - target.height;
      renderer.setViewport(target.x, glY, target.width, target.height);
      renderer.setScissor(target.x, glY, target.width, target.height);
      renderer.setScissorTest(true);
      renderer.render(target.scene, target.camera);
    }
    // toBlob snapshots the bitmap when called, so it is safe to restore right after.
    blob = toBlob(canvas);
  } finally {
    for (const s of saved) {
      s.target.scene.overrideMaterial = s.override;
      s.target.scene.background = s.background;
      for (const [o, visible] of s.hidden) o.visible = visible;
    }
    renderer.autoClear = savedAutoClear;
    renderer.setClearColor(savedColor, savedAlpha);
    renderer.setScissorTest(savedScissorTest);
    renderer.setScissor(savedScissor);
    renderer.setViewport(savedViewport);
    renderer.setRenderTarget(savedTarget);
    for (const m of materials) m.dispose();
    rt.seek(prevTime);
    rt.redraw();
  }
  return blob;
}

/** Builds pass targets from assembled three nodes (used by MotionRuntime). */
export function passTargetsFromNodes(nodes: Array<{ id: string; display: THREE.Object3D; layer: { type: string } }>): PassTarget[] {
  const out: PassTarget[] = [];
  for (const node of nodes) {
    if (node.layer.type !== 'three' || !node.display.visible) continue;
    const rig = (node as unknown as ThreeNode).rig;
    if (!rig) continue;
    const layer = node.layer as unknown as { x: number; y: number; width: number; height: number };
    out.push({
      id: node.id,
      scene: rig.scene,
      camera: rig.camera,
      // Layer x/y is the layer's centre in doc pixels.
      x: layer.x - layer.width / 2,
      y: layer.y - layer.height / 2,
      width: layer.width,
      height: layer.height,
      hide: rig.shadow ? [rig.shadow] : [],
    });
  }
  return out;
}

// ---- export pack ----

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface CameraSample {
  f: number;
  layerId: string;
  position: Vec3;
  quaternion: Quat;
  fov: number;
}

export interface ExportPack {
  first: Blob;
  last: Blob;
  firstDepth: Blob;
  firstNormal: Blob;
  contactSheet: Blob;
  camera: CameraSample[];
  summary: string;
}

function walkLayers(layers: readonly Layer[], out: Layer[] = []): Layer[] {
  for (const layer of layers) {
    out.push(layer);
    if (layer.type === 'group') walkLayers(layer.children, out);
  }
  return out;
}

const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const v3 = (v: Vec3): string => `(${v.map(r4).join(', ')})`;

/** Plain-text shot description: every text layer's text and every three layer's objects and camera. */
export function packSummary(doc: MotionDoc, range: { from: number; to: number }, camera: CameraSample[]): string {
  const lines = [
    `Shot: ${doc.width}x${doc.height} at ${doc.fps} fps, frames ${range.from} to ${range.to} (${((range.to - range.from) / doc.fps).toFixed(2)}s).`,
  ];
  for (const layer of walkLayers(doc.layers)) {
    if (layer.type === 'text') {
      lines.push(`Text layer ${layer.id}: "${layer.text}"`);
    } else if (layer.type === 'three') {
      const objects = layer.objects.map((o) => `${o.id} (${o.geometry.type})`);
      lines.push(`Three layer ${layer.id}: objects ${objects.length > 0 ? objects.join(', ') : 'none'}.`);
      const cam = camera.filter((c) => c.layerId === layer.id);
      if (cam.length > 0) {
        const a = cam[0];
        const b = cam[cam.length - 1];
        const moved = a.position.some((n, i) => Math.abs(n - b.position[i]) > 1e-4) || Math.abs(a.fov - b.fov) > 1e-4;
        lines.push(
          moved
            ? `  Camera moves from ${v3(a.position)} fov ${r4(a.fov)} to ${v3(b.position)} fov ${r4(b.fov)}.`
            : `  Camera holds at ${v3(a.position)} fov ${r4(a.fov)}.`,
        );
      }
    } else if (layer.type !== 'group') {
      lines.push(`${layer.type[0].toUpperCase()}${layer.type.slice(1)} layer ${layer.id}.`);
    }
  }
  return lines.join('\n');
}

/**
 * Everything an image-to-video model needs for the shot over [from, to]: first and last frame, depth and
 * normal of the first, a contact sheet, the camera on every frame of every visible three layer
 * (unit quaternion), and a text summary. The playhead is put back afterwards.
 */
export async function exportPack(rt: CaptureRuntime, range: { from: number; to: number }): Promise<ExportPack> {
  const fps = rt.getFps();
  const prev = rt.getTime();
  const camera: CameraSample[] = [];
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  try {
    for (let f = range.from; f <= range.to; f += 1) {
      rt.seek(f / fps);
      for (const t of rt.passTargets()) {
        t.camera.getWorldQuaternion(q);
        q.normalize();
        t.camera.getWorldPosition(p);
        camera.push({
          f,
          layerId: t.id ?? '',
          position: [p.x, p.y, p.z],
          quaternion: [q.x, q.y, q.z, q.w],
          fov: (t.camera as THREE.PerspectiveCamera).fov ?? 0,
        });
      }
    }
  } finally {
    rt.seek(prev);
  }
  const first = await captureFrame(rt, range.from);
  const last = await captureFrame(rt, range.to);
  const firstDepth = await renderPass(rt, range.from, 'depth');
  const firstNormal = await renderPass(rt, range.from, 'normal');
  const sheet = await contactSheet(rt, evenFrames(12, range.from, range.to), 4);
  const doc = rt.getDoc();
  const summary = doc ? packSummary(doc, range, camera) : '';
  return { first, last, firstDepth, firstNormal, contactSheet: sheet, camera, summary };
}
