import * as THREE from 'three';
import { assemble } from '../runtime/assemble';
import { getEffectChainFactoryForTests, setEffectChainFactoryForTests, type EffectChain } from '../effects/chain';
import type { MotionNode } from '../core/types';
import type { Layer, MotionDoc } from '../schema';
import { createThreeNode, type ThreeNode } from '../three/threeNode';
import { setAnchor } from '../core/transform';
import { layoutTextLines } from '../stage2d/text/layout';

// bakeDoc (engine/docs/08-agent-tools.md): measures every frame of a doc without a browser — per
// layer visibility, effective opacity and doc-space bounds, plus world boxes and the camera for
// three layers — so QA can name the exact frame a problem starts on. It drives the same `assemble`
// pipeline as the player with no renderer, so what it measures is what the player would draw.
//
// Headless limits: effects are stripped (they need WebGL); text layers have no canvas, so their box
// is estimated (0.55 x fontSize per character, the same default measure docs/08 names); image layers use `opts.assetSizes` (default 1x1) when the layer gives
// no width/height; three layers that need async assets (glTF, textured materials) bake with no
// objects because bakeDoc is synchronous and offline.

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Box3D {
  min: [number, number, number];
  max: [number, number, number];
}

export interface BakedCamera {
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
}

export interface BakedFrame {
  frame: number;
  time: number;
  visible: boolean;
  /** Own alpha times every ancestor's alpha; 0 when not visible. */
  opacity: number;
  /** Doc-space (y down) box of what the layer draws; null when not visible or it draws nothing. */
  bounds: Bounds | null;
  /** Text layers only: font size times the world scale, in stage pixels. */
  fontPx?: number;
  /** Three layers only: the world box of every object, by id. */
  objects?: Record<string, Box3D>;
  /** Three layers only: the camera as it stands on this frame. */
  camera?: BakedCamera;
}

export interface BakedLayer {
  id: string;
  type: Layer['type'];
  start: number;
  end: number;
  frames: BakedFrame[];
}

export interface BakedDoc {
  width: number;
  height: number;
  fps: number;
  duration: number;
  frameCount: number;
  /** Every layer, flat and depth-first (group children follow their group). */
  layers: BakedLayer[];
  warnings: string[];
}

export interface BakeOptions {
  /** Natural pixel size per image asset id, for image layers without width/height. */
  assetSizes?: Record<string, { width: number; height: number }>;
}

const NOOP_CHAIN: EffectChain = {
  render() {},
  setSize() {},
  resolveTarget: () => null,
  dispose() {},
  errors: [],
};

/** Rounds away float noise and negative zero so equal frames compare deep-equal. */
function clean(n: number): number {
  const r = Math.round(n * 1e4) / 1e4;
  return r === 0 ? 0 : r;
}

function stripEffects(layers: Layer[]): Layer[] {
  return layers.map((layer) => {
    const copy = { ...layer, effects: [] } as Layer;
    if (copy.type === 'group') copy.children = stripEffects(copy.children);
    return copy;
  });
}

function collectImageAssets(layers: readonly Layer[], out: Set<string>): void {
  for (const layer of layers) {
    if (layer.type === 'image') out.add(layer.asset);
    if (layer.type === 'group') collectImageAssets(layer.children, out);
  }
}

/** Union of the meshes under `root` that are visible, in world space. */
function visibleBox(root: THREE.Object3D, box: THREE.Box3): void {
  if (!root.visible) return;
  const mesh = root as THREE.Mesh;
  if (mesh.isMesh && mesh.geometry) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const local = mesh.geometry.boundingBox;
    if (local) box.union(local.clone().applyMatrix4(mesh.matrixWorld));
  }
  for (const child of root.children) visibleBox(child, box);
}

function toBounds(box: THREE.Box3): Bounds | null {
  if (box.isEmpty()) return null;
  return {
    x: clean(box.min.x),
    y: clean(-box.max.y),
    width: clean(box.max.x - box.min.x),
    height: clean(box.max.y - box.min.y),
  };
}

/** Default Node text measure: 0.55 x fontSize per character (no canvas needed). */
function estimateMeasure(fontSize: number) {
  return (text: string, _font: string, letterSpacing: number): number =>
    text.length * (fontSize * 0.55 + letterSpacing);
}

/** Gives a canvas-less text node an estimated plane so it bakes real bounds. */
function estimateTextPlane(node: MotionNode): void {
  const layer = node.layer;
  if (layer.type !== 'text') return;
  const size = node.size();
  if (size.width > 0 && size.height > 0) return;
  const layout = layoutTextLines(layer.text, layer.style, estimateMeasure(layer.style.fontSize));
  if (layout.width <= 0 || layout.height <= 0) return;
  const geometry = new THREE.PlaneGeometry(layout.width, layout.height);
  geometry.translate(layout.width / 2, -layout.height / 2, 0);
  node.content.add(new THREE.Mesh(geometry));
  setAnchor(node.content, layer.anchor, layout, layer.pivot);
}

function vec(v: THREE.Vector3): [number, number, number] {
  return [clean(v.x), clean(v.y), clean(v.z)];
}

function bakeThree(node: ThreeNode): Pick<BakedFrame, 'objects' | 'camera'> {
  const rig = node.rig;
  if (!rig) return { objects: {} };
  rig.scene.updateMatrixWorld(true);
  const objects: Record<string, Box3D> = {};
  for (const [id, obj] of rig.objects) {
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) continue;
    objects[id] = { min: vec(box.min), max: vec(box.max) };
  }
  return { objects, camera: { position: vec(rig.camera.position), lookAt: vec(rig.lookAt), fov: clean(rig.camera.fov) } };
}

export function bakeDoc(doc: MotionDoc, opts: BakeOptions = {}): BakedDoc {
  const headless: MotionDoc = { ...doc, effects: [], layers: stripEffects(doc.layers) };

  const textures = new Map<string, THREE.Texture>();
  const assetIds = new Set<string>();
  collectImageAssets(headless.layers, assetIds);
  for (const id of assetIds) {
    const size = opts.assetSizes?.[id] ?? { width: 1, height: 1 };
    textures.set(id, new THREE.Texture(size as unknown as HTMLImageElement));
  }

  const previousFactory = getEffectChainFactoryForTests();
  setEffectChainFactoryForTests(() => NOOP_CHAIN);
  const assembly = assemble(headless, { renderer: null, textures, factories: { three: createThreeNode } });
  try {
    const parent = new Map<MotionNode, MotionNode>();
    for (const node of assembly.nodes) for (const child of node.children) parent.set(child, node);

    for (const node of assembly.nodes) estimateTextPlane(node);

    const frameCount = Math.round(headless.duration * headless.fps);
    const layers: BakedLayer[] = assembly.nodes.map((node) => ({
      id: node.id,
      type: node.layer.type,
      start: node.start,
      end: node.end,
      frames: [],
    }));

    for (let frame = 0; frame < frameCount; frame++) {
      assembly.clock.seekFrame(frame);
      assembly.stage.updateMatrixWorld(true);
      assembly.nodes.forEach((node, index) => {
        const visible = node.display.visible;
        let opacity = 0;
        if (visible) {
          opacity = node.alpha.value;
          for (let up = parent.get(node); up; up = parent.get(up)) opacity *= up.alpha.value;
        }
        const box = new THREE.Box3();
        if (visible) visibleBox(node.display, box);
        const baked: BakedFrame = {
          frame,
          time: frame / headless.fps,
          visible,
          opacity: clean(opacity),
          bounds: visible ? toBounds(box) : null,
        };
        if (visible && node.layer.type === 'text') {
          const scale = new THREE.Vector3();
          node.display.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
          baked.fontPx = clean(node.layer.style.fontSize * Math.abs(scale.y));
        }
        if (visible && node.layer.type === 'three') Object.assign(baked, bakeThree(node as ThreeNode));
        layers[index].frames.push(baked);
      });
    }

    return {
      width: headless.width,
      height: headless.height,
      fps: headless.fps,
      duration: headless.duration,
      frameCount,
      layers,
      warnings: [...assembly.warnings],
    };
  } finally {
    assembly.destroy();
    setEffectChainFactoryForTests(previousFactory);
  }
}
