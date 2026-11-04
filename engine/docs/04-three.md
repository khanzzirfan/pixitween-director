# 04. The `three` layer: a 3D scene inside the 2D stage

Files: `engine/src/three/build/*` (built in M4, kept), `engine/src/three/threeNode.ts` (rewritten in R1).
`three` 0.184, plain (no `@react-three/*`, no Pixi).

## How it draws (Three-only)

```
ThreeNode
  rig: scene (camera, lights, shadow catcher, objects, glTF roots)          ← build/scene.ts (M4, kept)
  target: WebGLRenderTarget(width, height)  on the player's one renderer
  chain:  buildEffectChain({ scene, camera, effects, output: target, toneMapping: true })   ← effects/chain.ts
  display: Group (layer transform) → content → plane Mesh(PlaneGeometry(width, height)) with
           MeshBasicMaterial({ map: target.texture, transparent: true, toneMapped: false })

update(t):
  glTF mixers ← clipTime(t − start); camera.lookAt(lookAt); updateProjectionMatrix() if fov changed
  chain.render(renderer)            // RenderPass → effects → ACES tone mapping → CopyPass(target)
```

Tweens move the Three objects directly (`object:<id>` wrapper position and rotation, `camera.position.z`,
`light:<id>.intensity`, `effect:<id>` params). Because the timeline sets every value before `update` runs, a seek
draws the right frame.

What changed from the M4 version: no offscreen renderer pool, no second WebGL context, no 2D canvas copy, no Pixi
`Sprite`. `engine/src/three/offscreen.ts` and its test are deleted in R1. The library's reason for the pool (many Pixi
applications hitting the ~16 context cap) does not apply: one player has one renderer.

## Building the scene (M4, kept)

| File | What |
|------|------|
| `build/geometry.ts` | box, sphere, cylinder, torus, plane |
| `build/materials.ts` | `MeshStandardMaterial` from the spec, sRGB textures |
| `build/dispose.ts` | `disposeObject3D` |
| `build/lighting.ts` | presets studio, window, golden, none; key/fill/rim/ambient rig; room environment (PMREM) |
| `build/shadow.ts` | shadow catcher plane with a soft edge, shadow camera fitted to the objects |
| `build/gltf.ts` | `loadGltf`, `normalizeGltf`, `pickClip`, `clipTime` (stateless clip time) |
| `build/object.ts`, `build/scene.ts` | `buildObject`, `buildScene`, `preloadThreeAssets` |

Rules stay as built: degrees in the spec, glTF normalised to `height` and standing on y = 0, wrapper `Group` per
object so tweens never fight normalisation, stateless clip time, `lookAt` vector owned by the node.

The room environment's PMREM texture was cached per offscreen renderer; it is now cached per `WebGLRenderer`
(a `WeakMap` keyed by the renderer).

## ThreeNode (R1: `engine/src/three/threeNode.ts`)

```ts
export const createThreeNode: NodeFactory;     // passed to createNode as factories.three
```

- Needs `ctx.renderer`. When it is null (unit tests) the node builds its rig and display and uses a fake chain from
  `setEffectChainFactoryForTests(fn | null)` (exported from `effects/chain.ts`).
- `display`/`content` from `createLayerObjects` and `applyBaseTransform` (core), size = `width × height`; the plane
  sits at `(width/2, −height/2)` in content.
- `resolveTarget`: `undefined` → base 2D targets (core); `camera` → `position.x/y/z`, `lookAt.x/y/z`, `fov`;
  `object:<id>`, `light:<id>` as before; `effect:<id>` → `chain.resolveTarget(id, prop)`.
- `applyOpacity(e)`: the plane material's `opacity = e`.
- `update(t, frame)`: mixers, lookAt, fov, `chain.render(renderer)`. A render error is added to `errors` once per
  distinct message and does not throw.
- `ready`: resolves after glTFs and textures loaded, the rig is built and the first render happened; rejects when a
  required asset failed.
- `destroy()`: disposes the rig, the chain, the target, the plane geometry and material.

## Tests

| Unit (jsdom, no WebGL) | Browser (smoke page, lab page) |
|------------------------|--------------------------------|
| everything M4 already tests for `build/*`; `ThreeNode` with `renderer: null` and a fake chain: allowlist, `effect:` routing, `update` calls `chain.render` once, `applyOpacity`, `destroy` disposes the target | robot waves, can turns, shadow under the objects, same time = same hash, transparency over a plate |
