import * as THREE from 'three';
import { MotionClock } from '../core/clock';
import { isVisible } from '../core/visibility';
import type { MotionNode, NodeContext } from '../core/types';
import type { PreloadedThreeAssets } from '../three/build/scene';
import { createNode, type Factories } from '../stage2d/createNode';
import { applyOpacityTree } from '../stage2d/opacity';
import { createStageCamera } from '../core/stage';
import { isolateNode, type IsolatedNode } from '../effects/isolate';
import { buildStageChain } from '../effects/stage';
import type { EffectChain } from '../effects/chain';
import { compileTweens, expandPresets, primeTimeline, validateTargets, type PresetContext } from '../timeline';
import type { Layer, MotionDoc } from '../schema';

// assemble (engine/docs/06-runtime-player.md, "assemble"): the whole build pipeline — stage, nodes,
// layer isolation, presets and tweens — on one MotionClock, runnable without WebGL (renderer: null,
// a test effect-chain factory) so wiring bugs are unit tested here instead of in the browser.

export interface AssembleContext {
  renderer: THREE.WebGLRenderer | null;
  textures: ReadonlyMap<string, THREE.Texture>;
  factories: Factories;
  /** Three-layer assets the runtime already loaded, by layer id (see NodeContext.preloaded). */
  preloaded?: ReadonlyMap<string, PreloadedThreeAssets>;
}

export interface Assembly {
  stage: THREE.Scene;
  camera: THREE.OrthographicCamera;
  /** Every node, flat and depth-first (group children follow their group). */
  nodes: MotionNode[];
  clock: MotionClock;
  renderAt(timeSec: number): void;
  warnings: string[];
  destroy(): void;
}

function flatten(node: MotionNode): MotionNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

function scaleOf(scale: Layer['scale']): { scaleX: number; scaleY: number } {
  return typeof scale === 'number' ? { scaleX: scale, scaleY: scale } : { scaleX: scale[0], scaleY: scale[1] };
}

function presetContextFor(node: MotionNode, layer: Layer, doc: MotionDoc): PresetContext {
  return {
    base: { x: layer.x, y: layer.y, alpha: layer.alpha, rotation: layer.rotation, ...scaleOf(layer.scale) },
    size: node.size(),
    stage: { width: doc.width, height: doc.height },
    layerLength: (layer.end ?? layer.start) - layer.start,
    fps: doc.fps,
    // The camera presets move the camera, so they need its rest pose and a way to frame a shot.
    camera: node.cameraState?.() ?? undefined,
    frameShot: node.frameShot ? (shot) => node.frameShot?.(shot) ?? null : undefined,
  };
}

export function assemble(doc: MotionDoc, ctx: AssembleContext): Assembly {
  const stage = new THREE.Scene();
  if (doc.background !== 'transparent') stage.background = new THREE.Color(doc.background);
  const camera = createStageCamera(doc.width, doc.height);

  const nodeCtx: NodeContext = { doc, textures: ctx.textures, renderer: ctx.renderer, preloaded: ctx.preloaded };
  const topNodes = doc.layers.map((layer) => createNode(layer, nodeCtx, 0, ctx.factories));
  for (const node of topNodes) stage.add(node.display);

  const nodes = topNodes.flatMap(flatten);

  // A renderer stand-in for isolation/the stage chain when running without WebGL: the real factory
  // is swapped out for a fake with `setEffectChainFactoryForTests`, so this object is never read.
  const rendererOrStub = ctx.renderer ?? ({} as THREE.WebGLRenderer);

  const isolations = new Map<string, IsolatedNode>();
  for (const node of nodes) {
    if (node.layer.type === 'three') continue;
    const effects = node.layer.effects;
    if (!effects.some((effect) => effect.enabled !== false)) continue;
    isolations.set(node.id, isolateNode(node, effects, rendererOrStub));
  }

  // Render order by depth-first index, after isolation (an isolated node's display now holds its
  // plane, not its content, so the plane is what needs the index).
  nodes.forEach((node, index) => {
    node.display.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) obj.renderOrder = index;
    });
  });

  const warnings: string[] = [];
  for (const error of validateTargets(doc)) warnings.push(`${error.path}: ${error.message}`);

  const clock = new MotionClock({ duration: doc.duration, fps: doc.fps });

  for (const node of nodes) {
    const layer = node.layer;
    const { tweens: presetTweens, errors: presetErrors } = expandPresets(layer, presetContextFor(node, layer, doc));
    warnings.push(...presetErrors);

    const resolve = (target: string | undefined, prop: string) => {
      if (target !== undefined && target.startsWith('effect:')) {
        const isolation = isolations.get(node.id);
        if (isolation) return isolation.resolveTarget(target.slice('effect:'.length), prop);
      }
      return node.resolveTarget(target, prop);
    };

    const { errors: compileErrors } = compileTweens(clock.timeline, [...presetTweens, ...layer.tweens], {
      layerStart: node.start,
      resolve,
      resolveMany: (target, prop) => node.resolveTargets?.(target, prop) ?? null,
      layerId: node.id,
    });
    warnings.push(...compileErrors);
  }

  const stageChain: EffectChain | null = buildStageChain(rendererOrStub, stage, camera, doc.effects, {
    width: doc.width,
    height: doc.height,
  });

  function renderAt(timeSec: number): void {
    const frame = clock.frameAt(timeSec);
    for (const node of nodes) {
      const visible = isVisible(timeSec, node.start, node.end, doc.duration);
      node.display.visible = visible;
      if (!visible) continue;
      node.update?.(timeSec, frame);
    }
    applyOpacityTree(topNodes);
    // An isolated layer is drawn into its target only now, once its content holds this frame's state
    // (opacity included); drawn earlier it would show the previous frame.
    for (const node of nodes) {
      if (node.display.visible) isolations.get(node.id)?.update(timeSec, frame);
    }

    if (stageChain) stageChain.render(rendererOrStub);
    else ctx.renderer?.render(stage, camera);
  }

  primeTimeline(clock.timeline, 0);
  clock.onUpdate(renderAt);
  renderAt(0);

  function destroy(): void {
    for (const isolation of isolations.values()) isolation.dispose();
    stageChain?.dispose();
    for (const node of topNodes) node.destroy();
    clock.destroy();
  }

  return { stage, camera, nodes, clock, renderAt, warnings, destroy };
}
