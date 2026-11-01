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
| layer `blendMode` normal/add/multiply/screen | `blendMode` (others → `normal` + warning) |

## Layers

| AEP kind | MotionDoc | Notes |
|----------|-----------|-------|
| `shape` `path.kind: rect` / `ellipse`, `size [w, h]`, `fill`, `stroke?`, `radius?` | `shape` rect / ellipse | `path.size` is the shape's own size; position/anchor as above |
| `text` `source`, `style { font, size, fill, weight, align, boxWidth, lineHeight?, letterSpacing?, stroke? }` | `text` with `style { fontFamily, fontSize, fill, fontWeight, align, wordWrapWidth: boxWidth, … }` | `effects: [{ name: 'drop-shadow' }]` → `style.dropShadow` (distance, direction → angle, softness → blur, opacity → alpha, color) |
| `image` `assetId` | `image` `asset` | asset `{ type: 'image', url: src }`; natural size from the asset's `width`/`height` |
| `precomp` `compId` | `group` whose children are the precomp's layers | children's times are already relative to the precomp start (`group.start = inPoint/fps`); the group's `pivot`/transform as above |
| `audio` | not a layer | added to `audio[]` (`level`, start/end) for the player to play in sync |
| `video` | skipped + warning | later |
| `model3d` | `three` layer (R7 / A3) | see 3D |
| `stage3d` + its `actor3d` / `prop3d` members | one `three` layer | see 3D |

Layer order: stored films already list layers back first (the background shape is `layers[0]`), like MotionDoc.
Keep each layer list's order; do not reverse (checked against a stored film in the browser, US-007).

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
