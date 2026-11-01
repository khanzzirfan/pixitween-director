import { describe, expect, it, vi } from 'vitest';
import type { MotionNode } from '../core/types';
import { applyOpacityTree } from './opacity';

function fakeNode(alpha: number, children: MotionNode[] = []): MotionNode {
  return {
    id: 'n',
    layer: {} as never,
    display: {} as never,
    content: {} as never,
    start: 0,
    end: 1,
    children,
    alpha: { value: alpha },
    size: () => ({ width: 0, height: 0 }),
    resolveTarget: () => null,
    applyOpacity: vi.fn() as (effective: number) => void,
    ready: Promise.resolve(),
    warnings: [],
    destroy: () => {},
  };
}

describe('applyOpacityTree', () => {
  it('multiplies a group alpha of 0.5 with a child alpha of 0.5 into 0.25', () => {
    const child = fakeNode(0.5);
    const group = fakeNode(0.5, [child]);
    applyOpacityTree([group]);
    expect(group.applyOpacity).toHaveBeenCalledWith(0.5);
    expect(child.applyOpacity).toHaveBeenCalledWith(0.25);
  });

  it('starts from the given parentOpacity', () => {
    const node = fakeNode(0.5);
    applyOpacityTree([node], 0.4);
    expect(node.applyOpacity).toHaveBeenCalledWith(0.2);
  });
});
