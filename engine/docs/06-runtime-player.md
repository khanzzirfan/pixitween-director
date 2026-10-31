# 06. Runtime, player, lab page, end-to-end checks

Files: `engine/src/runtime/*`, `engine/src/react/*`, `engine/src/index.ts`, `engine/lab/motion-lab.tsx`,
`engine/playwright.config.ts`, `engine/e2e/motion-lab.spec.ts` (R4). `web/motion-lab.html` and
`web/src/dev/motion-lab.tsx` are stubs that only import `engine/lab/motion-lab.tsx`.

## assemble (R4: `engine/src/runtime/assemble.ts`)

Testable without WebGL (`renderer: null`, fake three factory, fake chains):

```ts
export function assemble(doc: MotionDoc, ctx: { renderer: THREE.WebGLRenderer | null; textures: Map<string, THREE.Texture>;
  factories: { three: NodeFactory } }): {
  stage: THREE.Scene; camera: THREE.OrthographicCamera; nodes: MotionNode[] /* flat, depth-first */;
  clock: MotionClock; renderAt(t: number): void; warnings: string[]; destroy(): void;
};
```

Steps:

1. `stage = new Scene()` (background: the doc's colour unless `transparent`), `camera = createStageCamera(w, h)`.
2. Build nodes with `createNode(layer, ctx, 0, factories)` in layer order; add each `display` to the stage; give every
   mesh `renderOrder` = the node's depth-first index (`traverse`).
3. For each 2D node with enabled `effects`: `isolateNode(node, effects, renderer)`; route `effect:<id>` targets to it.
   (`three` nodes handle their own `effects`.)
4. `validateTargets(doc)` → warnings.
5. `clock = new MotionClock({ duration, fps, loop })`; for each node: `expandPresets(layer, ctx)` + `layer.tweens`,
   `compileTweens(clock.timeline, tweens, { layerStart: node.start, resolve, layerId })` where `resolve` sends
   `effect:<id>` to the node's isolation (2D) or chain (three), everything else to `node.resolveTarget`.
6. Stage effects: `buildStageChain(renderer, stage, camera, doc.effects, size)` (null when none).
7. `primeTimeline(clock.timeline, 0)`; `clock.onUpdate(renderAt)`; `renderAt(0)`.

`renderAt(t)`: `display.visible = isVisible(...)` for every node; `applyOpacityTree(rootNodes)`; for visible nodes
`update?.(t, frame)` and isolated `update`; then `stageChain ? stageChain.render(renderer) : renderer.render(stage, camera)`
(skipped when `renderer` is null).

## MotionRuntime (R4: `engine/src/runtime/MotionRuntime.ts`)

```ts
export class MotionRuntime {
  static create(opts: { mount: HTMLElement; displayWidth?: number; loop?: boolean; onError?(e): void }): MotionRuntime;
  load(doc: unknown): Promise<{ ok: true; warnings: string[] } | { ok: false; errors: Array<{ path: string; message: string }> }>;
  play(): void; pause(): void; seek(sec: number): void; getTime(): number; getDuration(): number;
  getCanvas(): HTMLCanvasElement;
  whenReady(timeoutSec: number): Promise<boolean>;
  renderFrame(frame: number): Promise<HTMLCanvasElement>;
  readPixel(x: number, y: number): [number, number, number, number];   // doc pixels, from the canvas
  layerErrors(): Array<{ layerId: string; message: string }>;
  destroy(): void;
}
```

- `new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })`, `setPixelRatio(1)`,
  `setSize(doc.width, doc.height, false)`, CSS width `displayWidth`, `outputColorSpace = SRGBColorSpace`,
  `toneMapping = NoToneMapping`, `shadowMap.enabled = true`, `PCFShadowMap`. Created once; resized on load.
- `load`: `parseMotionDoc` (keep the previous doc on failure) → destroy the previous assembly → `loadImageTextures`
  and `preloadThreeAssets` per three layer → `assemble`.
- `whenReady` waits on every node's `ready`; true when all settle without error, false on error or timeout.
- `destroy` disposes the assembly, textures, and the renderer (`dispose()` + `forceContextLoss()`).

## `<MotionPlayer>` (R4: `engine/src/react/MotionPlayer.tsx`)

Same API as before: props `doc`, `displayWidth`, `controls` (play/pause, seek, time, frame step), `autoplay`, `loop`,
`onDocErrors`, `onLayerError`, `onTime`; a `MotionHandle` (`play`, `pause`, `seek`, `getTime`, `getDuration`,
`getCanvas`, `whenReady`, `renderFrame`) that mirrors the director's `PlayerHandle` (`web/src/player/PlayerBridge.tsx`).
StrictMode safe: create in an effect, destroy in its cleanup.

## Lab page (R4: `/motion-lab.html`)

Fixture picker (`import.meta.glob('../fixtures/*.json', { eager: true })`), JSON textarea (400 ms debounce, schema
errors with paths, keeps the last good doc playing), the player, layer errors, a hash readout (SHA-256 of a 64×36
downscale of the canvas, first 12 hex chars; `hashCanvas` from `web/src/dev/three-check.tsx`).
Query `?doc=<name>&t=<sec>`. Test hooks on `window.__motion`:

```ts
{ handle: MotionHandle; ready(): Promise<boolean>; hash(): Promise<string>;
  pixel(x: number, y: number): [number, number, number, number]; errors(): string[] }
```

## End-to-end (R4: `npm run engine:e2e`)

`engine/playwright.config.ts`: its own Vite server on port 5290 (`npx vite --config web/vite.config.ts`,
`DIRECTOR_WEB_PORT=5290`), chromium, workers 1. For each fixture in `engine/fixtures/`:

1. open `/motion-lab.html?doc=<name>`; `ready()` is true; `errors()` is empty; no `console.error`;
2. seek 40 %, hash; seek 0; seek 40 %, hash again: equal;
3. seek 80 %: hash differs;
4. screenshot to `debug/engine/<name>-40.png`.

Plus: `basic-2d` has a `#ff0000` shape; `pixel()` at its centre is (255, 0, 0) ± 1. `three-postfx` has its `hero` layer
over a plate; `pixel()` at a corner of the hero layer (where nothing 3D is drawn) equals the plate colour ± 2.

## Fixtures

| Name | Exercises | Updated by |
|------|-----------|------------|
| `basic-2d` | image, shapes (one `#ff0000`), text with presets, a group | R1 (schema rename) |
| `three-primitives` | box, sphere, torus, studio light, shadow, camera and object tweens | R1 |
| `three-gltf` | robot `Wave` clip, can with `spin` loop, golden light | R1 |
| `three-postfx` | can over the plate, `bloom` + `vignette` tweened via `effect:<id>` | R1 |
| `effects-2d` | one layer per 2D-capable effect, glow/dropShadow/outline on text, one doc-level effect | R3 |

Assets already in `web/public`: `/dev/product.png`, `/dev/can-label.png`, `/cartoon/backdrop.png`,
`/cartoon/characters/robot.glb`, `/cartoon/props/can.glb`, `/cartoon/props/mug.glb`, `/fonts/*`.
