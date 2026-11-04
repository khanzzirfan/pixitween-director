# 05. Effects: one system for 2D layers, 3D layers and the stage

Files: `engine/src/effects/*`. Library: `postprocessing` 6.39 (pmndrs, vanilla). Replaces both the Pixi filters
(`pixi-filters`) and the R3F post-processing of the library.

## Where effects run

| Schema field | Applied to | How |
|--------------|-----------|-----|
| `effects` on a 2D layer (image, text, shape, group) | that layer only | the layer is **isolated**: rendered alone into a render target through the chain, shown on a plane in its place (R3) |
| `effects` on a `three` layer | that 3D scene | the scene renders through the chain into the layer's render target (R1) |
| `effects` on the doc | the whole frame | one composer over the stage, rendering to the canvas (R3) |

All three use one chain builder and one effect table.

## Effect types

| Type | Implementation | Params (default) | Tweenable | Where |
|------|----------------|------------------|-----------|-------|
| `bloom` | `BloomEffect({ mipmapBlur: true })` | `intensity` 1, `threshold` 0.85, `smoothing` 0.1, `radius` 0.7 | intensity, threshold, smoothing | any |
| `vignette` | `VignetteEffect` | `offset` 0.35, `darkness` 0.6 | both | any |
| `chromaticAberration` | `ChromaticAberrationEffect` | `offsetX` 0.0015, `offsetY` 0.0015 | both | any |
| `noise` | `NoiseEffect({ premultiply: true })`, `BlendFunction.OVERLAY` | `opacity` 0.15 | opacity | any |
| `brightnessContrast` | `BrightnessContrastEffect` | `brightness` 0, `contrast` 0 | both | any |
| `hueSaturation` | `HueSaturationEffect` | `hue` 0 (deg), `saturation` 0 | both | any |
| `sepia` | `SepiaEffect` | `intensity` 1 | intensity | any |
| `grayscale` | `ColorAverageEffect` | `opacity` 1 | opacity (blendMode.opacity) | any |
| `pixelate` | `PixelationEffect` | `granularity` 8 | granularity | any |
| `scanlines` | `ScanlineEffect({ blendFunction: OVERLAY })` | `density` 1.25, `opacity` 0.4 | density, opacity | any |
| `dotScreen` | `DotScreenEffect` | `scale` 1, `angle` 45 (deg) | scale, angle | any |
| `tiltShift` | `TiltShiftEffect` | `offset` 0, `rotation` 0 (deg), `focusArea` 0.4, `feather` 0.3 | all | any |
| `blur` | `KawaseBlurPass` inserted before the effect pass | `scale` 1 (kernel `KernelSize.MEDIUM`) | scale | any |
| `glow` | custom `GlowEffect` (R3) | `color` `#ffffff`, `strength` 2, `distance` 10 (px) | color, strength | 2D layers |
| `dropShadow` | custom `DropShadowEffect` (R3) | `color` `#000000`, `alpha` 0.5, `distance` 6 (px), `angle` 45 (deg), `blur` 4 (px) | color, alpha, distance, angle, blur | 2D layers |
| `outline` | custom `OutlineEffect2D` (R3) | `color` `#000000`, `thickness` 2 (px), `alpha` 1 | color, thickness, alpha | 2D layers |
| `dof` | `DepthOfFieldEffect(camera)` | `focusDistance` 5, `focusRange` 2, `bokehScale` 2 | all three | `three` layers only (needs depth) |

The old Pixi filter names map like this, for anyone porting a doc: `adjustment` → `brightnessContrast` +
`hueSaturation`; `colorMatrix` presets → `sepia`, `grayscale`, `hueSaturation`; `rgbSplit` → `chromaticAberration`;
`crt` → `scanlines` + `vignette` + `noise`; `oldFilm` → `sepia` + `noise` + `vignette`; `zoomBlur`, `godray`, `glitch`
are dropped (`GlitchEffect` uses `Math.random` and is not deterministic).

`glow`, `dropShadow` and `outline` exist to give 2D layers the look the Pixi filters gave. They sample the layer's
alpha around each pixel (a fixed tap pattern, 16 taps at `distance` px, scaled by the texel size), so they only make
sense on an isolated 2D layer with a transparent background. Port the shader ideas from
`node_modules/pixi-filters/lib/glow/glow.frag`, `drop-shadow/*.frag` and `outline/outline.frag` (reading the files is
allowed; the engine must not import `pixi-filters`).

## The effect table (R1, extended in R3: `engine/src/effects/table.ts`)

Renamed and extended from M6's `engine/src/three/postfx/effects.ts`:

```ts
export type EffectKind = 'number' | 'deg' | 'color';
export interface EffectDef {
  type: EffectType;
  scope: 'any' | 'three' | '2d';
  defaults: Record<string, number | string>;
  /** Effects become part of the EffectPass; `blur` is a Pass and is handled by the chain. */
  create(params, ctx: { camera: THREE.Camera; size: { width: number; height: number } }): Effect | Pass;
  tweenable: Record<string, { kind: EffectKind; get(e): number | string; set(e, v): void }>;
}
export const EFFECTS: Record<EffectType, EffectDef>;
```

## The chain (R1: `engine/src/effects/chain.ts`)

```ts
export interface EffectChain {
  /** Renders `scene` with `camera` through the effects into `output` (a render target), or to the canvas when output is null. */
  render(renderer: THREE.WebGLRenderer): void;
  setSize(width: number, height: number): void;
  resolveTarget(id: string, prop: string): TargetRef | null;
  dispose(): void;
  readonly errors: string[];
}
export function buildEffectChain(opts: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  effects: EffectSpec[];
  size: { width: number; height: number };
  output: THREE.WebGLRenderTarget | null;
  toneMapping: boolean;            // true for three layers (ACES last), false for 2D and the stage
}): EffectChain;
```

- `new EffectComposer(renderer, { frameBufferType: HalfFloatType, alpha: true })`, `RenderPass(scene, camera)` clearing
  to transparent, `KawaseBlurPass` when `blur` is present, one `EffectPass(camera, ...effects[, ToneMappingEffect(ACES)])`,
  then a `CopyPass(output)` when `output` is a target. With no effects and `toneMapping: false`, the chain is a plain
  `renderer.setRenderTarget(output); renderer.render(scene, camera)` (fast path).
- During `render` the renderer's `toneMapping` is `NoToneMapping` and is restored afterwards, also on throw.
- `render` uses `composer.render(0)` (no real delta: nothing animates by itself).
- Check every class and field name against `node_modules/postprocessing/build/types/index.d.ts`; where 6.39 differs,
  use the real name and say so in `notes`.

## Layer isolation (R3: `engine/src/effects/isolate.ts`)

```ts
export function isolateNode(node: MotionNode, effects: EffectSpec[], renderer: THREE.WebGLRenderer): IsolatedNode;
export interface IsolatedNode {
  readonly display: THREE.Object3D;    // a plane showing the target, carrying the node's layer transform
  update(timeSec: number, frame: number): void;  // renders the node's content through the chain into the target
  resolveTarget(id: string, prop: string): TargetRef | null;
  dispose(): void;
}
```

- `padding = max over effects of their reach` (glow `distance`, dropShadow `distance + blur`, outline `thickness`,
  blur 32 px, others 0), rounded up to whole pixels.
- The node's `content` group is moved into a private `Scene` with an `OrthographicCamera` covering
  `[−padding, width + padding] × [padding, −(height + padding)]`; the target is `(width + 2·padding) × (height + 2·padding)`
  at the doc's pixel ratio 1.
- The plane (`MeshBasicMaterial({ map: target.texture, transparent, toneMapped: false })`, `configure2DMaterial`) is
  added to the node's `display` at the content's offset minus padding, so the layer transform, anchor, opacity and
  draw order keep working exactly as for a non-isolated node.
- Groups can be isolated too (their children's displays live in the content group).
- `update` runs only while the node is visible; it re-renders every frame (tweens may change the content).

## Stage effects (R3: `engine/src/effects/stage.ts`)

`buildStageChain(renderer, stage, camera, doc.effects, size)` returns an `EffectChain` with `output: null` and
`toneMapping: false`, or `null` when there are no enabled effects (then the runtime calls
`renderer.render(stage, camera)` directly).

## Transparency and colour checks

- A transparent `three` layer with effects stays transparent where nothing is drawn (checked by the e2e on the
  `three-postfx` fixture with `__motion.pixel(x, y)` on the final canvas over a plate of a known colour).
- A `#ff0000` shape with no effects reads back as (255, 0, 0) ± 1 on the canvas (e2e, `basic-2d`).
