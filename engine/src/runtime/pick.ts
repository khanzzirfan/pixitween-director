import * as THREE from 'three';
import type { MotionNode } from '../core/types';

type PickNode = Pick<MotionNode, 'id' | 'display' | 'content' | 'size'>;

const point = new THREE.Vector3();

function hiddenInTree(display: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = display; o; o = o.parent) if (!o.visible) return true;
  return false;
}

/**
 * Returns the id of the front-most node whose content box contains the doc-space point (x, y down),
 * or null. `nodes` is in depth-first render order, so later nodes draw on top. Nodes whose display
 * (or any ancestor) is hidden are never hit.
 */
export function pickNode(nodes: readonly PickNode[], x: number, y: number): string | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    if (hiddenInTree(node.display)) continue;
    const { width, height } = node.size();
    if (width <= 0 || height <= 0) continue;
    node.display.updateWorldMatrix(true, false);
    point.set(x, -y, 0).applyMatrix4(new THREE.Matrix4().copy(node.display.matrixWorld).invert());
    const lx = point.x - node.content.position.x;
    const ly = point.y - node.content.position.y;
    if (lx >= 0 && lx <= width && ly <= 0 && ly >= -height) return node.id;
  }
  return null;
}
