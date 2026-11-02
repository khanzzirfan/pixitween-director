import type { MotionNode } from '../core/types';

// Three has no inherited opacity. Walk the node tree on every update: each node's effective opacity
// is its own alpha multiplied by every ancestor's alpha, applied to the materials it owns (not its
// children's — those get their own call as the recursion continues).

export function applyOpacityTree(nodes: MotionNode[], parentOpacity = 1): void {
  for (const node of nodes) {
    const effective = parentOpacity * node.alpha.value;
    node.applyOpacity(effective);
    applyOpacityTree(node.children, effective);
  }
}
