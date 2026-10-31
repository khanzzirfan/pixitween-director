# 04. The `three` layer: a Three.js scene as a Pixi sprite

Files: `engine/src/three/*` (m4), `engine/src/three/postfx/*` (m6). `three` 0.184, plain (no `@react-three/*`).

## How it draws

```
ThreeNode
  scene ── camera, lights (preset rig + extras), shadow catcher, objects (meshes, glTF roots)
  canvas (2D, layer width × height) ── Texture.from(canvas) ── Sprite (the node's display)

update(t):
  apply time → glTF mixers, camera.lookAt(lookAtTarget)
  shared.render({ canvas, scene, camera, width, height, draw? })   // draw = postFx composer (m6)
  texture.source.update()
```

The tweens move the Three objects directly (the compiler writes `mesh.rotation.y`, `camera.position.z`,
`light.intensity` …); `update(t)` only applies what is not a plain property (glTF clip time, `lookAt`) and
draws. Because every visible value is set by the timeline before `update` runs, a seek draws the right frame.

## Offscreen renderer and pool (m4: `engine/src/three/offscreen.ts`)

Copy `components/AepComposition/model3d/ThreeOffscreenRenderer.ts` with these changes:

1. The size check compares with the renderer's real drawing-buffer size
   (`renderer.getSize(v)` / `domElement.width`) instead of cached fields, because an `EffectComposer` (m6)
   also resizes the shared renderer.
2. Drop the `__AEP_OFFSCREEN_RENDERERS__` global; expose `debugRendererCount()` (number of live pooled
   renderers) for tests instead.
3. Keep `createRendererPool` exactly (reference count + 2 s grace before dispose), and
   `acquireOffscreenRenderer(app)` / `releaseOffscreenRenderer(app)`. Drop the deprecated `getOffscreenRenderer`.
4. Keep `OffscreenGlRenderer` so unit tests inject a fake renderer.

Renderer settings stay: `alpha: true`, `antialias: true`, `preserveDrawingBuffer: true`, pixel ratio 1,
sRGB output, `ACESFilmicToneMapping`, exposure 1, `PCFShadowMap`, clear colour transparent. When a layer has
an opaque `background`, the scene's `background` is that colour.

## Building the scene (m4: `engine/src/three/build/*.ts`)

| File | What | Port from |
|------|------|-----------|
| `geometry.ts` | `buildGeometry(spec)` for box, sphere (48×32 segments), cylinder (48 radial), torus (32×96), plane | `model3d/geometry.ts` `buildPrimitiveGeometry` (keep the segment counts it uses) |
| `materials.ts` | `makeMaterial(spec, textures)` → `MeshStandardMaterial` (colour, roughness, metalness, emissive, opacity → `transparent` when < 1, `map` in sRGB) | `model3d/threeUtils.ts` `makeMaterial`, `loadTexture` |
| `dispose.ts` | `disposeObject3D(root)` (geometries, materials, textures not shared) | `model3d/threeUtils.ts` `disposeObject3D`, `isSharedTexture` |
| `lighting.ts` | `LIGHTING_PRESETS` (studio, window, golden; `none` = no rig), `createLightingRig`, `applyLightingRig`, `disposeLightingRig`, `directionFromAzimuthElevation`, `getRoomEnvironmentTexture` (PMREM of `RoomEnvironment`, cached per renderer) | `model3d/lighting.ts` (copy the preset tables exactly) |
| `shadow.ts` | `createShadowCatcher({ opacity, y, size })`: a large horizontal plane with `ShadowMaterial`, `receiveShadow`; the key light casts shadows (1024² map, camera bounds fitted to the objects' box) | `model3d/shadowFade.ts`, `model3d/framing.ts` (`SHADOW_FADE_START`, `shadowEdgeFade`) for the soft edge |
| `gltf.ts` | `loadGltf(url)`, `normalizeGltf(root, { height })`, `pickClip(clips, name)`, `clipTime(localSec, clip, { speed, loop, offset })` | `model3d/animation.ts` (`pickClip`, `animationTimeSeconds`, `HOLD_EPSILON`) |
| `object.ts` | `buildObject(spec, ctx)` → `{ root: Object3D; mixer?: AnimationMixer; action?: AnimationAction; dispose() }` | – |
| `scene.ts` | `buildScene(layer, ctx)` → `ThreeRig { scene, camera, lookAt: Vector3, objects: Map, lights: Map, mixers, dispose() }` | – |

Rules:

- **Rotations** in the spec are degrees; `buildObject` converts with `MathUtils.degToRad`, XYZ order.
- **glTF normalise**: measure `Box3` of the loaded scene; when `height` is set, uniform scale so the box height
  equals it; then centre on x and z and put the bottom on y = 0. Then apply the spec's position, rotation and
  scale on a wrapper `Group` (so tweens on `object:<id>` move the wrapper, not the normalised child).
- **glTF clip time** is stateless: `mixer.setTime(clipTime(localSec, clip, opts))` on every update, where
  `localSec = t − layer.start`. Looping: `((localSec − offset) × speed) mod clip.duration`; not looping: clamp to
  `clip.duration − HOLD_EPSILON`; before `offset`: 0. A `clip` name that is not found falls back to the first
  clip and records a warning on the node (`node.warnings: string[]`).
- **Camera**: `PerspectiveCamera(fov, width / height, near, far)`; `lookAt` is a `Vector3` the node owns and
  tweens can move; `update` calls `camera.lookAt(lookAt)` and `camera.updateProjectionMatrix()` after `fov`
  changes (compare with the last applied fov).
- **Lights**: the preset rig's lights are registered as `key`, `fill`, `rim`, `ambient`; extra lights by id.
  Spot and directional lights get their `target` object added to the scene.

## ThreeNode (m4: `engine/src/three/threeNode.ts`)

```ts
export const createThreeNode: NodeFactory;     // passed to createNode as factories.three
```

- Acquires the shared renderer for `ctx.app` in its constructor and releases it in `destroy()`.
  A null `ctx.app` uses the pool's fallback owner (unit tests). When WebGL is unavailable (the renderer
  factory throws), `ready` rejects with the error and the display is an empty sprite; the doc keeps playing.
- `display` is a `Sprite` of size `width × height`; its transform comes from `applyBaseTransform` in
  `engine/src/core/transform.ts` (m1), exactly like the 2D nodes.
- `resolveTarget`: `undefined` → base 2D targets; `camera` → `camera.position.*`, `lookAt.*`, `fov`;
  `object:<id>`, `light:<id>` per the table in [02](02-timeline.md#target-paths); `postfx:<id>` → delegated to
  `this.postFx?.resolveTarget(id, prop)` (m6 fills it; m4 returns null); `filter:<id>` → null (the runtime
  handles 2D filters on every node type).
- `update(t)`: set mixers, apply `lookAt` and `fov`, call `shared.render(...)` with `draw` from postFx when
  present, then `texture.source.update()`. A render error is reported once per distinct message through
  `onError` (the node's `errors` list) and does not throw.
- `ready` resolves after every glTF and texture loaded, the rig is built and the first draw happened.
- `size()` returns `{ width, height }` of the layer.
- `destroy()` disposes the rig (geometries, materials, textures, env map not shared), the canvas texture, the
  sprite, and releases the renderer.

## Tests

| Unit (jsdom; no WebGL) | Browser (lab page / e2e) |
|------------------------|--------------------------|
| renderer pool: acquire/release/grace with fake timers, same owner → same value; `ThreeOffscreenRenderer.render` with a fake `OffscreenGlRenderer` resizes only when size changes and calls `draw` when given | the robot fixture waves, the can turns, the shadow sits under the objects |
| `buildGeometry` sizes (bounding box of a box `[1,2,3]` is 1×2×3) | seeking to the same time twice gives the same canvas hash |
| `makeMaterial` fields; `normalizeGltf` on a hand-built `Group` (height 2 → box height 2, bottom at 0, centred) | `debugRendererCount()` is 1 with two `three` layers, and 0 three seconds after unmount |
| `clipTime` table (loop, no loop, speed 2, offset, before offset) | |
| `buildScene` on a primitive-only layer: object and light maps, camera fov and aspect, degrees → radians | |
| `ThreeNode.resolveTarget` allowlist (allowed and refused paths) with a fake renderer injected | |

To test `ThreeNode` without WebGL, `createThreeNode` accepts an optional renderer factory through
`NodeContext`-free module state: export `setOffscreenRendererFactoryForTests(fn | null)` from `offscreen.ts`.
