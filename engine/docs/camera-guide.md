# Camera guide: shots, rig moves, presets and paths

The camera lives on a `three` layer. This guide is the authoring half of the camera: what every word
means, what the units are, and four complete recipes to copy.

`engine/docs/09-camera.md` is the contract (the maths, the numbers, the tests). This guide is the
"how do I write it" half. The vocabulary is defined once, in `engine/src/schema/shot.ts`
(`SHOT_SIZES`, `SHOT_ANGLES`, `SHOT_SIDES`), so the parser and this page cannot drift apart.

> This is the camera chapter of the authoring guide. `engine/docs/authoring.md` (M8) is the rest of it:
> the units, the cross-field rules, the preset and target vocabulary and six recipes.

## The camera in one layer

```jsonc
"camera": {
  "position": [0, 1.2, 6],       // metres, world space: the camera's rest pose
  "lookAt": [0, 0.6, 0],         // metres, world space: the point it looks at
  "fov": 35,                     // degrees, the vertical field of view (10…120)
  "near": 0.05,                  // metres: the near clip plane
  "far": 200,                    // metres: the far clip plane
  "shot": { /* … */ },           // optional: frame a shot by film vocabulary
  "path": { /* … */ }            // optional: a camera move declared as keys
}
```

`position`, `lookAt` and `fov` are the camera's **rest pose**. Everything else — a shot, a path, a
rig move, a preset — is measured from that rest pose, so seeking never integrates anything and
always lands on the same frame.

The units are metres, degrees and seconds, like the rest of the 3D layer. A `three` layer's
`width`/`height` are still stage pixels; only the camera inside it works in metres.

## Shot sizes (5)

A shot is declared by film words, not by camera numbers: `camera.shot` on a `three` layer.

```jsonc
"shot": {
  "subject": "objects:bottle,label",  // "object:<id>" or "objects:<id>,<id>" - objects of this layer
  "size": "closeUp",                   // one of the five sizes below
  "angle": "eye",                      // optional, default "eye"
  "side": "right3q",                   // optional, default "front"
  "fov": 14                            // optional, default 35
}
```

| Size | What it frames | Fraction of the frame height the subject fills | Fraction of the subject that is framed |
|------|----------------|------------------------------------------------|------------------------------------------|
| `extremeWide` | the whole scene, small in frame | 0.2 | 1 (all of it) |
| `wide` | the whole subject with room around it | 0.45 | 1 (all of it) |
| `medium` | the subject from the waist up | 0.8 | 0.6 (the upper 60 %) |
| `closeUp` | the head and shoulders | 1.6 | 0.3 (the upper 30 %) |
| `extremeCloseUp` | one detail: an eye, a logo, a screen | 3 | 0.15 (the upper 15 %) |

A shot frames a **part** of its subject, so the subject must name the **whole** thing you want
framed. A close-up of a robot's head is `subject: "objects:body,head"` — naming only the head
frames the top of the head instead.

## Angles (4)

The angle sets the camera's height relative to the look-at point. It is an elevation, so a `low`
angle looks up at the subject and a `high` angle looks down on it.

| Angle | Elevation | What it does |
|-------|-----------|--------------|
| `eye` | 0° | the camera stands at the subject's own height - neutral, documentary |
| `low` | −20° | the camera is below the subject and looks up: the subject looms, the hero shot |
| `high` | +25° | the camera is above the subject and looks down: the subject is vulnerable |
| `overhead` | +80° | almost straight down: a flat lay, a floor plan, a pattern |

## Sides (6)

The side sets the camera's azimuth around the subject, measured from the subject's facing (`+z`).
Negative is the subject's left.

| Side | Azimuth | What it does |
|------|---------|--------------|
| `front` | 0° | straight on: the subject faces the camera |
| `left3q` | −35° | three-quarter from the subject's left: depth without hiding the face |
| `right3q` | +35° | three-quarter from the subject's right - the same, mirrored |
| `leftProfile` | −90° | the subject in profile from its left |
| `rightProfile` | +90° | the subject in profile from its right |
| `back` | 180° | behind the subject: the view the subject sees, or an exit |

## Rig targets (6)

The rig moves are the camera-relative verbs. They are tweened like any other property, with
`target: "camera"`, and they are **offsets from the rest pose** - absolute values, not deltas, so
a tween writes the value it means and a seek lands on it exactly.

```jsonc
{ "target": "camera", "at": 0, "duration": 2, "ease": "sine.inOut",
  "from": { "rig.truck": 0 }, "to": { "rig.truck": 0.8 } }
```

| Target | Unit | A positive value moves the camera… | The film word |
|--------|------|------------------------------------|--------------|
| `rig.pan` | degrees | to its **left**, about its own up axis | pan |
| `rig.tilt` | degrees | the view **up**, about its own right axis | tilt |
| `rig.roll` | degrees | so its **right side tips up**, about the optical axis | roll |
| `rig.dolly` | metres | **towards** the subject, along the view direction | dolly in |
| `rig.truck` | metres | **right**, along the camera's own right axis | truck / track |
| `rig.pedestal` | metres | **up**, along the camera's own up axis | pedestal / crane up |

The order of composition is the film order: the travels (`truck`, `pedestal`, `dolly`) ride the
**rest pose's** axes, and only then do the turns (`pan`, `tilt`, `roll`) turn the camera about its
own axes. So a pan never changes where a truck puts the camera, and a dolly rides the optical axis,
so it changes no rotation - the subject keeps its size in frame, which is what a dolly is.

## Presets (5)

Five presets move the camera of a `three` layer. They are ordinary presets, so they go in
`enter`, `exit` or `loop` - and only on a `three` layer.

| Preset | Kind | Default | Parameters | What it does |
|--------|------|---------|------------|--------------|
| `cameraTo` | enter | 1.5 s | `shot` (a shot spec, **required**) | travels to a framed shot: the position, the look-at point and the lens |
| `crane` | enter | 2 s | `height` (metres, default 1) | lifts the camera, keeping the look-at point |
| `dollyZoom` | enter | 1.5 s | `amount` (0…0.8, default 0.5) | dollies in while the lens widens, so the subject keeps its size and the perspective stretches |
| `orbit` | loop | 6 s period | `degrees` (default 30) | swings around the look-at point and back |
| `handheld` | loop | 2 s period | `amount` (degrees, default 0.6) | wobbles the view a fraction of a degree, deterministically |

```jsonc
"enter": { "name": "cameraTo", "duration": 1.5,
  "params": { "shot": { "subject": "objects:body,head", "size": "medium", "fov": 24 } } },
"loop":  { "name": "orbit", "duration": 4, "params": { "degrees": 20 } }
```

- A **loop** preset's `duration` is its **period**, not the whole move. The loop fills the layer
  with `floor(span / period)` whole periods, so a layer shorter than one period expands to nothing.
- `cameraTo` frames the shot against the layer's **own objects**, so it needs the layer's rig.
- `orbit` and `handheld` start from the camera's rest pose. With `camera.shot` on the same layer,
  the rest pose *is* the framed shot, so the orbit swings around the shot's look-at point.
- `handheld` never leaves the camera more than `amount` degrees off, and shakes the same way every
  time: the noise is seeded from the layer, not from the clock.

## camera.path

A path is a camera move declared as keys, sampled statelessly on every update: the same local
time always gives the same pose, so a seek to 1 s, then 0, then 1 s ends where it began.

```jsonc
"camera": {
  "near": 0.05,
  "far": 120,
  "path": {
    "curve": "smooth",                       // "linear" | "smooth" (default "smooth")
    "keys": [
      { "t": 0, "position": [2.6, 1.6, 6.0], "lookAt": [-0.8, 1.7, 0.0], "fov": 38 },
      { "t": 1, "position": [0.4, 2.2, 4.6], "lookAt": [-1.0, 1.8, 0.0], "fov": 35 },
      { "t": 2, "position": [-2.8, 1.7, 5.2], "lookAt": [-0.9, 1.9, 0.0] }
    ]
  }
}
```

- `t` is **layer-local** seconds and must be sorted and strictly increasing; a path needs at least
  two keys, and every key must fall inside the layer.
- `smooth` runs a Catmull-Rom spline through the keys; `linear` moves in straight lines. Both are
  clamped at the ends: before the first key the camera holds the first pose, after the last key it
  holds the last one.
- `fov` is optional per key: a key that says nothing about the lens holds the value of the last
  key that did, so a path can change the lens once and keep it.
- A path **declares** the camera, so the same layer cannot also tween `position` or `lookAt` on the
  camera. Rig moves (`rig.pan`, `rig.dolly`, …) are fine: they ride on top of the path.

## Rules that bite

1. **The shot size decides the distance; the lens decides the perspective.** A tight shot on a wide
   lens puts the camera *inside* the subject. When a close-up ends up too close, use a longer lens
   (a smaller `fov`) - that moves the camera back without changing the framing.
2. **`near` must be smaller than the distance to the nearest part of the subject.** An extreme
   close-up stands a few centimetres away, so `near` has to be well under `0.1`.
3. **A shot's subject must name objects of the same layer.** `object:<id>` for one,
   `objects:<id>,<id>` for several.
4. **A camera preset needs a rig that exists at assemble time.** A layer whose objects are glTF or
   carry a texture builds its rig asynchronously, and the presets are expanded before that rig
   exists - so they expand to nothing. Use plain geometry for a camera preset, or use `camera.shot`
   (which is resolved later, when the rig arrives).
5. **A loop preset needs whole periods.** A layer shorter than one period gets nothing; give the
   loop a shorter period, or the layer more time.
6. **A path and camera position/lookAt tweens cannot share a layer.** The path declares the camera.
7. **The preset's "from" is the rest pose.** `cameraTo` needs a rest pose worth moving away from;
   the other presets need a rest pose that is already a good shot.

## Recipes

Every recipe below is a complete MotionDoc: it parses with `parseMotionDoc` as it stands.

### Recipe 1 - Product close-up with an orbit

A perfume bottle framed tight from the right three-quarter, on a long lens, with the camera
orbiting around it. The `closeUp` size would put the camera 18 cm from a 24 cm bottle, so the
`fov: 14` lens is what stands it outside the product and gives the flat, catalogue look.

```json
{
  "version": 1,
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "duration": 8,
  "background": "#0b0f14",
  "layers": [
    {
      "id": "product",
      "type": "three",
      "x": 960,
      "y": 540,
      "width": 1920,
      "height": 1080,
      "background": "transparent",
      "lighting": { "preset": "studio" },
      "shadow": { "enabled": true, "opacity": 0.35, "y": 0 },
      "camera": {
        "near": 0.05,
        "far": 60,
        "shot": {
          "subject": "objects:bottle,label",
          "size": "closeUp",
          "angle": "eye",
          "side": "right3q",
          "fov": 14
        }
      },
      "objects": [
        {
          "id": "bottle",
          "geometry": { "type": "cylinder", "radiusTop": 0.05, "radiusBottom": 0.05, "height": 0.24 },
          "position": [0, 0.12, 0],
          "material": { "color": "#1e3a5f", "roughness": 0.25, "metalness": 0.1 }
        },
        {
          "id": "label",
          "geometry": { "type": "cylinder", "radiusTop": 0.052, "radiusBottom": 0.052, "height": 0.1 },
          "position": [0, 0.17, 0],
          "material": { "color": "#fbbf24", "roughness": 0.5, "metalness": 0 }
        },
        {
          "id": "backdrop",
          "geometry": { "type": "box", "size": [4, 3, 0.1] },
          "position": [0, 1.5, -1.6],
          "material": { "color": "#1f2937", "roughness": 0.9, "metalness": 0 }
        }
      ],
      "loop": { "name": "orbit", "duration": 4, "params": { "degrees": 20 } }
    },
    {
      "id": "title",
      "type": "text",
      "text": "NIGHT BLOOM",
      "x": 960,
      "y": 900,
      "end": 8,
      "style": { "fontSize": 72, "fill": "#f8fafc", "align": "center", "letterSpacing": 6 }
    }
  ]
}
```

The orbit swings 20° around the shot's look-at point and back: two whole 4 s periods in the 8 s
layer. The camera keeps its height and its 18 cm distance, so the product stays the same size and
only the light on it changes.

### Recipe 2 - Crane reveal

The camera starts low and rises over the robot, keeping its look-at point: the subject stays framed
while the view swings from eye level to looking down on it.

```json
{
  "version": 1,
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "duration": 10,
  "background": "#0b0f14",
  "layers": [
    {
      "id": "reveal",
      "type": "three",
      "x": 960,
      "y": 540,
      "width": 1920,
      "height": 1080,
      "background": "transparent",
      "lighting": { "preset": "golden" },
      "shadow": { "enabled": true, "opacity": 0.4, "y": 0 },
      "camera": {
        "position": [0, 0.5, 7.5],
        "lookAt": [0, 1.3, 0],
        "fov": 40,
        "near": 0.05,
        "far": 120
      },
      "objects": [
        {
          "id": "floor",
          "geometry": { "type": "box", "size": [14, 0.1, 14] },
          "position": [0, -0.05, 0],
          "material": { "color": "#1f2937", "roughness": 0.9, "metalness": 0 }
        },
        {
          "id": "robot-body",
          "geometry": { "type": "box", "size": [1.2, 1.6, 0.7] },
          "position": [0, 0.8, 0],
          "material": { "color": "#e2e8f0", "roughness": 0.35, "metalness": 0.05 }
        },
        {
          "id": "robot-head",
          "geometry": { "type": "box", "size": [1, 0.8, 0.5] },
          "position": [0, 2, 0],
          "material": { "color": "#38bdf8", "roughness": 0.25, "metalness": 0.2 }
        }
      ],
      "enter": { "name": "crane", "duration": 3, "params": { "height": 1.8 } }
    }
  ]
}
```

`crane` is an **enter** preset, so the move starts at the beginning of the layer. It lifts the
camera from `y = 0.5` to `y = 2.3` over 3 s and keeps the look-at point at `[0, 1.3, 0]`, so the
robot never leaves the frame - only the angle on it changes.

### Recipe 3 - Dolly zoom on a character

The vertigo move: the camera dollies in and the lens widens at the same time, so the character keeps
its size in frame while the perspective stretches.

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
      "id": "vertigo",
      "type": "three",
      "x": 960,
      "y": 540,
      "width": 1920,
      "height": 1080,
      "background": "transparent",
      "lighting": { "preset": "night" },
      "camera": {
        "position": [0, 1.4, 5],
        "lookAt": [0, 1.4, 0],
        "fov": 40,
        "near": 0.05,
        "far": 120
      },
      "objects": [
        {
          "id": "figure-body",
          "geometry": { "type": "box", "size": [0.9, 1.5, 0.5] },
          "position": [0, 0.75, 0],
          "material": { "color": "#334155", "roughness": 0.6, "metalness": 0 }
        },
        {
          "id": "figure-head",
          "geometry": { "type": "box", "size": [0.6, 0.65, 0.5] },
          "position": [0, 1.83, 0],
          "material": { "color": "#fbbf24", "roughness": 0.4, "metalness": 0.1 }
        }
      ],
      "enter": { "name": "dollyZoom", "duration": 2.5, "params": { "amount": 0.4 } }
    }
  ]
}
```

`amount` is a fraction of the camera's distance to its look-at point: 0.4 dollies the camera from
5 m to 3 m, and the lens opens from 40° to about 62° to keep the character the same size. The
rest pose has to be a good shot already, because the move starts from it.

### Recipe 4 - Handheld documentary feel

A camera held in a hand: a fraction of a degree of wobble, with a slow push-in on top of it. The
handheld preset writes `rig.pan` and `rig.tilt`; the push-in writes `rig.dolly`, and the two ride
on the same rest pose without fighting.

```json
{
  "version": 1,
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "duration": 10,
  "background": "#111827",
  "layers": [
    {
      "id": "documentary",
      "type": "three",
      "x": 960,
      "y": 540,
      "width": 1920,
      "height": 1080,
      "background": "transparent",
      "lighting": { "preset": "window" },
      "camera": {
        "position": [2.2, 1.55, 3.4],
        "lookAt": [-0.1, 1.05, 0],
        "fov": 35,
        "near": 0.05,
        "far": 120
      },
      "objects": [
        {
          "id": "figure",
          "geometry": { "type": "box", "size": [0.5, 1.7, 0.35] },
          "position": [-0.1, 0.85, 0],
          "material": { "color": "#475569", "roughness": 0.7, "metalness": 0 }
        },
        {
          "id": "counter",
          "geometry": { "type": "box", "size": [2.4, 0.9, 0.9] },
          "position": [-0.1, 0.45, 0.25],
          "material": { "color": "#78716c", "roughness": 0.8, "metalness": 0 }
        },
        {
          "id": "mug",
          "geometry": { "type": "cylinder", "radiusTop": 0.045, "radiusBottom": 0.04, "height": 0.1 },
          "position": [0.2, 0.95, 0.3],
          "material": { "color": "#e7e5e4", "roughness": 0.4, "metalness": 0 }
        }
      ],
      "loop": { "name": "handheld", "duration": 2, "params": { "amount": 1.2 } },
      "tweens": [
        {
          "target": "camera",
          "at": 0,
          "duration": 10,
          "ease": "sine.inOut",
          "from": { "rig.dolly": 0 },
          "to": { "rig.dolly": 0.6 }
        }
      ]
    }
  ]
}
```

`handheld`'s `duration` is its **period**: a 2 s wobble, five whole periods in the 10 s layer. The
wobble never leaves the camera more than 1.2° off, and it is identical every time the layer is
expanded, so a seek to any second gives the same frame.

## Where the camera lives in the code

| Thing | File |
|-------|------|
| the shot vocabulary (`SHOT_SIZES`, `SHOT_ANGLES`, `SHOT_SIDES`) | `engine/src/schema/shot.ts` |
| the shot spec on the three layer, `camera.path` | `engine/src/schema/layer3d.ts` |
| framing a shot (the maths) | `engine/src/three/camera/frameShot.ts` |
| the rig moves (the maths) | `engine/src/three/camera/rig.ts` |
| sampling a path | `engine/src/three/camera/path.ts` |
| the five presets | `engine/src/timeline/presets.ts` |
| the camera's rest pose, the shot resolution, the rig offsets | `engine/src/three/threeNode.ts` |
| the tweenable camera properties | `engine/src/timeline/targets.ts` |

A worked example of every shot size and every preset is
`engine/fixtures/camera-moves.json`, which the lab page plays chapter by chapter.
