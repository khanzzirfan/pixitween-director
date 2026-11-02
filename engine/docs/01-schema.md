# 01. The MotionDoc schema

Files: `engine/src/schema/*.ts` (zod 3, already a dependency). Pure: imports only `zod`. Every object is
`.strict()` (unknown keys are errors). Defaults are applied by `parseMotionDoc`, so code after parsing never
sees `undefined` for a field that has a default.

```ts
export function parseMotionDoc(input: unknown):
  | { ok: true; doc: MotionDoc }                       // MotionDoc = z.output (defaults filled)
  | { ok: false; errors: Array<{ path: string; message: string }> };   // path like "layers[2].tweens[0].to.rotation"
```

`MotionDocInput` (`z.input`) is the type for authoring; `MotionDoc` (`z.output`) is the type the engine uses.

## Shared scalars

| Name | Rule |
|------|------|
| `Id` | `/^[A-Za-z][A-Za-z0-9_-]{0,63}$/` |
| `Color` | `/^#([0-9a-fA-F]{6}\|[0-9a-fA-F]{8})$/` (`#rrggbb` or `#rrggbbaa`) |
| `Seconds` | finite number ≥ 0 |
| `Vec3` | `[number, number, number]`, finite |
| `Ease` | string matching `/^(none\|linear\|(power[1-4]\|sine\|expo\|circ\|back\|elastic\|bounce\|quad\|cubic\|quart\|quint)(\.(in\|out\|inOut))?)(\([0-9.,\s]*\))?$/`, default `"power2.inOut"`. Example: `back.out(1.7)` |
| `ParamValue` | `number \| string \| boolean` |

## MotionDoc

| Field | Type | Default | Rule |
|-------|------|---------|------|
| `version` | literal `1` | – | required |
| `width`, `height` | int | – | 16 … 4096 |
| `fps` | int | 30 | 1 … 120 |
| `duration` | Seconds | – | > 0, ≤ 600 |
| `background` | Color or `"transparent"` | `"#000000"` | |
| `assets` | `Record<Id, Asset>` | `{}` | |
| `layers` | `Layer[]` | – | 1 … 200 layers in total, counting group children; draw order is array order, first at the back |
| `effects` | `Effect[]` | `[]` | applied to the whole frame (stage effects), ≤ 8; `dof`, `glow`, `dropShadow`, `outline` not allowed here |

`Asset = { type: "image" | "gltf"; url: string }`. `url` is `http(s)://…`, a root-relative path (`/dev/product.png`)
or a `data:` URL.

## Layer base (every layer type)

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `id` | Id | – | unique across the whole doc, including group children |
| `type` | discriminator | – | `image`, `text`, `shape`, `group`, `three` |
| `name` | string | – | label only |
| `start` | Seconds | 0 | when it appears. Top level: doc time. Inside a group: time relative to the group's `start` |
| `end` | Seconds | parent end | when it disappears (exclusive). Must be > `start` |
| `x`, `y` | number | 0 | position of the anchor point, in stage pixels (group children: in the group's space) |
| `anchor` | `[ax, ay]`, each 0 … 1 | `[0.5, 0.5]` | point of the layer that sits at `x, y` and that rotation and scale act about |
| `scale` | number or `[sx, sy]` | 1 | |
| `rotation` | number (degrees) | 0 | clockwise |
| `alpha` | 0 … 1 | 1 | |
| `blendMode` | `normal \| add \| multiply \| screen` | `normal` | |
| `effects` | `Effect[]` | `[]` | ≤ 8 per layer; `dof` only on `three` layers, `glow`/`dropShadow`/`outline` only on 2D layers ([05-effects.md](05-effects.md)) |
| `enter` | PresetRef | – | entrance, placed at the layer's `start` |
| `exit` | PresetRef | – | exit, placed to end at the layer's `end` |
| `loop` | PresetRef | – | continuous motion between the end of `enter` and the start of `exit` |
| `tweens` | `Tween[]` | `[]` | ≤ 64 per layer |

## Layer types

**image**: `asset` (Id of an asset with `type: "image"`, required), `width?`, `height?` (pixels; when one is
given the other keeps the aspect ratio; when neither, the natural size), `tint` (Color, default `#ffffff`).

**text**: `text` (1 … 2000 chars), `style`:

| Field | Default |
|-------|---------|
| `fontFamily` | `"Inter, Helvetica, Arial, sans-serif"` |
| `fontSize` | 64 (4 … 512) |
| `fontWeight` | `"400"` (`"100"`…`"900"`, `"normal"`, `"bold"`) |
| `fontStyle` | `"normal"` (`"italic"`) |
| `fill` | `"#ffffff"` |
| `align` | `"left"` (`"center"`, `"right"`) |
| `wordWrapWidth` | none (no wrapping); when set, wrap at this width in pixels |
| `lineHeight` | none (font default) |
| `letterSpacing` | 0 |
| `stroke` | none; `{ color: Color, width: number 0 … 64 }` |
| `dropShadow` | none; `{ color: Color, alpha: 0…1 = 0.5, blur: 0…64 = 4, distance: 0…256 = 4, angle: degrees = 45 }` |

**shape**: `shape` (`"rect" \| "ellipse"`), `width`, `height` (> 0), `fill` (Color, default `#ffffff`),
`radius` (rect corner radius, default 0), `stroke?` (`{ color, width }`).

**group**: `children: Layer[]` (≥ 1). Nesting depth ≤ 4. A group has no size of its own; its `anchor` is ignored
(the pivot is its origin).

**three**: a Three.js scene drawn into a sprite.

| Field | Type | Default |
|-------|------|---------|
| `width`, `height` | int 16 … 2048 | – (the render size in pixels; also the sprite's size before `scale`) |
| `background` | Color or `"transparent"` | `"transparent"` |
| `camera` | `{ position: Vec3 = [0, 1.2, 6], lookAt: Vec3 = [0, 0.6, 0], fov: 10…120 = 35, near = 0.1, far = 200 }` | |
| `lighting` | `{ preset: "studio" \| "window" \| "golden" \| "none" = "studio", environment: "room" \| "none" = preset's }` | |
| `lights` | `Light3D[]` (≤ 6) | `[]` extra lights |
| `shadow` | `{ enabled: boolean = true, opacity: 0…1 = 0.35, y: number = 0 }` | ground shadow catcher at height `y` |
| `objects` | `Object3D[]` | 1 … 50 |

`Light3D = { id, type: "ambient" | "directional" | "point" | "spot", color = "#ffffff", intensity ≥ 0 = 1,
position: Vec3 = [3, 5, 4], target: Vec3 = [0, 0, 0], castShadow = false }`.
The preset lights are addressable as `light:key`, `light:fill`, `light:rim`, `light:ambient`, so extra light
ids must not be one of those four.

`Object3D`:

| Field | Default | Rule |
|-------|---------|------|
| `id` | – | unique within the layer |
| `geometry` | – | one of `{ type: "box", size: Vec3 }`, `{ type: "sphere", radius }`, `{ type: "cylinder", radiusTop, radiusBottom, height }`, `{ type: "torus", radius, tube }`, `{ type: "plane", size: [w, h] }`, `{ type: "gltf", asset: Id, height?: number }` (positive sizes; `asset` must be a `gltf` asset) |
| `position` | `[0, 0, 0]` | world units (metres) |
| `rotation` | `[0, 0, 0]` | degrees, XYZ order |
| `scale` | 1 | number or Vec3 |
| `material` | see below | ignored for `gltf` |
| `castShadow` | true | |
| `animation` | – | `gltf` only: `{ clip?: string, speed: 0…10 = 1, loop: boolean = true, offset: Seconds = 0 }` |

`material = { color = "#cccccc", roughness 0…1 = 0.4, metalness 0…1 = 0, emissive = "#000000",
emissiveIntensity ≥ 0 = 0, opacity 0…1 = 1, map?: Id (an image asset) }`.

## PresetRef

`{ name: PresetName, duration?: Seconds > 0, ease?: Ease, target?: string, params?: Record<string, ParamValue> }`.
Preset names and their defaults are in [02-timeline.md](02-timeline.md#presets). `target` is only allowed on a
`three` layer's `loop`, and must be `object:<id>`.

## Tween

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `target` | string | the layer | `effect:<id>` (any layer); on `three` layers also `camera`, `object:<id>`, `light:<id>` |
| `at` | Seconds | – | start, relative to the layer's `start` |
| `duration` | Seconds | – | 0 means a `set` |
| `ease` | Ease | `"power2.inOut"` | |
| `from` | `Record<string, number \| string>` | – | optional; missing keys start from the value at build time |
| `to` | `Record<string, number \| string>` | – | required, ≥ 1 key |
| `repeat` | int 0 … 100 | 0 | no infinite repeat (it would make the timeline infinite) |
| `yoyo` | boolean | false | |

The properties a target accepts are listed in [02-timeline.md](02-timeline.md#target-paths). The schema only
checks shapes; `validateTargets(doc)` (in `engine/src/timeline`) checks names and is run by the runtime before a
build.

## Effect

`Effect = { id, type: EffectType, enabled = true, params: Record<string, number | string> = {} }`, ids unique
within their list. Types, params and where each is allowed: [05-effects.md](05-effects.md). One list replaces the
old `filters` (Pixi) and `postFx` fields.


## Cross-field rules (`superRefine`)

1. Layer ids unique across the doc; object, light and effect ids unique within their layer or list.
2. Every `asset` reference exists and has the right `type` (image vs gltf).
3. `end > start` for every layer; a child's `end` (after defaults) is ≤ its group's `end - start`.
4. Top-level `end` ≤ `duration` (a default `end` is `duration`).
5. A tween's `at + duration × (repeat + 1)` ≤ the layer's length (`end - start`).
6. `enter.duration + exit.duration` ≤ the layer's length.
7. Total layer count ≤ 200; group depth ≤ 4.
8. `PresetRef.target` only on a `three` layer's `loop`, naming an existing object.

Each rule failing gives one error whose `path` points at the field (for example `layers[3].end`).

## Example

```json
{
  "version": 1,
  "width": 1920, "height": 1080, "duration": 6, "background": "#101418",
  "assets": {
    "plate": { "type": "image", "url": "/cartoon/backdrop.png" },
    "can":   { "type": "gltf",  "url": "/cartoon/props/can.glb" }
  },
  "layers": [
    { "id": "bg", "type": "image", "asset": "plate", "x": 960, "y": 540, "width": 1920, "effects": [{ "id": "soft", "type": "blur", "params": { "scale": 1 } }] },
    { "id": "hero", "type": "three", "x": 960, "y": 600, "width": 1000, "height": 1000,
      "objects": [{ "id": "can", "geometry": { "type": "gltf", "asset": "can", "height": 1.2 } }],
      "loop": { "name": "spin", "target": "object:can", "params": { "turnsPerSecond": 0.15 } },
      "effects": [{ "id": "glow", "type": "bloom", "params": { "intensity": 0.6 } }],
      "tweens": [{ "target": "camera", "at": 0, "duration": 6, "ease": "sine.inOut", "to": { "position.z": 4.5 } }] },
    { "id": "title", "type": "text", "text": "Fresh every morning", "x": 960, "y": 160,
      "style": { "fontSize": 96, "fontWeight": "700", "align": "center" },
      "enter": { "name": "slideInUp" }, "exit": { "name": "fadeOut" },
      "effects": [{ "id": "g", "type": "glow", "params": { "color": "#ffd27a", "strength": 2 } }],
      "tweens": [{ "target": "effect:g", "at": 1, "duration": 1.5, "to": { "strength": 0 } }] }
  ]
}
```
