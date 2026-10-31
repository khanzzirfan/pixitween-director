# 06. Runtime, player, lab page, end-to-end checks

Files: `engine/src/runtime/*`, `engine/src/react/*`, `engine/src/index.ts` (m7); `web/motion-lab.html`,
`engine/lab/motion-lab.tsx`, `engine/playwright.config.ts` and `engine/e2e/motion-lab.spec.ts` (m7).
`web/motion-lab.html` and `web/src/dev/motion-lab.tsx` are stubs that only load `engine/lab/motion-lab.tsx`
(Vite serves HTML only from `web/`).

## MotionRuntime (m7: `engine/src/runtime/*`)

The one place that knows every part. Everything else is a part. It is split in two so the wiring can be unit
tested without WebGL:

- `engine/src/runtime/assemble.ts`: `assemble(doc, { app, textures, factories })` runs steps 2 to 9 below on a
  fresh root `Container` and returns `{ root, nodes, clock, renderAt(t), warnings, destroy() }`, where
  `renderAt` does everything except `app.render()`. Works with `app: null` and a fake `three` factory.
- `engine/src/runtime/MotionRuntime.ts`: owns the Pixi `Application`, calls `parseMotionDoc`, `loadImageAssets`,
  `assemble`, and adds `app.render()` to every update.

```ts
export interface RuntimeOptions {
  /** Element the canvas is appended to. */
  mount: HTMLElement;
  /** CSS width of the canvas; height follows the doc's aspect. Default: doc width. */
  displayWidth?: number;
  loop?: boolean;
  onError?(e: { layerId?: string; message: string }): void;
}

export class MotionRuntime {
  static async create(opts: RuntimeOptions): Promise<MotionRuntime>;   // new Application(); await app.init(...)
  load(doc: unknown): Promise<LoadResult>;   // { ok: true, warnings } | { ok: false, errors }; replaces any loaded doc
  readonly clock: MotionClock | null;
  play(): void; pause(): void; seek(sec: number): void;
  getTime(): number; getDuration(): number;
  getCanvas(): HTMLCanvasElement;
  whenReady(timeoutSec: number): Promise<boolean>;   // true when every node's `ready` settled without error
  renderFrame(frame: number): Promise<HTMLCanvasElement>;   // seek(frame / fps), await whenReady(10), render, return canvas
  layerErrors(): Array<{ layerId: string; message: string }>;
  destroy(): void;
}
```

`app.init({ width: doc.width, height: doc.height, background, backgroundAlpha: 0 when "transparent",
antialias: true, preserveDrawingBuffer: true, autoStart: false, resolution: 1 })`. The ticker stays stopped.

`load(doc)`:

1. `parseMotionDoc(doc)`; on failure return the errors and keep the previous doc playing.
2. Destroy the previous clock, nodes, filters and stage children.
3. `loadImageAssets(doc)`; asset errors become layer errors for the layers that use them.
4. Build nodes with `createNode(layer, ctx, 0, { three: createThreeNode })` in layer order; add each
   `display` to the root container.
5. For each node (including group children): `buildFilters(layer.filters)`, set `display.filters`; keep the
   filter set to route `filter:<id>` targets and to `tick`.
6. `validateTargets(doc)` → warnings.
7. New `MotionClock({ duration, fps, loop })`. For every node: `expandPresets(layer, ctx)` + `layer.tweens`,
   then `compileTweens(clock.timeline, tweens, { layerStart: node.start, resolve, layerId })`, where `resolve`
   tries `filter:` targets first, then `node.resolveTarget`. Compile errors become warnings.
8. Stage filters on the root container.
9. `primeTimeline(clock.timeline, 0)`.
10. `clock.onUpdate(t => this.renderAt(t))` and one `renderAt(0)`.

`renderAt(t)`: for every node set `display.visible = isVisible(...)`; for visible nodes call `node.update?.(t)`
and their filter set's `tick(t, frame)`; tick stage filters; `app.render()`.

## `<MotionPlayer>` (m7: `engine/src/react/MotionPlayer.tsx`)

```tsx
export interface MotionHandle {
  play(): void; pause(): void; seek(sec: number): void;
  getTime(): number; getDuration(): number;
  getCanvas(): HTMLCanvasElement | null;
  whenReady(timeoutSec: number): Promise<boolean>;
  renderFrame(frame: number): Promise<HTMLCanvasElement | null>;
}
export interface MotionPlayerProps {
  doc: unknown;                     // validated inside; errors go to onDocErrors
  displayWidth?: number;
  controls?: boolean;               // default true: play/pause, seek slider, time, frame step ◀ ▶
  autoplay?: boolean; loop?: boolean;
  onDocErrors?(errors: Array<{ path: string; message: string }>): void;
  onLayerError?(e: { layerId?: string; message: string }): void;
  onTime?(sec: number): void;       // throttled to animation frames
}
export const MotionPlayer: React.ForwardRefExoticComponent<MotionPlayerProps & React.RefAttributes<MotionHandle>>;
```

The handle mirrors the director's `PlayerHandle` (`web/src/player/PlayerBridge.tsx`) on purpose, so a later
swap is mechanical. One runtime per mounted player; a new `doc` prop calls `runtime.load(doc)` (StrictMode
safe: create in an effect, destroy in its cleanup, ignore a `create` that resolves after cleanup).

## Lab page (m7: `/motion-lab.html`)

A dev page like `web/three-check.html`, not linked from the app. Layout: left, a fixture picker and a JSON
textarea (edits apply 400 ms after typing stops; schema errors listed under it with their paths); right, the
player, a layer error list and a "hash" readout (SHA-256 of a 64×36 downscale of the canvas, first 12 hex
chars; port `hashCanvas` from `web/src/dev/three-check.tsx`).

Fixtures are `engine/fixtures/*.json`, loaded with `import.meta.glob('../fixtures/*.json', { eager: true })`.

Query: `?doc=<fixture name>&t=<seconds>` loads that fixture and seeks there after `whenReady`.

Test hooks on `window.__motion` (dev page only):

```ts
{
  handle: MotionHandle;
  ready(): Promise<boolean>;                         // handle.whenReady(15)
  hash(): Promise<string>;
  layerPixel(layerId: string, x: number, y: number): [number, number, number, number] | null;   // RGBA of a three layer's own canvas
  errors(): string[];                                // doc + layer errors
}
```

## End-to-end (m7: `engine/e2e/motion-lab.spec.ts`)

Runs with `npm run engine:e2e` (`engine/playwright.config.ts`: its own Vite server on port 5290, no API server; it never uses 5173 or the director e2e ports).

For each fixture in `engine/fixtures/`:

1. open `/motion-lab.html?doc=<name>`, `await __motion.ready()` is true, `__motion.errors()` is empty;
2. seek to 40 % of the duration, hash; seek to 0, seek back to 40 %, hash again: equal;
3. seek to 80 %: hash differs from the 40 % one (something moves);
4. no `console.error` during the run;
5. save a screenshot of the player to `debug/engine/<name>-40.png`.

For `three-postfx`, also `layerPixel("hero", 2, 2)[3] === 0` (transparent corner), unless m6 recorded the
opaque-background rule, in which case the test asserts the doc has a background and skips the pixel check.

## Fixtures (m1 creates the first four, m8 adds showcase ones)

| Name | What it exercises |
|------|-------------------|
| `basic-2d` | image plate, shape, text with `slideInUp` / `fadeOut`, a `pulse` loop, a group with two children |
| `three-primitives` | a `three` layer with a box, a sphere and a torus, studio light, shadow, camera dolly tween, object rotation tweens, a colour tween |
| `three-gltf` | `robot.glb` playing `Wave` then a `can.glb` with a `spin` loop on `object:can`, golden light |
| `three-postfx` | the can over the backdrop plate, `bloom` + `vignette` tweened, transparent background |
| `filters-2d` (m5 adds) | one text or shape per filter type, each with one tweened param |

Asset URLs: `/dev/product.png`, `/dev/can-label.png`, `/cartoon/backdrop.png`, `/cartoon/characters/robot.glb`
(clips: Idle, Wave, Dance, Walk, Run, Jump, …), `/cartoon/props/can.glb`, `/cartoon/props/mug.glb`. All are
already in `web/public`.
