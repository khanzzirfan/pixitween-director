# 10. Playing director films on the Motion engine (AEP → MotionDoc)

The director, crew, review and chat tools write `AepCompositionJson` (schema in `shared/aep/`, our own copy of
the library's schema). The player converts it to a `MotionDoc` at load time and plays it on `MotionRuntime`.
Nothing on the server changes. Converter: `web/src/motion/aep/*` (pure, unit-tested on the stored films in
`data/films/*/versions/*.json`).

```ts
export interface AepToMotionResult { doc: MotionDoc; warnings: string[]; audio: AudioCue[] }
export function aepToMotion(comp: AepCompositionJson, opts?: { resolveUrl?(src: string): string }): AepToMotionResult;
export interface AudioCue { id: string; url: string; startSec: number; endSec: number; level: number }
```

Never throws on an unsupported field: it is skipped and a warning names the layer id and the field.

## Time

AEP time is in frames (`fps`, `durationInFrames`, layer `inPoint`/`outPoint`, keyframe `t`). MotionDoc time is in
seconds: `sec = frame / fps`. Layer `start = inPoint / fps`, `end = outPoint / fps`. Keyframe times are relative to
the layer's own timeline in AEP (frame 0 = comp start); MotionDoc tween `at` is relative to the layer start, so
`at = (t - inPoint) / fps`, clamped to ≥ 0.

## Keyframes → tweens

A property is either a constant or an array of keyframes `{ t, v, easeOut?, easeIn? }` (`v` a number or a
2/3-vector). For each consecutive pair `(k0, k1)` emit one tween `fromTo` from `k0.v` to `k1.v`,
`at = (k0.t - inPoint)/fps`, `duration = (k1.t - k0.t)/fps`, ease from the pair:

- no eases → `none`
- otherwise `cubic(x1,y1,x2,y2)` with `(x1, y1) = k0.easeOut[0..1]` (default `0, 0`) and
  `(x2, y2) = k1.easeIn[2..3]` if present else `k0.easeOut[2..3]` (default `1, 1`). Engine support for
  `cubic(...)` is R7 US-001.

The constant value is the first keyframe's `v` (so the layer starts in the right pose before its first tween).
Vector props split per axis: `position` → `x`, `y`; `scale` → `scaleX`, `scaleY` (or `scale` when x = y in every
keyframe); 3D vectors → `.x/.y/.z`.

## Base transform

| AEP `transform` | MotionDoc layer |
|-----------------|-----------------|
| `position [x, y]` (px, comp space) | `x`, `y` |
| `anchor [ax, ay]` (px, layer space) | `pivot: [ax, ay]` (R7 US-002: pixel anchor, overrides `anchor`) |
| `scale [sx, sy]` (1 = 100 %) | `scale` (number when equal) |
| `rotation` (degrees, clockwise) | `rotation` |
| `opacity` 0..1 | `alpha` |
| layer `blendMode` normal/add/multiply/screen/soft-light | `blendMode` (others → `normal` + warning) |

`rotation` is written in the unit the composition declares in `meta.rotationUnit`: `deg` for every film
made under the unit rule (R8 US-001), `rad` for the legacy films the old Pixi player made. A composition
without the flag is a legacy film, so the converter multiplies its rotations by 180/π and the engine
always reads degrees. A precomp inherits its parent's unit unless it declares its own.

## Blend modes

| AEP `blendMode` | Engine | Notes |
|-----------------|--------|-------|
| `normal` | `normal` | the layer is drawn over the frame behind it |
| `add`, `multiply`, `screen` | the same | the GPU's own blending |
| `soft-light` | `soft-light` | the W3C soft-light formula, blended by the engine (R8 US-005) |
| anything else | `normal` | one warning `layer <id>: unsupported blendMode '<name>'` |

`soft-light` is not a GPU blend mode, so the engine blends it itself: the runtime draws the stage without
the soft-light layer — and without everything drawn after it — into a render target, and the layer's
material samples that frame, runs the W3C formula on its colour and writes the result
(`engine/src/core/softLight.ts`, `engine/docs/03-stage-2d.md` "Blend modes"). The layer's colour is scaled
by the layer's opacity before it goes into the formula, because the engine blends in premultiplied alpha:
a white layer at half opacity is a half-grey blend, and soft light at 0.5 is the identity, so a
half-opaque white layer leaves the frame where it was.

**Why the engine and not a pre-mixed colour in the converter.** The alternative (the story's fallback) is
to map `soft-light` to a `normal` layer whose colour is pre-mixed toward the grade tint. That cannot work:
the converter does not know the frame behind the layer, so a pre-mixed tint is a flat wash of one colour
over the whole frame — the "grey wash" the grade was written to avoid. The engine can blend into the frame
that is really there, so it does. The cost is one extra render of the stage per soft-light layer per frame.

`overlay` and the other Photoshop blend modes are still unsupported: they warn and become `normal`.

A `soft-light` layer with layer effects is not supported yet: an isolated layer renders its own
content alone, so its effects would run on the frame behind it. The engine warns about it
(`layer <id>: a soft-light layer with effects is not supported; the effects run on the frame behind it`).

## Layers

| AEP kind | MotionDoc | Notes |
|----------|-----------|-------|
| `shape` `path.kind: rect` / `ellipse`, `size [w, h]`, `fill`, `stroke?`, `radius?` | `shape` rect / ellipse | `path.size` is the shape's own size; position/anchor as above |
| `shape` `path.kind: polystar`, `starType`, `points`, `outerRadius`, `innerRadius?` | `shape` polystar | the size is the outer radius twice over; see Shapes |
| `text` `source`, `style { font, size, fill, weight, align, boxWidth, lineHeight?, letterSpacing?, stroke? }` | `text` with `style { fontFamily, fontSize, fill, fontWeight, align, wordWrapWidth: boxWidth, … }` | `effects: [{ name: 'drop-shadow' }]` → `style.dropShadow` (see Effects) |
| `image` `assetId` | `image` `asset` | asset `{ type: 'image', url: src }`; natural size from the asset's `width`/`height` |
| `precomp` `compId` | `group` whose children are the precomp's layers | children's times are already relative to the precomp start (`group.start = inPoint/fps`); the group's `pivot`/transform as above |
| `audio` | not a layer | added to `audio[]` (`level`, start/end) for the player to play in sync |
| `video` | skipped + warning | later |
| `model3d` | `three` layer (R7 / A3) | see 3D |
| `stage3d` + its `actor3d` / `prop3d` members | one `three` layer | see 3D |

Layer order: stored films already list layers back first (the background shape is `layers[0]`), like MotionDoc.
Keep each layer list's order; do not reverse (checked against a stored film in the browser, US-007).

## Shapes

A `shape` layer keeps its kind: a `rect` (rounded when it has a `radius`), an `ellipse` or a
`polystar` (R8 US-004). The engine's shape layer states its size (`width`, `height`); a polystar's
size is its outer radius twice over, so the converter writes `width = height = 2 × outerRadius` and
the engine measures the layer the same way when it leaves the size out.

A polystar is drawn from its points: a star has `2 × points` corners that alternate the outer radius
and the inner radius, a polygon has `points` corners, all of them on the outer radius (a polygon
ignores the inner radius). The first corner is straight up and the rest go clockwise, the way After
Effects draws them, so the price burst badge and the promo light rays read the same as in the old
player. The star's own `rotation` and its roundness have no engine counterpart yet, so they are
dropped with a warning that names the layer.

## Effects

`web/src/motion/aep/effects.ts` is the one place that maps a layer's AEP `effects` to the engine's layer
`effects`; every layer kind goes through it (R8 US-003).

| AEP effect | Engine effect | Params |
|------------|---------------|--------|
| `drop-shadow` | `dropShadow` | `color`, `alpha` = opacity, `distance` (scaled, see below), `angle` = direction − 90, `blur` = softness |
| `gaussian-blur` | `gaussianBlur` | `strength` = blurriness (scaled) |
| `glow` | `glow` | `color`, `strength` = intensity × opacity, `distance` = radius (scaled) |
| `brightness-contrast` | `brightnessContrast` | `brightness`, `contrast` |
| `hue-saturation` | `hueSaturation` | `hue` = master-hue, `saturation` = master-saturation / 100 |
| anything else | dropped | one warning `layer <id>: unsupported effect '<name>'` |

- **Scale.** The old Pixi player drew every composition on a stage whose longest side was 960 px, and it
  measured a length (a blur strength, a shadow distance) in stage pixels. The engine works in the
  composition's own pixels, so those lengths are scaled by `max(compW, compH) / 960`.
- **Direction.** The AEP `direction` is the compass direction a shadow falls, counted clockwise from up
  (0 = up, 90 = right, 180 = down); the engine's `angle` is the same vector counted clockwise from the
  right (0 = right, 90 = down). They differ by a quarter turn, so `angle = direction − 90`: a direction of
  180 puts the shadow below the layer.
- **Text.** A text layer's shadow stays in `style.dropShadow` (the engine draws it into the text's own
  canvas, so it follows the glyphs and the text's measured size); every other effect of a text layer goes
  into the layer's `effects` like on any other layer.
- A keyframed effect param keeps its first value and warns; `enabled: false` keeps the effect disabled.

## 3D (A3)

**model3d** → `three` layer of `viewport.width × viewport.height`, transparent background, lighting preset from
`lighting.preset`. `source.type: primitive, shape: can` → a `cylinder` (radiusTop = radiusBottom = 0.5,
height = `proportions.height`) with `material.map` = the `textures.label` image asset and `material.color` =
`textures.side`, roughness/metalness from `material`. `source.type: gltf` → `gltf` object. `view.rotation`
(degrees, keyframed `[x, y, z]`) → `object:<id>` rotation tweens. Camera: fov from `camera.fov`, distance chosen
so the object's height × `camera.fit` fills the viewport height.

**stage3d** (the world) → `three` layer of `viewport` size; `camera.position`/`target`/`fov` → `camera`;
`lights.preset` → `lighting.preset` (unknown presets → `studio` + warning); `set.ground` → a `plane` object
(`groundSize`, rotated −90° on x, `material.color`); `set.backdrop` → a `plane` object with `material.map` = the
backdrop image, placed at `z = −set.wall.distance`, height `set.wall.height` (flat: `curve` ignored, warning).
Members are the layers with `stage === <world id>` in the same layer list; they are removed from the 2D list.

- `actor3d` → `gltf` object (`assetId`, `height` default 1.0); `marks` `[x, z, facingDeg]` (or keyframed list)
  → `position.x/z` and `rotation.y` (and tweens when keyframed); `clips[0]` → `animation { clip: name,
  loop, offset: startFrame/fps }`. A clip that lives in another asset → warning, the actor plays its own first clip.
- `prop3d` → `gltf` (or primitive) object, `size` → `geometry.height`, `position` / `rotation` / `scale`
  (keyframed → tweens). `attach` (to a bone) → placed at the actor's position + `[0.25, 0.9 × height, 0]` with a
  warning (bone attach is later work).
- `style.shading: toon`, `outline` → warning (later).

## Player (A4)

`web/src/player/Player.tsx` keeps its props and `PlayerHandle` (`play`, `pause`, `seek(frame)`, `getFrame`,
`ready`, capture). With `VITE_ENGINE` unset or `motion` (default from A4 US-006; `pixi` opts out) it converts with `aepToMotion` and mounts
`<MotionPlayer>`; with `library` it keeps the old path until A5 deletes it. Audio cues play through
`HTMLAudioElement`s started/seeked from the clock.
