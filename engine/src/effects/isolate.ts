import * as THREE from 'three';
import type { TargetRef } from '../core/paths';
import { configure2DMaterial } from '../core/stage';
import type { MotionNode } from '../core/types';
import type { EffectSpec } from '../schema';
import { buildEffectChain, type EffectChain } from './chain';
import { padding } from './table';

// Layer isolation (engine/docs/05-effects.md, "Layer isolation"): a 2D layer with effects renders its
// `content` alone, through the shared chain, into a render target shown on a plane that takes the
// content's place in `display` — so the layer transform, anchor, opacity and draw order are unaffected.

export interface IsolatedNode {
  /** The node's own display, now carrying the plane instead of the content. */
  readonly display: THREE.Object3D;
  /** Renders the node's content through the chain into the target. */
  update(timeSec: number, frame: number): void;
  resolveTarget(id: string, prop: string): TargetRef | null;
  dispose(): void;
}

export function isolateNode(node: MotionNode, effects: EffectSpec[], renderer: THREE.WebGLRenderer): IsolatedNode {
  const { width, height } = node.size();
  const pad = padding(effects);
  const targetWidth = width + pad * 2;
  const targetHeight = height + pad * 2;

  // The content moves into its own scene; an orthographic camera covers the padded area so an
  // effect's reach (glow, dropShadow, outline, blur) isn't clipped at the layer's edge.
  const scene = new THREE.Scene();
  const content = node.content;
  const contentOffset = content.position.clone();
  scene.add(content);

  const camera = new THREE.OrthographicCamera(-pad, width + pad, pad, -(height + pad), -10000, 10000);
  camera.position.set(0, 0, 1000);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  const target = new THREE.WebGLRenderTarget(targetWidth, targetHeight, { type: THREE.HalfFloatType });

  const planeGeometry = new THREE.PlaneGeometry(targetWidth, targetHeight);
  const planeMaterial = new THREE.MeshBasicMaterial({ map: target.texture, transparent: true, toneMapped: false });
  configure2DMaterial(planeMaterial);
  const plane = new THREE.Mesh(planeGeometry, planeMaterial);
  plane.name = `${node.id}:isolated`;
  // The plane is centred where content used to be (its anchor offset), padding only grows its size.
  plane.position.set(contentOffset.x + width / 2, contentOffset.y - height / 2, 0);
  node.display.add(plane);

  const chain: EffectChain = buildEffectChain({
    renderer,
    scene,
    camera,
    effects,
    size: { width: targetWidth, height: targetHeight },
    output: target,
    toneMapping: false,
  });

  let disposed = false;

  return {
    display: node.display,
    update(_timeSec, _frame) {
      if (disposed) return;
      // The node keeps writing its anchor offset to content (e.g. a text redraw). The camera expects the
      // content at the origin, so the offset is moved onto the plane for this render and put back after.
      const offset = content.position.clone();
      plane.position.set(offset.x + width / 2, offset.y - height / 2, 0);
      content.position.set(0, 0, 0);
      try {
        chain.render(renderer);
      } finally {
        content.position.copy(offset);
      }
    },
    resolveTarget(id, prop) {
      return chain.resolveTarget(id, prop);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      chain.dispose();
      target.dispose();
      planeGeometry.dispose();
      planeMaterial.dispose();
      node.display.remove(plane);
      node.display.add(content);
    },
  };
}
