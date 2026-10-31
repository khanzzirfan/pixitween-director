# 05. 2D filters and 3D post-processing

Two different homes, on purpose (the library made the same split: `aepEffectSchema` vs `aepPostFxSchema`):

| | 2D filters | 3D post-processing |
|-|------------|--------------------|
| Schema field | `filters` on any layer, and on the doc (whole stage) | `postFx` on a `three` layer |
| Runs on | the Pixi display (sprite, text, group, the 3D sprite) | the Three render, before it is copied to the sprite |
| Library | `pixi-filters` 6.1 + `pixi.js` core filters | `postprocessing` 6.39 (pmndrs, vanilla) |
| Files | `engine/src/filters/*` (m5) | `engine/src/three/postfx/*` (m6) |
| Tween target | `filter:<id>` | `postfx:<id>` |

## 2D filter registry (m5)

```ts
// engine/src/filters/registry.ts
export interface FilterDef<F extends Filter = Filter> {
  type: Filter2DType;
  defaults: Record<string, ParamValue>;
  create(params: Record<string, ParamValue>): F;      // params already merged with defaults
  /** Tweenable params: how to read and write each on the live filter. */
  tweenable: Record<string, { kind: "number" | "color"; get(f: F): number | string; set(f: F, v: number | string): void }>;
  /** Time-driven filters: called on every clock update. frame = clock.frameAt(t). */
  tick?(f: F, timeSec: number, frame: number): void;
}
export const FILTERS: Record<Filter2DType, FilterDef>;

// engine/src/filters/build.ts
export function buildFilters(specs: Filter2D[]): {
  filters: Filter[];                          // enabled ones, in order
  byId: Map<string, { filter: Filter; def: FilterDef }>;
  resolveTarget(id: string, prop: string): TargetRef | null;   // filter:<id> targets
  tick(timeSec: number, frame: number): void;
  destroy(): void;
  errors: string[];                           // unknown params, bad values
};
```

`resolveTarget` returns a `TargetRef` on a small proxy object whose property setter calls `def.tweenable[k].set`
(so the compiler can tween uniforms that are not plain fields, such as `glow.color`).

| Type | Pixi class | Params (default) | Tweenable | Time-driven |
|------|-----------|------------------|-----------|-------------|
| `blur` | `BlurFilter` (core) | `strength` 8, `quality` 4 | strength | |
| `glow` | `GlowFilter` | `distance` 10, `outerStrength` 2, `innerStrength` 0, `color` `#ffffff`, `alpha` 1, `quality` 0.2 | outerStrength, innerStrength, color, alpha | |
| `bloom` | `AdvancedBloomFilter` | `threshold` 0.5, `bloomScale` 1, `brightness` 1, `blur` 8, `quality` 4 | threshold, bloomScale, brightness, blur | |
| `dropShadow` | `DropShadowFilter` | `offsetX` 4, `offsetY` 4, `blur` 2, `alpha` 0.5, `color` `#000000` | offsetX, offsetY, blur, alpha, color | |
| `adjustment` | `AdjustmentFilter` | `brightness` 1, `contrast` 1, `saturation` 1, `gamma` 1, `red` 1, `green` 1, `blue` 1, `alpha` 1 | all | |
| `colorMatrix` | `ColorMatrixFilter` (core) | `preset` `"none"` (`grayscale`, `sepia`, `vintage`, `polaroid`, `kodachrome`, `technicolor`, `browni`, `negative`, `lsd`), `amount` 1, `hue` 0 (degrees) | amount, hue (both rebuild the matrix) | |
| `noise` | `NoiseFilter` (core) | `noise` 0.2 | noise | seed per frame |
| `rgbSplit` | `RGBSplitFilter` | `redX` −4, `redY` 0, `greenX` 0, `greenY` 4, `blueX` 0, `blueY` 0 | all | |
| `pixelate` | `PixelateFilter` | `size` 8 | size | |
| `crt` | `CRTFilter` | `curvature` 1, `lineWidth` 1, `lineContrast` 0.25, `noise` 0.3, `vignetting` 0.3 | curvature, lineContrast, noise, vignetting | time = t, seed per frame |
| `oldFilm` | `OldFilmFilter` | `sepia` 0.3, `noise` 0.3, `scratch` 0.5, `vignetting` 0.3 | sepia, noise, scratch, vignetting | seed per frame |
| `zoomBlur` | `ZoomBlurFilter` | `strength` 0.1, `centerX` 960, `centerY` 540 (stage pixels, as Pixi expects), `innerRadius` 0 | strength, innerRadius, centerX, centerY | |
| `godray` | `GodrayFilter` | `angle` 30, `gain` 0.5, `lacunarity` 2.5, `alpha` 1 | angle, gain, alpha | time = t |
| `glitch` | `GlitchFilter` | `slices` 8, `offset` 40, `direction` 0 | offset, direction | refresh per frame under a seeded PRNG |
| `outline` | `OutlineFilter` | `thickness` 2, `color` `#000000`, `alpha` 1 | thickness, color, alpha | |

Port the constructor calls and the colour-matrix presets from the library's `hooks/withFiltersHook.tsx` and
`hooks/withEffectsHook.tsx` (they are large; take only the classes in this table). Use the constructor
options objects of pixi-filters v6 (the old positional constructors are gone).

**Seeds and glitch.** `engine/src/core/seed.ts` (m1) provides `seedFor(frame, salt)`. `noise`, `crt` and
`oldFilm` set `seed = seedFor(frame, salt)` where `salt` is a hash of the filter id. `GlitchFilter.refresh()`
uses `Math.random` internally: `tick` calls it inside `withSeededRandom(seedFor(frame, salt), () => f.refresh())`
(`engine/src/filters/seeded.ts`: swaps `Math.random` for a mulberry32 generator during the call and always
restores it in `finally`).

**Unknown params** are reported in `errors` and ignored. **Disabled** filters (`enabled: false`) are not created.

Stage filters (`doc.filters`) use the same `buildFilters` and are applied to the runtime's root container (m7).

## 3D post-processing chain (m6)

```ts
// engine/src/three/postfx/chain.ts
export interface PostFxChain {
  draw(renderer: WebGLRenderer): void;          // passed as `draw` to the offscreen renderer
  setSize(width: number, height: number): void;
  resolveTarget(id: string, prop: string): TargetRef | null;
  dispose(): void;
  errors: string[];
}
export function buildPostFxChain(
  renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera,
  specs: PostFx[], size: { width: number; height: number },
): PostFxChain | null;                          // null when no spec is enabled (fast path: plain render)
```

- `new EffectComposer(renderer, { frameBufferType: HalfFloatType, alpha: true })`, a `RenderPass(scene, camera)`
  that clears to transparent, then **one** `EffectPass(camera, ...effects, toneMapping)` with a
  `ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })` last.
- While the chain draws, the shared renderer's `toneMapping` is set to `NoToneMapping` and restored afterwards
  (the composer applies tone mapping itself; the renderer is shared with layers that do not use post-processing).
- `setSize` is called once at build and when the layer size changes, never per frame.

| Type | Effect | Params (default) | Tweenable → field |
|------|--------|------------------|-------------------|
| `bloom` | `BloomEffect({ mipmapBlur: true })` | `intensity` 1, `threshold` 0.85, `smoothing` 0.1, `radius` 0.7 | intensity → `intensity`; threshold → `luminanceMaterial.threshold`; smoothing → `luminanceMaterial.smoothing` |
| `vignette` | `VignetteEffect` | `offset` 0.35, `darkness` 0.6 | offset, darkness |
| `chromaticAberration` | `ChromaticAberrationEffect` | `offsetX` 0.0015, `offsetY` 0.0015 | offsetX → `offset.x`, offsetY → `offset.y` |
| `noise` | `NoiseEffect({ premultiply: true })` with `BlendFunction.OVERLAY` | `opacity` 0.15 | opacity → `blendMode.opacity.value` |
| `dof` | `DepthOfFieldEffect(camera, …)` | `focusDistance` 5 (world units from the camera), `focusRange` 2, `bokehScale` 2 | focusDistance → `cocMaterial.worldFocusDistance`; focusRange → `cocMaterial.worldFocusRange`; bokehScale → `bokehScale` |
| `brightnessContrast` | `BrightnessContrastEffect` | `brightness` 0, `contrast` 0 | both |
| `hueSaturation` | `HueSaturationEffect` | `hue` 0 (degrees, converted to radians), `saturation` 0 | both (hue as `deg`) |

Check every field name against `node_modules/postprocessing/build/types/index.d.ts` before using it; if one
differs in 6.39, use the real one and say so in the story's `notes`.

`noise` in `postprocessing` animates with its own time; it does not, because the chain never calls
`composer.render(delta)` with a real delta: `draw` calls `composer.render(0)`. If the noise pattern still
changes between two draws of the same frame, set the effect's seed uniform from `seedFor(frame, salt)` in
`update` or drop `noise` from 3D and keep the 2D one.

**Transparency.** A `three` layer with a transparent background and post-processing must still be transparent
where nothing is drawn. The lab page's e2e check reads one corner pixel of the layer's canvas
(`window.__motion.layerPixel(layerId, x, y)`, m7) for the `three-postfx` fixture. If alpha is not 0 there,
the m6 story records it in `notes` and adds a cross-field rule to `engine/src/schema/doc.ts` (a shared edit) that a
`three` layer with enabled `postFx` must have an opaque `background`.

## Hooking post-processing into ThreeNode (m6)

`ThreeNode` (m4) has a `postFx: PostFxChain | null` field and calls `this.postFx?.draw` from `update`. m6:

1. builds the chain in `createThreeNode` after the rig is built (`buildPostFxChain(shared.renderer, …)`),
2. routes `resolveTarget("postfx:<id>", prop)` to `chain.resolveTarget`,
3. disposes it in `destroy()`.

This is the one place m6 edits an m4 file (`engine/src/three/threeNode.ts`, listed as a shared edit).
