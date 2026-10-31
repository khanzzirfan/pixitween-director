# 03. The 2D stage: nodes, assets, visibility

Files: `engine/src/core/types.ts` (m1, the contract); `engine/src/pixi/*` (m3). Pixi v8 (`pixi.js` 8.22), used
directly: no `@pixi/react`, no `extend`, no JSX intrinsics.

## The MotionNode contract (m1: `engine/src/core/types.ts`)

Every layer becomes one node. The runtime only talks to nodes through this interface, which is what lets m3,
m4 and m5 be built in parallel.

```ts
import type { Container, Filter, Application, Texture } from "pixi.js";
import type { TargetRef } from "./paths";
import type { Layer, MotionDoc } from "../schema";

export interface MotionNode {
  readonly id: string;
  readonly layer: Layer;
  /** The Pixi object placed in the parent. Its transform (x, y, rotation, scale, alpha, pivot) is the layer's. */
  readonly display: Container;
  /** Absolute doc seconds (a group child's times are already offset by its ancestors). */
  readonly start: number;
  readonly end: number;
  readonly children: MotionNode[];               // groups only; [] otherwise
  /** Unscaled local size, for presets. */
  size(): { width: number; height: number };
  /** Allowlisted tween targets ([02-timeline.md](02-timeline.md#target-paths)); null when not allowed. */
  resolveTarget(target: string | undefined, prop: string): TargetRef | null;
  /** Called on every clock update while visible. Optional. */
  update?(timeSec: number): void;
  /** Resolves when the node can draw its first frame; rejects with the layer's error. */
  readonly ready: Promise<void>;
  destroy(): void;
}

export interface NodeContext {
  doc: MotionDoc;
  textures: ReadonlyMap<string, Texture>;    // image assets, by asset id
  app: Application | null;                   // null in unit tests
  /** Layer filters are attached by the runtime (m7) through this hook so m3 does not depend on m5. */
  attachFilters?(node: MotionNode, filters: Filter[]): void;
}

export type NodeFactory = (layer: Layer, ctx: NodeContext, parentStart: number) => MotionNode;
```

## Visibility (m3: `engine/src/pixi/visibility.ts`)

```ts
export function isVisible(timeSec: number, start: number, end: number, docDuration: number): boolean;
```

`start <= t < end`, except that at `t === docDuration` a layer whose `end === docDuration` is visible (so the
last frame is not empty). The runtime sets `display.visible` for every node on every update. A hidden group
hides its children through Pixi, but child nodes still get their own `visible` set.

## Assets (m3: `engine/src/pixi/assets.ts`)

```ts
export async function loadImageAssets(doc: MotionDoc): Promise<{
  textures: Map<string, Texture>;
  errors: Array<{ assetId: string; error: unknown }>;
}>;
export function unloadImageAssets(doc: MotionDoc): Promise<void>;
```

Uses `Assets.load(url)` for every `type: "image"` asset in parallel; one failing asset does not fail the
others. glTF assets are not touched here (Three loads them, [04-three.md](04-three.md)).

## Base transform (m1: `engine/src/core/transform.ts`)

Lives in core because the 2D nodes (m3) and the 3D node (m4) both use it.

```ts
export function applyBaseTransform(display: Container, layer: Layer, size: { width: number; height: number }): void;
export function resolveBaseTarget(display: Container, prop: string): TargetRef | null;
```

- `x`, `y`, `alpha`, `rotation` (degrees → radians), `scale` (number → both axes), `blendMode`.
- Anchor: the pivot is `anchor × size` (`display.pivot.set(ax * w, ay * h)`), so position, rotation and
  scale all act about the anchor. Sprites and text keep their own `anchor` at 0 for this to hold.
- `resolveBaseTarget` serves `x`, `y`, `alpha` (number), `rotation`, `skewX`, `skewY` (deg, on `display` /
  `display.skew`), `scaleX`, `scaleY` (on `display.scale`), and `scale` through a proxy whose setter writes
  both axes and whose getter reads `scale.x`.

## Node types (m3: `engine/src/pixi/nodes/*.ts`)

| File | Display | Size | Extra targets |
|------|---------|------|---------------|
| `imageNode.ts` | `Sprite` with the asset's texture; `width`/`height` from the layer (aspect kept when one is missing) | sprite size | `tint` (colour) |
| `textNode.ts` | `Text` with a `TextStyle` from `textStyleFrom(layer.style)` | measured bounds | `fill` (colour; rebuilds `style.fill`) |
| `shapeNode.ts` | `Graphics`: `rect` (rounded when `radius > 0`) or `ellipse`, fill and optional stroke | `width × height` | `fill` (colour; redraws) |
| `groupNode.ts` | `Container` holding its children's displays in order | union of children's bounds | none |

A missing image texture (the asset failed to load) gives a node whose `ready` rejects with
`Error("motion: image asset <id> did not load")` and whose display is an empty `Container`, so the rest of the
doc still plays.

`textStyleFrom(style)` (pure, unit-tested in jsdom) maps the schema style to Pixi v8 `TextStyleOptions`:
`stroke: { color, width }`, `dropShadow: { color, alpha, blur, distance, angle (radians) }`, `wordWrap: true`
when `wordWrapWidth` is set. Port the mapping from the library's `utils/textStyleV8.ts`, dropping everything
the schema does not have.

Fonts: `textNode` waits on `document.fonts.load(\`${fontWeight} ${fontSize}px ${family}\`)` for the first family
in the list before creating the `Text`, inside `ready`. If that rejects or there is no `document.fonts`, it
draws with the fallback.

## `createNode` (m3: `engine/src/pixi/createNode.ts`)

```ts
export function createNode(layer: Layer, ctx: NodeContext, parentStart = 0, factories?: Partial<Record<Layer["type"], NodeFactory>>): MotionNode;
```

Dispatches on `layer.type` to the four 2D factories. `three` has no 2D factory: the runtime passes
`factories.three` (from m4). An unknown or missing factory throws `Error("motion: no node factory for <type>")`.
Group nodes create their children through the same `createNode` (with the same `factories`), passing their
own absolute start.

## What is tested where

| Unit (jsdom) | Browser (lab page, m7) |
|--------------|------------------------|
| `isVisible`, `applyBaseTransform` and `resolveBaseTarget` on a real `Container`, `textStyleFrom`, `shapeNode` size and targets, `groupNode` child start offsets, `createNode` dispatch and its error | text measurement and fonts, image drawing, anchors visually correct |

jsdom has no 2D canvas context (`web/src/test-setup.ts` stubs `getContext` to `null`), so do not construct
`Text` in a unit test.
