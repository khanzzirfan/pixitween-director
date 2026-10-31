# 03. The 2D stage on Three.js: stage space, nodes, textures

Files: `engine/src/core/stage.ts`, `types.ts`, `transform.ts`, `visibility.ts` (R1); `engine/src/stage2d/*` (R2).
Only `three` is used (no Pixi).

## Stage space (R1: `engine/src/core/stage.ts`)

The doc is in pixels with the origin at the top left and `y` down, like a design tool. Three is y-up. One
mapping, used everywhere:

```ts
export function createStageCamera(width: number, height: number): THREE.OrthographicCamera;
// new OrthographicCamera(0, width, 0, -height, -10000, 10000), position z = 1000, looking down -z
export const toWorldY = (docY: number) => -docY;
export const toWorldRotation = (clockwiseRadians: number) => -clockwiseRadians;
export function configure2DMaterial(m: THREE.Material): void;
// transparent = true, depthTest = false, depthWrite = false, toneMapped = false
```

Draw order: the runtime gives every node's meshes a `renderOrder` equal to the node's depth-first index (first
layer drawn first, at the back). Group children come after their group's own meshes.

## The MotionNode contract (R1: `engine/src/core/types.ts`)

```ts
import type * as THREE from 'three';
import type { TargetRef } from './paths';
import type { Layer, MotionDoc } from '../schema';

export interface MotionNode {
  readonly id: string;
  readonly layer: Layer;
  /** Added to the parent. Carries the layer transform (position, rotation, scale). */
  readonly display: THREE.Object3D;
  /** Absolute doc seconds (group children are offset by their ancestors). */
  readonly start: number;
  readonly end: number;
  readonly children: MotionNode[];
  /** Unscaled local size in pixels, for presets and isolation bounds. */
  size(): { width: number; height: number };
  /** Allowlisted tween targets; null when not allowed. */
  resolveTarget(target: string | undefined, prop: string): TargetRef | null;
  /** The node's own alpha (0..1), set by the base `alpha` target. */
  readonly alpha: { value: number };
  /** Sets the effective opacity (own alpha × ancestors) on every material the node owns (not its children's). */
  applyOpacity(effective: number): void;
  /** Called on every clock update while visible (3D render, isolated effects, text redraw). */
  update?(timeSec: number, frame: number): void;
  readonly ready: Promise<void>;
  /** Non-fatal problems (missing clip, missing glyph, …). */
  readonly warnings: string[];
  destroy(): void;
}

export interface NodeContext {
  doc: MotionDoc;
  textures: ReadonlyMap<string, THREE.Texture>;     // image assets by asset id
  renderer: THREE.WebGLRenderer | null;             // null in unit tests
}

export type NodeFactory = (layer: Layer, ctx: NodeContext, parentStart: number) => MotionNode;
```

## Base transform (R1: `engine/src/core/transform.ts`)

Every 2D node has two objects: `display` (an outer `Group`, the layer transform) and `content` (an inner `Group`
holding the meshes, laid out in pixels from (0, 0) to (width, −height)).

```ts
export function createLayerObjects(layer: Layer): { display: THREE.Group; content: THREE.Group };
export function applyBaseTransform(display: THREE.Group, content: THREE.Group, layer: Layer, size: { width: number; height: number }): void;
export function resolveBaseTarget(node: { display: THREE.Group; alpha: { value: number } }, prop: string): TargetRef | null;
export function blendingFor(mode: 'normal' | 'add' | 'multiply' | 'screen'): Partial<THREE.Material>;
```

- `display.position = (x, toWorldY(y), 0)`; `display.rotation.z = toWorldRotation(rad(rotation))`;
  `display.scale = (sx, sy, 1)`.
- Anchor: `content.position = (−ax · width, ay · height, 0)`, so position, rotation and scale act about the
  anchor point (the library's pivot).
- `resolveBaseTarget` allowlist: `x`, `y`, `alpha`, `rotation` (kind `deg`), `scale`, `scaleX`, `scaleY`. Each
  returns a `TargetRef` on a small proxy whose setters apply the mapping: `y` writes `display.position.y = −v`,
  `rotation` (already radians from the compiler) writes `display.rotation.z = −v`, `scale` writes x and y, `alpha`
  writes `node.alpha.value`. Getters return doc-space values. `skewX`/`skewY` are not supported (removed from the
  allowlist).
- Blend modes: `normal` → `NormalBlending`; `add` → `AdditiveBlending`; `multiply` → `MultiplyBlending` with
  `premultipliedAlpha: true`; `screen` → `CustomBlending` with `OneFactor` / `OneMinusSrcColorFactor`.

## Opacity (R2: `engine/src/stage2d/opacity.ts`)

Three has no inherited opacity. The runtime walks the node tree on every update:

```ts
export function applyOpacityTree(nodes: MotionNode[], parentOpacity = 1): void;
// effective = parentOpacity × node.alpha.value; node.applyOpacity(effective); recurse into node.children
```

`applyOpacity` multiplies each owned material's authored opacity (the image's 1, the material spec's `opacity`)
by `effective`.

## Visibility (R1: `engine/src/core/visibility.ts`)

Moved unchanged from the old `pixi/visibility.ts`: `isVisible(t, start, end, docDuration)` is
`start <= t < end`, and a layer ending at the doc's end is visible on the last frame. The runtime sets
`display.visible`.

## Textures (R2: `engine/src/stage2d/textures.ts`)

```ts
export async function loadImageTextures(doc: MotionDoc, load?: (url: string) => Promise<THREE.Texture>): Promise<{
  textures: Map<string, THREE.Texture>;
  errors: Array<{ assetId: string; error: unknown }>;
}>;
export function disposeTextures(textures: Map<string, THREE.Texture>): void;
```

Default loader: `new THREE.TextureLoader().loadAsync(url)`, then `colorSpace = SRGBColorSpace`. All images load in
parallel; one failure does not stop the others.

## Node types (R2: `engine/src/stage2d/nodes/*.ts`)

| File | Content | Size | Extra targets |
|------|---------|------|---------------|
| `imageNode.ts` | `Mesh(PlaneGeometry(w, h))` translated to `(w/2, −h/2)`, `MeshBasicMaterial({ map, color: tint })` | width/height from the layer, aspect kept when one is missing, natural size when neither | `tint` (colour) |
| `textNode.ts` | the text drawn on a 2D canvas at 2× pixel ratio → `CanvasTexture` (sRGB) on a plane of the measured size | measured lines | `fill` (colour; redraws the canvas) |
| `shapeNode.ts` | `ShapeGeometry` of a rounded rect (`radius`) or an ellipse; stroke as a second mesh shaped as a ring (outer shape with the inset shape as a hole) | `width × height` | `fill` (colour) |
| `groupNode.ts` | a `Group` holding the children's displays in order; no meshes | union of children's bounds | none |

All materials go through `configure2DMaterial` and `blendingFor(layer.blendMode)`. A missing image texture gives
an empty content group, size 0×0, and a `ready` that rejects with `Error("motion: image asset <id> did not load")`.

### Text (R2)

```ts
// engine/src/stage2d/text/layout.ts (pure)
export interface Measure { (text: string, font: string, letterSpacing: number): number }  // width in px
export function layoutTextLines(text: string, style: TextStyle, measure: Measure): {
  lines: Array<{ text: string; width: number; x: number; y: number }>;  // x per align, y = baseline
  width: number; height: number;
};
export function cssFont(style: TextStyle): string;   // e.g. "700 96px Inter, Helvetica, Arial, sans-serif"

// engine/src/stage2d/text/draw.ts (browser)
export function drawText(ctx: CanvasRenderingContext2D, layout, style, pixelRatio: number): void;
```

- Explicit `\n` breaks lines; `wordWrapWidth` wraps on spaces (a single word longer than the width stays on its
  own line). `lineHeight` defaults to `1.2 × fontSize`. `letterSpacing` uses `ctx.letterSpacing` (and is passed to
  `measure`).
- Padding around the text box: `max(stroke.width, dropShadow.blur + dropShadow.distance)` on every side so strokes and
  shadows are not clipped; `size()` excludes the padding, the content offset includes it.
- Drawing order: shadow (canvas `shadowColor/Blur/OffsetX/Y`, angle → offsets), stroke (`strokeText`, `lineJoin
  round`), fill.
- Fonts: wait for `document.fonts.load(cssFont(style))` inside `ready`; on failure draw with the fallback.
- The canvas is redrawn only when the text style changes (a `fill` tween) – not every frame.

Port the style mapping ideas from the library's `utils/textStyleV8.ts` and `utils/fonts/fontLoader.ts`.

## createNode (R2: `engine/src/stage2d/createNode.ts`)

`createNode(layer, ctx, parentStart = 0, factories?)` dispatches on type; `three` comes from `factories.three` (R1).
A missing factory throws `Error("motion: no node factory for <type>")`. Groups build children through the same
function with their absolute start.

## Tests

| Unit (jsdom, real `three` objects) | Browser (lab page) |
|-----------------------------------|--------------------|
| stage mapping, base transform and proxies, blend mapping, opacity tree, `isVisible`, texture loader with a fake loader, image sizes and tint, shape geometry bounds and stroke ring, group bounds and child starts, `layoutTextLines` with a fake measure, `cssFont` | text drawing, fonts, the look of every node |
