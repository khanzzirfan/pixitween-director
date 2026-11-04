# Authoring a MotionDoc

A MotionDoc is one JSON object: a stage, a list of layers and a timeline. This page is the short version —
the units, the rules that silently reject a doc, the vocabulary, and six complete recipes to copy.

The contracts live elsewhere and are the authority:

| Page | Is the contract for |
|------|--------------------|
| [01-schema.md](01-schema.md) | every field, every default, every cross-field rule |
| [02-timeline.md](02-timeline.md) | the clock, target paths, tweens, presets |
| [05-effects.md](05-effects.md) | the effect list and where each one may be used |
| [camera-guide.md](camera-guide.md) | shots, rig moves, camera presets, camera paths |

A doc is checked twice: `parseMotionDoc` (shape and cross-field rules) and `validateTargets` (tween targets
and property names). Both run before a doc plays, and each error carries the path of the field that broke
(`layers[2].tweens[0].to.rotation`).

## The smallest doc that plays

```json
{
  "version": 1,
  "width": 1920,
  "height": 1080,
  "duration": 4,
  "layers": [
    { "id": "title", "type": "text", "text": "Hello", "x": 960, "y": 540 }
  ]
}
```

`version`, `width`, `height`, `duration` and `layers` are required. `fps` (30), `background` (`#000000`),
`assets` (`{}`) and `effects` (`[]`) have defaults. Every object is strict: an unknown key is an error, not a
typo that is quietly ignored.

## Units and coordinates

| What | Unit | Notes |
|------|------|-------|
| time (`duration`, `start`, `end`, `at`, tween `duration`) | **seconds** | `fps` (30) only steps frames and exports |
| 2D position (`x`, `y`), sizes, `letterSpacing` | **pixels** | stage space, origin top-left, `y` grows **down** |
| `rotation` on a 2D layer | **degrees**, clockwise | |
| 3D position, camera `position`/`lookAt`, `shadow.y` | **metres** | world space, `y` grows **up** |
| 3D `rotation` | **degrees**, XYZ order | |
| `camera.fov` | **degrees**, vertical | 10 … 120 |
| `alpha` | 0 … 1 | |
| `scale` | a factor | 1 is unscaled; 2 is twice as big |
| colours | `#rrggbb` or `#rrggbbaa` | |

Two spaces, and they do not mix: a 2D layer lives in **stage pixels**, a `three` layer's inside lives in
**metres**. A `three` layer still has a pixel `x`/`y`/`width`/`height` — that is where its render target sits
on the stage.

### The anchor

`anchor` is `[ax, ay]`, each 0 … 1, default `[0.5, 0.5]`. It is the point of the layer that sits at `x`, `y` —
and the point that rotation and scale act about.

```jsonc
"x": 960, "y": 540, "anchor": [0.5, 0.5]   // the layer's centre sits at the middle of the stage
"x": 960, "y": 540, "anchor": [0, 0]      // the layer's top-left corner sits there
"x": 960, "y": 540, "anchor": [0, 1]      // the layer's bottom-left corner sits there
```

`pivot` is the pixel-sized version of the same idea: give `[px, py]` and it overrides `anchor` with an exact
pixel offset from the layer's top-left corner.

A `group` has no size, so its `anchor` is ignored — the pivot is its origin and its children are placed in
the group's own space.

### Layer order

`layers` is an array and **the first layer is at the back**. Later layers draw on top of earlier ones. There
is no `z` field on a 2D layer; to change the stacking, reorder the array.

## The eight rules that reject a doc

These are the cross-field rules in [01-schema.md](01-schema.md#cross-field-rules-superrefine), in plain words.
Each one gives an error whose path points at the offending field.

1. **Every id is unique.** Layer ids are unique across the whole doc, group children included. Object ids and
   light ids are unique inside their layer, effect ids inside their effect list.
2. **Every asset reference resolves.** An `asset` id must exist in `assets` and have the right `type` — an
   `image` layer needs an image asset, a `gltf` geometry needs a gltf asset, a `material.map` needs an image.
3. **`end` is after `start`, and a child stays inside its group.** A layer's `end` must be greater than its
   `start`. Inside a group, a child's `end` (after defaults) may not be past the group's own length.
4. **No layer outlives the doc.** A top-level `end` may not be past `duration`. Omit `end` and it defaults to
   the parent's end, which for a top-level layer is the doc duration.
5. **A tween fits inside its layer.** `at + duration × (repeat + 1)` may not exceed the layer's length
   (`end - start`). `at` is relative to the layer's `start`.
6. **The entrance and the exit fit too.** `enter.duration + exit.duration` may not exceed the layer's length.
7. **The doc stays small.** At most 200 layers in total (group children count), group nesting at most 4 deep.
8. **`target` is for 3D objects only.** A preset's `target` is only allowed on a `three` layer's `loop`, and it
   must name an object of that layer (`object:<id>`). The loop presets that accept one are `spin`, `float` and
   `sway`.

Four more the camera and the effects add:

- An effect must be allowed where it is used: `dof` only on a `three` layer, `glow`/`dropShadow`/`outline`
  only on 2D layers, and none of those four on the doc's stage effects. The rest are allowed anywhere.
- The camera presets (`cameraTo`, `crane`, `dollyZoom`, `orbit`, `handheld`) only work on a `three` layer, and
  `cameraTo` needs a `params.shot` to frame.
- A `camera.path` declares the camera, so the same layer cannot also tween `position` or `lookAt` on it.
- A `camera.shot`'s `subject` must name objects of the same layer (`object:<id>` or `objects:<id>,<id>`).

## Presets

A preset is a named piece of motion. It goes in `enter`, `exit` or `loop`:

```jsonc
"enter": { "name": "slideInUp" },                       // at the layer's start
"exit":  { "name": "fadeOut", "duration": 0.8 },        // ends at the layer's end
"loop":  { "name": "pulse", "duration": 1.2 }           // between the two
```

`duration` is optional; the default is below. For a **loop** the duration is its **period**, not the whole
move, and the loop only runs whole periods — a layer shorter than one period gets nothing.

| Preset | Kind | Default | What it does |
|--------|------|---------|--------------|
| `fadeIn` | enter | 0.6 s | alpha 0 → full |
| `fadeInUp` | enter | 0.7 s | fades in while rising half its own height |
| `fadeInDown` | enter | 0.7 s | fades in while falling half its own height |
| `fadeInLeft` | enter | 0.7 s | fades in while coming in from the right |
| `fadeInRight` | enter | 0.7 s | fades in while coming in from the left |
| `slideInUp` | enter | 0.6 s | slides up from below its own size, fading in |
| `slideInDown` | enter | 0.6 s | slides down from above its own size, fading in |
| `slideInLeft` | enter | 0.6 s | slides in from the right, fading in |
| `slideInRight` | enter | 0.6 s | slides in from the left, fading in |
| `zoomIn` | enter | 0.6 s | scales from 30 % while fading in |
| `popIn` | enter | 0.5 s | scales from 0 with a slight overshoot (`back.out`) |
| `rotateIn` | enter | 0.7 s | swings in from −200° while fading in |
| `dropIn` | enter | 0.9 s | falls from above and bounces to a stop |
| `fadeOut` | exit | 0.5 s | alpha → 0 |
| `fadeOutUp` | exit | 0.6 s | fades out while rising |
| `fadeOutDown` | exit | 0.6 s | fades out while falling |
| `slideOutLeft` | exit | 0.6 s | slides out to the left, fading out |
| `slideOutRight` | exit | 0.6 s | slides out to the right, fading out |
| `zoomOut` | exit | 0.5 s | scales down to 30 %, fading out |
| `spin` | loop | 4 s | one full turn per period (`params.turnsPerSecond`, default 0.25) |
| `float` | loop | 3 s | bobs up and back (`params.amplitude`, 12 px, or 0.05 m on a 3D object) |
| `pulse` | loop | 1.2 s | breathes 6 % larger and back |
| `sway` | loop | 2.4 s | swings side to side (`params.degrees`, default 4°) |
| `cameraTo` | enter | 1.5 s | travels the camera to the shot in `params.shot` (three layers only) |
| `crane` | enter | 2 s | lifts the camera by `params.height` metres (default 1), keeping the look-at point |
| `dollyZoom` | enter | 1.5 s | dollies in by `params.amount` (default 0.5) while the lens widens |
| `orbit` | loop | 6 s | swings the camera around the look-at point by `params.degrees` (default 30) and back |
| `handheld` | loop | 2 s | wobbles the view by `params.amount` degrees (default 0.6), the same way every time |

On a `three` layer, `spin`, `float` and `sway` can be retargeted at an object with
`"target": "object:<id>"`: `spin` turns it around Y, `float` bobs it up and down, `sway` rocks it around Z.

## Target paths

A tween names what it moves with `target` and what it moves with `to` / `from`. Omit `target` and it moves the
layer itself.

| Target | Properties | Units |
|---------|------------|-------|
| the layer (no `target`) | `x`, `y`, `alpha`, `rotation`, `scale`, `scaleX`, `scaleY` | px, 0…1, degrees, factor |
| an `image` layer | also `tint` | colour |
| a `text` layer | also `fill` | colour |
| a `shape` layer | also `fill` | colour |
| `effect:<id>` | the params that effect type declares tweenable | see [05-effects.md](05-effects.md) |
| `camera` (three layers) | `position.x/y/z`, `lookAt.x/y/z`, `fov`, `rig.pan`, `rig.tilt`, `rig.roll`, `rig.dolly`, `rig.truck`, `rig.pedestal` | metres, degrees |
| `object:<id>` (three layers) | `position.x/y/z`, `rotation.x/y/z`, `scale`, `scale.x/y/z`, `material.color`, `material.emissive`, `material.emissiveIntensity`, `material.roughness`, `material.metalness`, `material.opacity` | metres, degrees, factor, colour |
| `light:<id>` (three layers) | `intensity`, `color`, `position.x/y/z` | |

```jsonc
{
  "target": "camera", "at": 0, "duration": 4, "ease": "sine.inOut",
  "from": { "position.z": 6 }, "to": { "position.z": 3.4 }
}
```

`at` and `duration` are seconds relative to the layer's `start`. `duration: 0` is a `set` — the value snaps.
`from` is optional: a missing key starts from the value the layer has when the timeline is built. `ease`
defaults to `power2.inOut`.

An `effect:<id>` tween names an effect **on the same layer**. The doc's stage effects are not tweenable.

## Effects

An effect is `{ id, type, enabled, params }`. `id` is local to its list and is what an `effect:<id>` tween
targets. Where it may be used:

| Type | Where | Params (default) | Tweenable |
|------|-------|------------------|-----------|
| `bloom` | anywhere | `intensity` 1, `threshold` 0.85, `smoothing` 0.1, `radius` 0.7 | intensity, threshold, smoothing |
| `vignette` | anywhere | `offset` 0.35, `darkness` 0.6 | both |
| `chromaticAberration` | anywhere | `offsetX` 0.0015, `offsetY` 0.0015 | both |
| `noise` | anywhere | `opacity` 0.15 | opacity |
| `brightnessContrast` | anywhere | `brightness` 0, `contrast` 0 | both |
| `hueSaturation` | anywhere | `hue` 0, `saturation` 0 | both |
| `sepia` | anywhere | `intensity` 1 | intensity |
| `grayscale` | anywhere | `opacity` 1 | opacity |
| `pixelate` | anywhere | `granularity` 8 | granularity |
| `scanlines` | anywhere | `density` 1.25, `opacity` 0.4 | density, opacity |
| `dotScreen` | anywhere | `scale` 1, `angle` 45 | scale, angle |
| `tiltShift` | anywhere | `offset` 0, `rotation` 0, `focusArea` 0.4, `feather` 0.3 | all |
| `blur` | anywhere | `scale` 1 | scale |
| `glow` | 2D layers | `color` `#ffffff`, `strength` 2, `distance` 10 | color, strength |
| `dropShadow` | 2D layers | `color` `#000000`, `alpha` 0.5, `distance` 6, `angle` 45, `blur` 4 | color, alpha, distance, angle, blur |
| `outline` | 2D layers | `color` `#000000`, `thickness` 2, `alpha` 1 | color, thickness, alpha |
| `dof` | `three` layers | `focusDistance` 5, `focusRange` 2, `bokehScale` 2 | all three |

An effect on a 2D layer **isolates** it: the layer is rendered alone through the chain and shown in its place.
That is what lets `glow` and `dropShadow` sample the layer's alpha — they only look right on a layer with a
transparent background.

## Camera

A `three` layer carries its own camera. Its rest pose is `camera.position` / `camera.lookAt` / `camera.fov`;
every camera move is measured from that pose, so a seek always lands on the same frame.

```jsonc
"camera": {
  "position": [0, 1.2, 6],       // metres: the camera's rest pose
  "lookAt": [0, 0.6, 0],         // metres: the point it looks at
  "fov": 35,                     // degrees: the vertical field of view (10…120)
  "near": 0.05,                  // metres: the near clip plane
  "far": 200,                    // metres: the far clip plane
  "shot": { /* … */ },           // optional: frame a shot by film vocabulary
  "path": { /* … */ }            // optional: a camera move declared as keys
}
```

- A **shot** frames the subject by film words — `size`, `angle`, `side` — instead of by camera numbers. The
  subject must name objects of the same layer (`object:<id>` or `objects:<id>,<id>`).
- A **path** is a camera move declared as keys and sampled statelessly, so the same second always gives the
  same pose. A path declares the camera, so the layer cannot also tween `position` or `lookAt`.
- The five camera presets (`cameraTo`, `crane`, `dollyZoom`, `orbit`, `handheld`) live in the preset table
  above. They only work on a `three` layer, and `cameraTo` needs a `params.shot`.

[camera-guide.md](camera-guide.md) is the whole camera vocabulary — the shot sizes, angles and sides, the rig
targets and the five camera presets — with four more recipes.

## Recipes

Every recipe below is a complete MotionDoc. Each one parses with `parseMotionDoc` and has no target errors.

### Recipe 1 — A title that comes in and goes out

The plainest good-looking doc: one line of type, a shape behind it, and a still backdrop.

```json
{
  "version": 1,
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "duration": 6,
  "background": "#0b0f14",
  "layers": [
    {
      "id": "plate",
      "type": "shape",
      "shape": "rect",
      "width": 1400,
      "height": 320,
      "radius": 24,
      "fill": "#111827",
      "x": 960,
      "y": 540,
      "alpha": 0.9,
      "enter": { "name": "fadeIn" },
      "exit": { "name": "fadeOut" }
    },
    {
      "id": "title",
      "type": "text",
      "text": "A QUIET MORNING",
      "x": 960,
      "y": 540,
      "style": {
        "fontSize": 96,
        "fontWeight": "700",
        "align": "center",
        "fill": "#f8fafc",
        "letterSpacing": 8
      },
      "enter": { "name": "slideInUp", "duration": 0.8 },
      "exit": { "name": "fadeOut", "duration": 0.8 }
    },
    {
      "id": "subtitle",
      "type": "text",
      "text": "single origin · roasted locally",
      "x": 960,
      "y": 620,
      "style": { "fontSize": 32, "align": "center", "fill": "#94a3b8" },
      "start": 0.6,
      "end": 5.4,
      "enter": { "name": "fadeInUp" },
      "exit": { "name": "fadeOut" }
    }
  ]
}
```

The `enter` plays at the layer's `start` and the `exit` ends at the layer's `end`, so a layer that starts at
0.6 s and ends at 5.4 s holds its title between them. `enter` + `exit` must fit inside the layer: 0.8 + 0.8
is 1.6 s of a 6 s layer here.

### Recipe 2 — A product turntable over a plate

A blurred plate behind, the product itself in 3D on top of it, turning once a minute.

```json
{
  "version": 1,
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "duration": 8,
  "background": "#0b0f14",
  "assets": {
    "plate": { "type": "image", "url": "/cartoon/backdrop.png" },
    "can": { "type": "gltf", "url": "/cartoon/props/can.glb" }
  },
  "layers": [
    {
      "id": "plate",
      "type": "image",
      "asset": "plate",
      "x": 960,
      "y": 540,
      "width": 1920,
      "height": 1080,
      "effects": [{ "id": "soft", "type": "blur", "params": { "scale": 1.2 } }]
    },
    {
      "id": "turntable",
      "type": "three",
      "x": 960,
      "y": 560,
      "width": 1400,
      "height": 1000,
      "background": "transparent",
      "lighting": { "preset": "golden" },
      "shadow": { "enabled": true, "opacity": 0.4, "y": 0 },
      "camera": {
        "position": [0, 1.1, 4.2],
        "lookAt": [0, 0.7, 0],
        "fov": 32,
        "near": 0.05,
        "far": 60
      },
      "objects": [
        {
          "id": "can",
          "geometry": { "type": "gltf", "asset": "can", "height": 1.4 },
          "position": [0, 0.7, 0]
        }
      ],
      "loop": {
        "name": "spin",
        "target": "object:can",
        "params": { "turnsPerSecond": 0.125 }
      }
    },
    {
      "id": "headline",
      "type": "text",
      "text": "CITRUS SPARKLING",
      "x": 960,
      "y": 160,
      "style": {
        "fontSize": 72,
        "fontWeight": "700",
        "align": "center",
        "fill": "#ffffff",
        "letterSpacing": 4
      },
      "enter": { "name": "slideInUp" },
      "exit": { "name": "fadeOut" }
    }
  ]
}
```

`spin`'s period is `1 / turnsPerSecond`, so `0.125` is one turn in 8 s — exactly one whole period in the
8 s layer. A loop that does not divide the layer gets dropped, so pick the period to fit.

The `three` layer is transparent, so the blurred plate behind it shows through where nothing is drawn.

### Recipe 3 — A glow that pulses on the text

`glow` is a 2D effect, and its `strength` is tweenable, so the halo can breathe.

```json
{
  "version": 1,
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "duration": 5,
  "background": "#0b0f14",
  "layers": [
    {
      "id": "word",
      "type": "text",
      "text": "GLOW",
      "x": 960,
      "y": 540,
      "style": {
        "fontSize": 220,
        "fontWeight": "800",
        "align": "center",
        "fill": "#fef3c7"
      },
      "effects": [
        { "id": "halo", "type": "glow", "params": { "color": "#fbbf24", "strength": 0.4, "distance": 18 } }
      ],
      "enter": { "name": "zoomIn" },
      "tweens": [
        {
          "target": "effect:halo",
          "at": 0.6,
          "duration": 2,
          "ease": "sine.inOut",
          "from": { "strength": 0.4 },
          "to": { "strength": 3.2 }
        },
        {
          "target": "effect:halo",
          "at": 2.6,
          "duration": 1.4,
          "ease": "sine.inOut",
          "from": { "strength": 3.2 },
          "to": { "strength": 0.4 }
        }
      ]
    }
  ]
}
```

`effect:halo` names the effect on the same layer. The two tweens share the property, so the second one picks
up where the first left off — no need to repeat the peak value in `from`, but writing it makes the intent
readable. Both tweens have to fit inside the layer: `0.6 + 2 = 2.6` and `2.6 + 1.4 = 4.0`, inside the 5 s
layer.

### Recipe 4 — A camera dolly

A slow push-in: the camera moves towards the subject while the subject stays put.

```json
{
  "version": 1,
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "duration": 6,
  "background": "#0b0f14",
  "layers": [
    {
      "id": "dolly",
      "type": "three",
      "x": 960,
      "y": 540,
      "width": 1920,
      "height": 1080,
      "background": "#0b0f14",
      "lighting": { "preset": "window" },
      "shadow": { "enabled": true, "opacity": 0.35, "y": 0 },
      "camera": {
        "position": [0, 1.2, 6],
        "lookAt": [0, 0.9, 0],
        "fov": 38,
        "near": 0.05,
        "far": 120
      },
      "objects": [
        {
          "id": "bottle",
          "geometry": { "type": "cylinder", "radiusTop": 0.09, "radiusBottom": 0.09, "height": 0.5 },
          "position": [0, 0.25, 0],
          "material": { "color": "#38bdf8", "roughness": 0.2, "metalness": 0.1 }
        },
        {
          "id": "cap",
          "geometry": { "type": "cylinder", "radiusTop": 0.05, "radiusBottom": 0.05, "height": 0.08 },
          "position": [0, 0.54, 0],
          "material": { "color": "#fbbf24", "roughness": 0.35, "metalness": 0.2 }
        },
        {
          "id": "plinth",
          "geometry": { "type": "cylinder", "radiusTop": 0.4, "radiusBottom": 0.45, "height": 0.6 },
          "position": [0, -0.3, 0],
          "material": { "color": "#1f2937", "roughness": 0.9, "metalness": 0 }
        }
      ],
      "tweens": [
        {
          "target": "camera",
          "at": 0,
          "duration": 6,
          "ease": "sine.inOut",
          "from": { "position.z": 6 },
          "to": { "position.z": 3.4 }
        }
      ]
    }
  ]
}
```

The camera's rest pose is the starting point, and the tween writes absolute values, so seeking to any second
gives the same frame. `position.z` is in metres: the camera travels from 6 m to 3.4 m from the bottle, and
the lens stays at 38°, so the bottle grows in frame.

A layer with a `camera.path` may **not** tween `position` or `lookAt` — the path declares the camera. Use one
or the other.

### Recipe 5 — A glTF clip with a spin loop

A character that plays its own animation while the turntable turns it.

```json
{
  "version": 1,
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "duration": 8,
  "background": "#141a1f",
  "assets": {
    "robot": { "type": "gltf", "url": "/cartoon/characters/robot.glb" }
  },
  "layers": [
    {
      "id": "dancer",
      "type": "three",
      "x": 960,
      "y": 540,
      "width": 1600,
      "height": 1080,
      "background": "#141a1f",
      "lighting": { "preset": "disco" },
      "shadow": { "enabled": true, "opacity": 0.45, "y": 0 },
      "camera": {
        "position": [0, 1.2, 5.2],
        "lookAt": [0, 1, 0],
        "fov": 36,
        "near": 0.05,
        "far": 120
      },
      "objects": [
        {
          "id": "robot",
          "geometry": { "type": "gltf", "asset": "robot", "height": 2.2 },
          "position": [0, 0, 0],
          "animation": { "clip": "Dance", "speed": 1, "loop": true }
        }
      ],
      "loop": {
        "name": "spin",
        "target": "object:robot",
        "params": { "turnsPerSecond": 0.125 }
      }
    },
    {
      "id": "caption",
      "type": "text",
      "text": "MIDNIGHT ROBOT",
      "x": 960,
      "y": 940,
      "style": {
        "fontSize": 64,
        "fontWeight": "700",
        "align": "center",
        "fill": "#e2e8f0",
        "letterSpacing": 6
      },
      "enter": { "name": "fadeInUp" },
      "exit": { "name": "fadeOut" }
    }
  ]
}
```

`animation` is only allowed on a `gltf` geometry, and `clip` names a clip inside the file — leave it out to
play the model's first clip. The `spin` loop is retargeted at the object, so it turns the robot around Y
instead of spinning the whole layer.

### Recipe 6 — A bloom that swells

`bloom` is allowed on a `three` layer, and its `intensity` is tweenable, so the highlights can swell.

```json
{
  "version": 1,
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "duration": 7,
  "background": "#0b0f14",
  "assets": {
    "can": { "type": "gltf", "url": "/cartoon/props/can.glb" }
  },
  "layers": [
    {
      "id": "hero",
      "type": "three",
      "x": 960,
      "y": 540,
      "width": 1600,
      "height": 1080,
      "background": "transparent",
      "lighting": { "preset": "night" },
      "shadow": { "enabled": true, "opacity": 0.4, "y": 0 },
      "camera": {
        "position": [0, 1.1, 4.6],
        "lookAt": [0, 0.75, 0],
        "fov": 36,
        "near": 0.05,
        "far": 80
      },
      "objects": [
        {
          "id": "can",
          "geometry": { "type": "gltf", "asset": "can", "height": 1.5 },
          "position": [0, 0.75, 0]
        }
      ],
      "effects": [
        { "id": "bloom", "type": "bloom", "params": { "intensity": 0.3, "threshold": 0.8, "smoothing": 0.1 } }
      ],
      "tweens": [
        {
          "target": "effect:bloom",
          "at": 0,
          "duration": 3.5,
          "ease": "sine.inOut",
          "from": { "intensity": 0.3 },
          "to": { "intensity": 1.6 }
        },
        {
          "target": "effect:bloom",
          "at": 3.5,
          "duration": 3.5,
          "ease": "sine.inOut",
          "from": { "intensity": 1.6 },
          "to": { "intensity": 0.3 }
        }
      ]
    }
  ]
}
```

The effect sits on the `three` layer, so the chain runs over that scene's render target and the bloom never
touches the rest of the stage. `threshold` decides what counts as a highlight — raise it to bloom only the
brightest parts.

## Things that bite

1. **A layer's `x`/`y` is its anchor point, not its top-left corner.** With the default `anchor` of
   `[0.5, 0.5]`, a text layer at `x: 960` is centred on the middle of a 1920-wide stage.
2. **A loop preset needs whole periods.** `floor(span / period)` periods run; a partial one is dropped. A
   layer shorter than one period gets no loop at all.
3. **`enter` and `exit` must fit inside the layer.** Their durations are counted against the layer's length.
4. **A tween's `at` is layer-local.** On a layer that starts at 3 s, `at: 0` is the layer's own start, not the
   doc's.
5. **An `effect:<id>` tween only sees the effects on its own layer.** The doc's `effects` are the stage's and
   are not tweenable.
6. **Unknown keys are errors.** Every object is strict, so a misspelled `enterance` fails the parse instead of
   doing nothing.
7. **The camera presets need a `three` layer**, and `cameraTo` needs a `params.shot` whose subject names
   objects of that layer.
8. **A camera preset needs a rig that exists at assemble time.** A layer whose objects are glTF builds its rig
   asynchronously and the presets expand before it does — so they expand to nothing. Use plain geometry, or
   `camera.shot`, which is resolved later.

## Where things live

| Thing | File |
|-------|------|
| the schema and the cross-field rules | `engine/src/schema/doc.ts` |
| the preset and effect names | `engine/src/schema/enums.ts` |
| the layer shapes | `engine/src/schema/layers2d.ts`, `engine/src/schema/layer3d.ts` |
| the shot vocabulary | `engine/src/schema/shot.ts` |
| the presets | `engine/src/timeline/presets.ts` |
| the tween targets and properties | `engine/src/timeline/targets.ts` |
| the effect table | `engine/src/effects/table.ts` |
| the JSON Schema for tool calling | `engine/src/schema/jsonSchema.ts` |

`engine/fixtures/*.json` are worked examples, and `engine/fixtures/camera-moves.json` is a worked example of
every shot size and every camera preset.
