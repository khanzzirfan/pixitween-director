import { Container, Text } from 'pixi.js';
import type { TargetRef } from '../../core/paths';
import { applyBaseTransform, resolveBaseTarget } from '../../core/transform';
import type { NodeFactory } from '../../core/types';
import { textStyleFrom } from './textStyle';

/** The first family in a CSS font list, used for the `document.fonts.load` request. */
function firstFamily(fontFamily: string): string {
  return fontFamily.split(',')[0].trim();
}

/**
 * A `Text` built from the layer's style inside `ready`, after waiting on `document.fonts.load` for the
 * first family (skipped when `document.fonts` is missing or the load rejects). Until then the display
 * is an empty `Container` and `size()` is 0x0; the `Text` is added once created and the pivot is
 * recomputed from its measured size. `fill` is a colour target that rebuilds the text style's fill.
 */
export const createTextNode: NodeFactory = (layer, _ctx, parentStart) => {
  if (layer.type !== 'text') {
    throw new Error(`motion: createTextNode expects a text layer, got ${layer.type}`);
  }

  const { style } = layer;
  const display = new Container();
  let text: Text | null = null;

  const state = { fill: style.fill };
  applyBaseTransform(display, layer, { width: 0, height: 0 });

  const ready = (async () => {
    if (typeof document !== 'undefined' && document.fonts) {
      const family = firstFamily(style.fontFamily);
      try {
        await document.fonts.load(`${style.fontWeight} ${style.fontSize}px ${family}`);
      } catch {
        // Fall back to whatever the browser can render.
      }
    }
    text = new Text({ text: layer.text, style: textStyleFrom(style) });
    display.addChild(text);
    applyBaseTransform(display, layer, { width: text.width, height: text.height });
  })();

  const fillTarget: TargetRef = {
    obj: state,
    key: 'fill',
    kind: 'color',
    getColor: () => state.fill,
    setColor: (hex) => {
      state.fill = hex;
      if (text) {
        text.style.fill = hex;
      }
    },
  };

  return {
    id: layer.id,
    layer,
    display,
    start: parentStart + layer.start,
    end: parentStart + (layer.end ?? layer.start),
    children: [],
    size: () => (text ? { width: text.width, height: text.height } : { width: 0, height: 0 }),
    resolveTarget(target, prop) {
      if (target !== undefined) return null;
      if (prop === 'fill') return fillTarget;
      return resolveBaseTarget(display, prop);
    },
    ready,
    destroy() {
      display.destroy({ children: true });
    },
  };
};
