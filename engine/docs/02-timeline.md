# 02. Timeline: clock, target paths, tweens, presets

Files: `engine/src/core/clock.ts`, `engine/src/core/paths.ts` (m1); `engine/src/timeline/*` (m2). All of it runs in
Node and jsdom: the only runtime import is `gsap` (no `PixiPlugin`, no `CustomEase` plugin registration
side effects at import time; register `CustomEase` lazily inside `engine/src/timeline/eases.ts` if a preset needs it).

## MotionClock (m1)

Ported idea: `providers/GsapPixieContextProvider.tsx`. Dropped: the event bus, reverse mode, drag mode,
Remotion flag, `handleSeekTest`, the `+0.2 s` duration buffer, the 0.01 s seek.

```ts
export interface ClockOptions { duration: number; fps: number; loop?: boolean }

export class MotionClock {
  constructor(opts: ClockOptions);
  readonly timeline: gsap.core.Timeline;   // paused, defaults { ease: "none" }
  readonly duration: number;               // exactly opts.duration
  readonly fps: number;
  get time(): number;
  get playing(): boolean;
  play(): void;                            // at the end (time >= duration) restarts from 0
  pause(): void;
  seek(sec: number): void;                 // clamps to [0, duration]; emits update synchronously, even if paused
  seekFrame(n: number): void;              // seek(n / fps)
  frameAt(sec?: number): number;           // Math.round(sec * fps); defaults to the current time
  onUpdate(fn: (timeSec: number) => void): () => void;   // returns unsubscribe; listener errors are caught and console.warn'd
  onComplete(fn: () => void): () => void;
  destroy(): void;                         // kills the timeline, drops listeners
}
```

- The timeline's length is pinned to `duration` with an empty `timeline.set({}, {}, duration)`, so
  `timeline.duration()` equals the doc duration whatever the tweens are.
- At the end: if `loop`, wrap to 0 and keep playing; otherwise pause at `duration` and fire `onComplete`.
- `onUpdate` fires on every timeline update while playing and once per `seek`.

## Target paths (m1: `engine/src/core/paths.ts`)

```ts
export type PropKind = "number" | "deg" | "color";
export interface TargetRef {
  obj: object;          // the object GSAP tweens
  key: string;          // the property on obj
  kind: PropKind;
  /** colour targets only: write a hex string back to the real object */
  setColor?: (hex: string) => void;
  getColor?: () => string;
}
export function pathRef(root: object, path: string, kind: PropKind): TargetRef;
// pathRef(mesh, "rotation.y", "deg") → { obj: mesh.rotation, key: "y", kind: "deg" }
// throws Error(`motion: no property "${path}"`) when a segment is missing
```

Each node exposes an allowlist through `resolveTarget(target, prop)` ([03-stage-2d.md](03-stage-2d.md)).
These are all the tweenable properties:

| Target | Properties | Units |
|--------|------------|-------|
| layer (no `target`) | `x`, `y`, `alpha`, `rotation`, `scale`, `scaleX`, `scaleY`, `skewX`, `skewY` | px, 0…1, degrees, factor |
| image layer | also `tint` | colour |
| text layer | also `fill` | colour |
| shape layer | also `fill` | colour |
| `filter:<id>` | the numeric and colour params the filter type declares tweenable | [05](05-filters-postfx.md) |
| `camera` | `position.x/y/z`, `lookAt.x/y/z`, `fov` | world units, degrees |
| `object:<id>` | `position.x/y/z`, `rotation.x/y/z`, `scale` (uniform), `scale.x/y/z`, `material.color`, `material.emissive`, `material.emissiveIntensity`, `material.roughness`, `material.metalness`, `material.opacity` | world units, degrees, factor, colour |
| `light:<id>` | `intensity`, `color`, `position.x/y/z` | |
| `postfx:<id>` | the params the effect type declares tweenable | [05](05-filters-postfx.md) |

`scale` on a 2D layer writes both `scale.x` and `scale.y`; on an object it writes all three. The node handles
that by returning a small proxy object with a `scale` setter.

## Tween compiler (m2: `engine/src/timeline/compile.ts`)

```ts
export type Resolve = (target: string | undefined, prop: string) => TargetRef | null;

export function compileTweens(
  tl: gsap.core.Timeline,
  tweens: Tween[],
  opts: { layerStart: number; resolve: Resolve; layerId: string },
): CompileResult;                                 // { added: number; errors: string[] }
```

For each tween:

1. Resolve every key in `to` (and `from`). An unknown target or property is an error string
   (`layers.<layerId>.tweens[i]: unknown property "rotation.w" on object:can`) and the tween is skipped.
2. Group keys by `TargetRef.obj`, one GSAP tween per object.
3. Units: `deg` values multiply by `Math.PI / 180` (Pixi and Three both store radians).
   `color` values tween a proxy `{ v: fromHex }` to `{ v: toHex }` (GSAP interpolates hex strings) and
   `onUpdate` calls `setColor(proxy.v)`. The proxy tween sits at the same time as the others.
4. Missing `from` keys take the value read at compile time (`getColor()` for colours).
5. Add with `tl.fromTo(obj, fromVars, { ...toVars, duration, ease, repeat, yoyo, immediateRender: false }, layerStart + at)`.
   A `duration` of 0 is `tl.set(obj, toVars, layerStart + at)`.
6. Never set `overwrite`.

After all layers are compiled, the runtime calls `primeTimeline(tl)`:

```ts
export function primeTimeline(tl: gsap.core.Timeline, timeSec = 0): void {
  tl.progress(1, true).progress(0, true);  // every tween records its start values; t = 0 renders `from` states
  tl.seek(timeSec, false);
}
```

### Determinism tests the compiler must pass (plain objects, no Pixi)

- `{ x: 0 }` with a tween `at 1, duration 2, to { x: 100 }`, layer start 0: seek 0 → 0, seek 2 → 50,
  seek 3 → 100, seek 0.5 → 0, seek 2 → 50 again.
- Two tweens on the same key, `[0,1] 0→100` then `[2,3] 100→0`: seek 2.5 → 50, then seek 0.5 → 50,
  then seek 2.5 → 50.
- `from { alpha: 0 }` at `at: 0` with layer start 0: after `primeTimeline`, alpha at t = 0 is 0.
- `rotation: 90` with kind `deg` ends at `Math.PI / 2`.
- A colour tween `#000000 → #ffffff` at the midpoint gives `setColor` a mid grey (`#7f7f7f` or `#808080`).

## Presets (m2: `engine/src/timeline/presets.ts`)

A preset is a pure function that returns tweens; it is compiled exactly like the layer's own tweens.

```ts
export interface PresetContext {
  base: { x: number; y: number; alpha: number; rotation: number; scaleX: number; scaleY: number };  // rotation in degrees
  size: { width: number; height: number };   // the layer's local bounds × scale, from node.size()
  stage: { width: number; height: number };
  layerLength: number;                        // end - start, seconds
}
export type PresetKind = "enter" | "exit" | "loop";
export interface PresetDef {
  kind: PresetKind;
  defaultDuration: number;                    // for loops: one period
  build(ctx: PresetContext, ref: PresetRef, at: number, duration: number): Tween[];
}
export const PRESETS: Record<PresetName, PresetDef>;
export function expandPresets(layer: Layer, ctx: PresetContext): { tweens: Tween[]; errors: string[] };
```

Placement in layer-local time: `enter` at 0; `exit` at `layerLength - exit.duration`; `loop` from the end of
`enter` (or 0) to the start of `exit` (or `layerLength`), covering `n = floor(span / period)` whole periods
(finite, never `-1`); a partial last period is dropped, so a loop always ends at rest. If `n = 0` the loop adds
nothing. Preset tweens are internal, so the schema's `repeat ≤ 100` cap does not apply to them.

- `spin`: one tween of `n × period`, rotation `base → base + 360 × n`, ease `none`.
- `float`, `pulse`: one half-period tween `base → peak` with `yoyo: true, repeat: 2n − 1`, so it ends at base.
- `sway`: a quarter period `base → base − d`, then `base − d ↔ base + d` (half period, yoyo, `repeat: 2n − 2`),
  then a quarter period back to `base`. When `n = 1` the middle part is a single half-period tween.

| Name | Kind | Default s | What it does (base values from `ctx.base`) | Port from |
|------|------|-----------|---------------------------------------------|-----------|
| `fadeIn` | enter | 0.6 | alpha 0 → base | `fadeEffects.ts` FADE_IN |
| `fadeInUp` / `fadeInDown` / `fadeInLeft` / `fadeInRight` | enter | 0.7 | alpha 0 → base and y (or x) from ± 0.5 × size | FADE_IN_* |
| `slideInUp` / `slideInDown` / `slideInLeft` / `slideInRight` | enter | 0.6 | from ± 1 × own size, alpha 0 → base, `power3.out` | `slideEffects.ts` |
| `zoomIn` | enter | 0.6 | scale 0.3 → base, alpha 0 → base | ZOOM_IN |
| `popIn` | enter | 0.5 | scale 0 → base with `back.out(1.7)`, alpha 0 → base over the first 40 % | `backEffects.ts` |
| `rotateIn` | enter | 0.7 | rotation base − 200 → base, alpha 0 → base | ROTATE_IN |
| `dropIn` | enter | 0.9 | y from base − stage height × 0.6, `bounce.out` | `bounceEffects.ts` |
| `fadeOut` | exit | 0.5 | alpha base → 0 | FADE_OUT |
| `fadeOutUp` / `fadeOutDown` | exit | 0.6 | alpha → 0 and y by ∓ 0.5 × size | FADE_OUT_* |
| `slideOutLeft` / `slideOutRight` | exit | 0.6 | x by ∓ 1 × size, alpha → 0, `power3.in` | `slideEffects.ts` |
| `zoomOut` | exit | 0.5 | scale → 0.3 × base, alpha → 0 | ZOOM_OUT |
| `spin` | loop | 1 / turnsPerSecond | rotation +360 per period, `none` ease. `params.turnsPerSecond` default 0.25 (library `DEFAULT_LOOP_ROTATIONS_PER_SEC`), clamped 0.05 … 1 | `constants/animation.ts` SPIN_360 |
| `float` | loop | 3 | y base → base − `params.amplitude` (default 12 px) → base, `sine.inOut`, yoyo | new |
| `pulse` | loop | 1.2 | scale base → base × 1.06 → base, `sine.inOut` | PULSE |
| `sway` | loop | 2.4 | rotation base − `params.degrees` (default 4) → base + degrees → base | `registerEffects.ts` SWING |

Curves and eases come from the library's `utils/gsapEffects/*.ts` and `utils/gsapEffects/animationConfigs.ts`;
where the table and the library disagree, the table wins (it is simpler on purpose).

**Loop presets on 3D objects.** On a `three` layer, `loop.target = "object:<id>"` retargets `spin`, `float`
and `sway` to that object: `spin` tweens `rotation.y` (+360 degrees per period), `float` tweens `position.y`
(`amplitude` in world units, default 0.05), `sway` tweens `rotation.z`. Other presets with a `target` are an error.

## Determinism rules (all of engine/)

1. No `Math.random`, `Date.now`, `performance.now` in anything that affects pixels. Seeds come from the
   clock's frame number (`engine/src/core/seed.ts`: `seedFor(frame, salt) → [0, 1)` using a hash such as
   `fract(sin(frame * 12.9898 + salt * 78.233) * 43758.5453)`).
2. Visible state is a function of clock time only. A node that needs per-frame work (3D draw, CRT time)
   does it in `update(timeSec)`.
3. No `overwrite`, no `immediateRender: true`, no infinite `repeat`.
4. The timeline is built once per `load(doc)`; editing the doc means a new `load`.
