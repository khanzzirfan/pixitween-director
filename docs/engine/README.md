# Engine reference for Director agents

Engine version read: `reacthub-pixitweenjs` `0.3.0-alpha.3` (`package.json:3`, local checkout). Director depends on the published alpha, which is also 0.3.0-alpha.3 per the owner, so no version difference is known; if a published build lacks something cited here, record it in `ENGINE-NEEDS.md`.

Read this before changing the Player, composition JSON, or timeline. The engine is a browser renderer, not a general-purpose server library. Claims below are based on the source references shown; the engine checkout is exposed read-only through `src-types/` and `CLAUDE.md` symlinks.

## Composition JSON

`AepCompositionJson` is a strict, typed JSON representation of one composition: schema version, id, canvas size, frame rate and duration, layer array, asset map, and optional precomps/fonts/effects/theme/meta (`src/types/aep/composition.ts:52-74,76-103`). Time fields and keyframe `t` values are in frames; `fps` sets the conversion basis (`src/types/aep/transform.ts:10-25`).

This is the **minimal two-layer slice** from the engine's real `keyframe-smoke.aep.json` fixture: the shape background and image layer are preserved; image position keeps its first two real keyframes as the one animated field. The source fixture is `public/test-fixtures/aep/keyframe-smoke.aep.json:1-64` (header/assets and two layers); layer shapes and animated keyframe syntax are defined in `src/types/aep/layer.ts:181-208` and `src/types/aep/transform.ts:10-25`. This excerpt is intended to validate against the real schema.

```json
{
  "version": "1.2.0",
  "id": "keyframe-smoke",
  "width": 800,
  "height": 500,
  "fps": 30,
  "durationInFrames": 60,
  "bgColor": "#101226",
  "assets": {
    "sprite": {
      "type": "image",
      "src": "/test-fixtures/sample-image.png",
      "width": 256,
      "height": 256
    }
  },
  "layers": [
    {
      "kind": "shape",
      "id": "bg",
      "name": "Background block",
      "inPoint": 0,
      "outPoint": 60,
      "transform": {
        "position": [400, 250],
        "anchor": [400, 250],
        "scale": [1, 1],
        "rotation": 0,
        "opacity": 1
      },
      "path": { "kind": "rect", "size": [800, 500] },
      "fill": "#101226"
    },
    {
      "kind": "image",
      "id": "sprite-layer",
      "name": "Hero image",
      "inPoint": 0,
      "outPoint": 60,
      "assetId": "sprite",
      "transform": {
        "position": [
          { "t": 0, "v": [200, 250], "easeOut": [0.4, 0, 0.2, 1] },
          { "t": 30, "v": [400, 250], "easeOut": [0.4, 0, 0.2, 1] }
        ],
        "anchor": [128, 128],
        "scale": [1, 1],
        "rotation": 0,
        "opacity": 1
      }
    }
  ]
}
```

## Public imports and runtime boundary

Import from the **package root only**. `src/index.ts:1-24` first registers Pixi intrinsics, then re-exports components, providers, types, events, hooks, HOCs, utils and AEP importers. Useful exports verified in the barrel and its source: `AepComposition`, `PixiImageSprite`, `PixiSequenceWrapper` (`src/components/index.ts:1-16`, `src/components/PixiSequence/index.ts:1-2`); `GsapPixieContext`, `GsapPixieContextProvider`, `Events` (`src/providers/index.ts:1`, `src/providers/GsapPixieContextProvider.tsx:12-30,330`); `AepCompositionJson`, `AepLayer`, `AEP_SCHEMA_VERSION`, `aepCompositionSchema`, `parseAepComposition`, `parseAepCompositionSafe` (`src/types/index.ts:1-7`, `src/types/aep/index.ts:1-15`). The root also re-exports the other `src/types/aep/*` types, samplers and importers (`src/index.ts:8-24`, `src/hooks/aep/index.ts:1-31`, `src/importers/aep/index.ts:1-21`).

- `web/`: value imports from `reacthub-pixitweenjs` are allowed; use the public root. Player contract examples and seconds boundary are in `docs/hackathon/steps/step-02-director-app-skeleton/design.md:212-228` and `docs/hackathon/06-contracts.md:149`.
- `server/`, `shared/`, `scripts/`: **type-only imports only**, e.g. `import type { AepCompositionJson } from 'reacthub-pixitweenjs'`; no engine value imports (`docs/hackathon/steps/step-02-director-app-skeleton/design.md:68-82`, `docs/hackathon/06-contracts.md:84-98`).
- Do not import internal paths or reach through `node_modules` for runtime APIs: the barrel is the documented public surface (`src/index.ts:1-24`).

## Composition validation: five refinements

`aepCompositionSchema` applies these composition-level checks (`src/types/aep/composition.ts:105-213`):

1. Every layer `id` is unique (`composition.ts:108-119`).
2. A layer's optional `parent` must identify a layer in the same composition (`composition.ts:121-132`).
3. Parent chains must be acyclic (`composition.ts:134-154`).
4. Every `precomp` layer's `compId` must resolve to an asset or inline `precomps` entry; if an asset exists, its type must be `composition` (`composition.ts:156-177`).
5. `image`, `video`, `audio`, `gif`, `lottie`, and `svg` layers must reference an existing asset in the same composition (`composition.ts:179-199`).

The base object and layer objects are `.strict()`: unknown fields fail; required fields, positive dimensions/fps/duration, major-version 1, per-kind shapes, and other bounds are also checked (`composition.ts:11-17,76-103`; `layer.ts:181-208,314-341`; `transform.ts:39-49`). For compatibility with legacy text data, prefer `parseAepComposition`/`parseAepCompositionSafe`, which coerce legacy `style.align: "justify"` before schema validation (`parse.ts:5-16`).

## Runtime mental model

### Layers (≤10 lines)
- `layers` is a discriminated union keyed by `kind`; each layer needs `id`, frame range and a transform (`layer.ts:181-200,314-341`).
- The router sends image/video/etc. to matching sprites, shape/text/null to their renderers and precomp to its renderer (`CLAUDE.md:153-165`).
- Camera/light/3D layers go to the Three sub-scene, not the ordinary Pixi route (`CLAUDE.md:163-165`).
- Stacking: `AepComposition` maps `comp.layers` in array order into one container, with no reverse or zIndex in the composition or router (`AepComposition.tsx:182-190`; grep of `components/AepComposition/*.tsx` found no `reverse`/`zIndex`). So later array entries are later Pixi children. That later children paint on top is Pixi's default, not checked in engine source; put the background first. Matte source layers are skipped at top level and only render inside their matted layer (`AepComposition.tsx:182-186`, `AepLayerRouter.tsx:153-171`).

### Transforms (≤10 lines)
- A 2D transform requires position, anchor, scale, rotation and opacity; skew fields are optional (`transform.ts:37-49`).
- Each animatable property is either a static value or a non-empty keyframe array (`transform.ts:10-25`).
- Keyframe time `t` is frames; hold means step interpolation; easing is a cubic-bezier 4-tuple (`transform.ts:3-21`).
- 2D composition samples keyframes, applies anchor → scale → rotation → translate, and cascades alpha (`CLAUDE.md:167-170`).

### Parenting (≤10 lines)
- `parent` is another layer id in the same composition (`layer.ts:167-170,181-190`).
- The schema rejects missing parents and parent cycles (`composition.ts:121-154`).
- Runtime resolves parent chains to compose transforms (`CLAUDE.md:167-170`).
- For 3D layer transforms, the engine walks the 3D parent hierarchy (`CLAUDE.md:169-170`).

### Mattes (≤10 lines)
- A matted layer carries `trackMatte: { sourceId, mode }`; the source id is a layer in the same composition (`layer.ts:170-178`, `composition.ts:201-212`).
- Modes: `alpha`, `alpha-inverted`, `luma`, `luma-inverted` (`layer.ts:173-178`).
- The runtime resolves source ids and wraps matte plus source; matte alpha/shape controls transparency (`CLAUDE.md:172-176`).

### Precomps (≤10 lines)
- A precomp layer names `compId`, width and height (`layer.ts:304-312`).
- Its comp can be a composition asset or an inline `precomps[compId]` (`composition.ts:156-177`).
- Nested compositions render to a Pixi RenderTexture and display as a sprite, with their own current-frame offset (`CLAUDE.md:178-180`).
- Authoring guide says inner layers use the same master GSAP timeline and nesting max depth is 8 (`docs/AEP-TEMPLATE-AUTHORING.md:30-31`).

### GSAP master timeline (≤10 lines)
- `GsapPixieContextProvider` owns the single `tl` ref; Player controls drive its playhead (`CLAUDE.md:85-87`).
- Layer animations attach as sub-timelines at `offsetSeconds` (`CLAUDE.md:85-87`).
- Current keyframe path samples per frame and interpolates values; engine notes frame-derived component reads (`CLAUDE.md:93-101`).
- `AepComposition` derives current frame from the GSAP timeline unless `currentFrame` is supplied (`CLAUDE.md:140-142`).
- `PixiSequenceWrapper` accepts `startAt`/`endAt` in seconds and sets total duration from `endAt` (`design.md:217-228`; `src/components/PixiSequence/PixiSeqenceWrapper.tsx:5-25`).

## Slot props on `<AepComposition>`

Props are declared at `AepComposition.tsx:30-57`. Slots re-render without a remount: bind a control to one slot and change it (`CLAUDE.md` section 6).

| Prop | Type | Effect |
|---|---|---|
| `src` | `string \| unknown` | URL or already-parsed JSON (`:32`) |
| `assetMap` | `Record<assetId, AepAsset \| { src }>` | Swaps image/svg/video source by `assetId`; wins over `comp.assets` (`:33-34`; type `AepLayerProvider.tsx:9-10`) |
| `assetResolver` | `(assetId, asset) => {url,mime?}` or a promise | Custom resolve, e.g. signed URLs; default reads `comp.assets[id].src` and throws on an unknown id (`:35-37`; `AepAssetResolver.tsx:12-16`) |
| `theme` | `Record<themeKey, "#RRGGBB[AA]">` | Overrides `{ themeKey, default }` fill refs; falls back to `comp.theme`, then the ref's `default` (`:47-52`; `theme.ts:45`) |
| `textOverrides` | `Record<layerId, string>` | Replaces a text layer's `source` (`:53-56`; `AepTextOverrideContext.tsx:8`; applied `AepLayerRouter.tsx:35`) |
| `currentFrame` | `number` | Authoritative frame; if omitted, inferred from the GSAP timeline (`:38-42`, `:118-123`) |
| `onRenderReady` | `() => void` | Since alpha.4: fires once every `model3d` layer has drawn its first frame (at once when there are none). **The signal to wait for before a capture or export.** Also `useAepCompositionReady()` |
| `onLayerError` | `(layerId, error) => void` | Since alpha.4: a `model3d` image or glTF failed; the layer draws nothing (no placeholder). With no `onRenderReady`, treat the render as failed |
| `onReady` | `(comp) => void` | Fires once after parse (not a render signal); lift `width`/`fps` to the stage (`:43-45`, `:115`) |
| `onError` | `(err) => void` | Fetch and zod failures (`:46-47`) |

```tsx
<AepComposition
  src={comp}
  assetMap={{ sprite: { src: productPhotoUrl } }}   // swap the image behind assetId "sprite"
  textOverrides={{ caption: 'New caption' }}        // layer id "caption" (a text layer)
  theme={{ brand: '#ff3366' }}                      // only affects { themeKey: "brand" } fills
  onReady={(c) => setStage({ width: c.width, height: c.height, fps: c.fps })}
/>
```

Keep `assetMap`, `textOverrides` and `theme` object identities stable (useMemo) when nothing changed; `assetMap` feeds a `useMemo` keyed on it (`AepComposition.tsx:131-141`). The example is a snippet and was not compiled. Does `assetMap` need a matching `assets` entry to have `width`/`height`? Router falls back to comp size when the asset lacks them (`AepLayerRouter.tsx:63-68`), so give override entries `width`/`height` when the image is not the original size (inference, unverified).

## Layer kinds

Every layer has these base fields (`layer.ts:181-201`): required `id` (non-empty), `inPoint`, `outPoint` (frames, half-open `[in,out)`, `layer.ts:168`), `transform`; optional `name`, `startTime`, `parent`, `blendMode` (`layer.ts:21-39`), `hidden`, `masks`, `effects`, `trackMatte`, `is3D` + `transform3D` (required together, `layer.ts:329-341`). All layers are `.strict()`. Kind-specific fields on top:

| kind | Required | Optional | Schema |
|---|---|---|---|
| `image` | `assetId` | | `layer.ts:206-208` |
| `video` | `assetId` | `timeRemap`, `muted` | `layer.ts:210-218` |
| `audio` | `assetId` | `level` (>=0), `pan` (-1..1) | `layer.ts:220-228` |
| `gif` | `assetId` | | `layer.ts:230-232` |
| `lottie` | `assetId` | `speed` | `layer.ts:234-241` |
| `svg` | `assetId` | | `layer.ts:243-245` |
| `text` | `source` (animatable string), `style` | `animators`, `splitMode`, `extrusion` | `layer.ts:247-262` |
| `shape` | `path` | `fill`, `stroke`, `trimPath`, `extrusion` | `layer.ts:288-298` |
| `null` | none | | `layer.ts:300-302` |
| `precomp` | `compId`, `width`, `height` (positive) | | `layer.ts:304-312` |
| `model3d` | `viewport`, `source` | `textures`, `material`, `view`, `lighting`, `shadow`, `camera`, `bounds` | `layer.ts` `aepModel3DLayerSchema` (alpha.4, schema 1.9.0); see below |

Supporting shapes:
- `text.style` requires `font` and `size`; optional `fill` (hex or `{themeKey, default}`), `stroke`, `weight`, `italic`, `tracking`/`leading` (`letterSpacing`/`lineHeight` are deprecated aliases), `boxWidth`, `align`, `runs`, `tagStyles` (`layer.ts:130-163`).
- `shape.path.kind` is `rect` (`size`), `ellipse` (`size`), `polystar` (`starType`, `points`, `outerRadius`) or `bezier` (`path`); `position` optional on the first three (`layer.ts:42-104`). `stroke` needs `color` and `width` (`layer.ts:107-115`). `trimPath` needs `start`, `end` in 0..1 (`layer.ts:117-123`).
- Colors are `#RRGGBB` or `#RRGGBBAA` only (`layer.ts:17-19`).
- Assets: `type` is one of `image|video|audio|lottie|gif|svg|font|composition|model` (`model` is a glTF/GLB, alpha.4), `src`, optional `width`, `height`, `duration` in frames (`asset.ts:3-26`).
- `camera` and `light` are also valid kinds (`layer.ts:326-327`); they render in the Three sub-scene, not Pixi (`AepLayerRouter.tsx:35-45`). Director does not need them.

## `model3d` layers (engine `0.3.0-alpha.5`, schema 1.9.0)

Full contract and recipes: `reacthub-pixitweenjs/docs-site/docs/aep/model3d-integration.md`. What S13 relies on, checked against the source on 30 Oct:

- **Version.** The layer needs root and precomp `version` at least `1.4.0`; write `1.9.0`. The schema is strict (unknown keys fail the parse), and an unknown `textures.label`, `textures.front` or glTF `assetId` fails at parse time.
- **Sources.** `primitive` (`can`, `bottle`, `box`, `jar`, `tube`, `pouch`, optional `proportions`), `extrude` (`contour` of 3 to 2000 `[x, y]` points in image pixels with y down, animatable `depth`, `bevel`) and `gltf` (asset of type `model`; single-file `.glb`, no Draco, Meshopt or KTX2; the first clip plays from the layer's in-point).
- **Textures.** `label` wraps a primitive's body (a 2:1 image fits a can; the seam is at the back, so keep text in the middle half). `front` is a box's front face or an extrude's cap, mapped over the contour's bounding box (crop the photo to it). `side` is a colour.
- **Motion.** `view.rotation` (degrees, XYZ), `view.position`, `view.scale`, `material.roughness` and `metalness`, `lighting.key/fill/rim` and `shadow.opacity` are animatable. Keyframes are `{ t, v, easeIn?, easeOut?, hold? }` with cubic-bezier `[x1,y1,x2,y2]` handles and `t` in composition frames.
- **Lighting.** `preset` is `studio` (default), `window`, `golden` or `night`, with `environment: 'room'` for reflections without any download.
- **Viewport.** The layer is its own offscreen rectangle (16 to 4096 px a side), placed by `transform`. Nothing is drawn outside it, **including the shadow**, so leave headroom (`camera.fit` 1.3 or more). The camera is fixed on the rest pose, so `view.position` and `view.scale` show.
- **Shadow** falls on a transparent plane under the object, so it appears on whatever 2D layer is beneath (the Muse Image background) and nowhere else.
- **Draw order is array order**: put text meant to cover the product after the `model3d` layer.
- **Limits.** One WebGL renderer per Pixi `Application`; no SSR or headless without WebGL; From `0.3.0-alpha.5` Three.js is no longer bundled: `three ^0.184.0`, `@react-three/fiber`, `@react-three/drei` and `@react-three/postprocessing` are peer dependencies, so this repo installs them (added to `package.json`) and there is one shared copy; the 3-layers-at-1080p-50fps target is not measured on real hardware.

Working examples to copy (Storybook `AEP/Gallery/Model3DProduct`; open the JSON inspector beside each):

| Story | Use it for in the Director |
|---|---|
| `Can`, `BottleGolden`, `BoxNight` | the three primitive shapes and the lighting presets (`placeProduct3D`, `lightProduct`) |
| `CanWithLabel` | the cylinder-unwrapped label from the user's photo (S13a `unwrap.ts`) |
| `ExtrudeContour` | the extruded cut-out for odd shapes (S13a `contour.ts`, `prepare.ts`) |
| `ObjectMotion` | keyframed rotation, position and scale (`turnProduct`) |
| `InPrecomp` | a can inside a scene precomp with text behind and in front: the shape of every film we write |
| `MissingGltf` | a broken asset reports through `onLayerError` and draws nothing (the S13b fallback to motion) |
| `AnimatedGltf` | skinned glTF and `bounds` (not used by the Director) |
| `Model3DShowcase` | fixture-driven preset gallery (`public/test-fixtures/aep/model3d-showcase.aep.json`) |

## Effects and mattes we may use

An effect is `{ name, enabled?, params }`; `params` is a free record of strings, booleans or animatable values (`effect.ts:25-46`). The schema enum has 13 names (`effect.ts:6-20`) but only 8 have a built-in handler (`effectRegistry.ts:15-23`). Use only these; the other five (`directional-blur`, `curves`, `fill`, `tritone`, `color-balance`) validate but have no handler, and what the runtime does with them is unverified. Handlers read keyframe 0 on mount and apply per-frame values from the animated params (`effects/types.ts:15-30`, `AepLayerRouter.tsx:98-104`). Param keys and defaults:

| name | param keys (default) | Source |
|---|---|---|
| `gaussian-blur` | `blurriness` (0) | `gaussianBlur.ts:7-9` |
| `fast-box-blur` | `blur-radius` (0) | `fastBoxBlur.ts:7-9` |
| `drop-shadow` | `distance` (4), `direction` deg (135), `softness` (4), `opacity` 0..1 (0.5), `color` hex ("#000000") | `dropShadow.ts:9-14` |
| `glow` | `radius` (10), `intensity` (4), `inner-intensity` (0), `opacity` (1), `color` ("#ffffff") | `glow.ts:7-13` |
| `tint` | `white-tint` hex ("#ffffff"), `amount-to-tint` 0..100 (100) | `tint.ts:14-18` |
| `hue-saturation` | `master-hue` (0), `master-saturation` (0, /100), `master-lightness` (0, /100), `colorize` (false) | `hueSaturation.ts:11-14` |
| `levels` | `input-black` (0), `input-white` (255), `output-black` (0), `output-white` (255) | `levels.ts:15-18` |
| `brightness-contrast` | `brightness` (0), `contrast` (0) | `brightnessContrast.ts:9-10` |

Example: `{ "name": "gaussian-blur", "params": { "blurriness": 8 } }`. Param units beyond the defaults above are unverified.

Track matte: on the matted layer, `trackMatte: { sourceId, mode }`, where `mode` is `alpha|alpha-inverted|luma|luma-inverted` and `sourceId` is another layer id in the same comp (`layer.ts:173-178`). The source renders only inside the matte, wrapped around the matted layer, using a comp-sized RenderTexture (`AepLayerRouter.tsx:153-171`). Wrapper order is effects, then masks, then matte, all inside a `PixiSequence` for the in/out range (`AepLayerRouter.tsx:131-180`). A missing source id silently skips the matte at runtime (`:159-160`), though the schema already rejects it (`composition.ts:201-212`).

## Gotchas

- **No server value imports.** The engine is a browser-oriented ESM bundle; the Director design records Node/tsx import failures. This was reproduced against a stale engine dist; re-check after the P0 rebuild (`design.md:68-82,334-336`). Keep runtime values in `web/` and use type-only imports elsewhere.
- **No `exports` map.** Package metadata names `main`, `module`, `types`, and publishes `dist` (`reacthub-pixitweenjs/package.json:6-24`); the Director verification gate reports there is no `exports` map and only one ESM bundle (`design.md:321-325`). Do not assume a Node-safe schema subpath; the design says `reacthub-pixitweenjs/schema` does not exist yet (`design.md:79-82`).
- **React 19.** Engine peer dependencies include `react` and `react-dom` `^19.0.0` (`reacthub-pixitweenjs/package.json:154-`); Director is designed around React 19 (`design.md:46-48`). Keep the web app and engine on one React copy as the contracts direct (`docs/hackathon/06-contracts.md:20-25`).
- The engine root import runs `pixiExtend()` first, so importing the barrel has browser-oriented side effects (`src/index.ts:1-2`).
- `AppWrapper`, `PixiStage`, and `VideoSeekBar` are not public root exports; compose the Player from public parts (`docs/hackathon/06-contracts.md:149`, `design.md:321-323`).

## When in doubt

| Question | Open |
|---|---|
| Composition fields, strictness, cross-layer validation | `src-types/composition.ts` (source: `src/types/aep/composition.ts`) |
| Layer kinds/fields, transforms, mattes | `src-types/layer.ts`, `src-types/transform.ts` |
| Keyframe shape, easing, frames | `src-types/transform.ts` |
| Safe parse API / legacy text-align coercion | `src-types/parse.ts`, `src-types/text-runs.ts` |
| Public API/import availability | `src/index.ts`, then the relevant `src/components/index.ts`, `src/providers/index.ts`, `src/types/index.ts`, `src/hooks/index.ts`, or `src/importers/aep/index.ts` |
| Player props and composition lifecycle | `src/components/AepComposition/AepComposition.tsx`; Director wrapper contract: `docs/hackathon/steps/step-02-director-app-skeleton/design.md:212-228` |
| Layer routing and transforms | `src/components/AepComposition/AepLayerRouter.tsx`, `useAepLayerTransform.ts`, `resolveParentChain.ts` |
| Matte source resolution / rendering | `src/components/AepComposition/matteSourceIds.ts`, `src/components/AepMask/` |
| Nested composition rendering | `src/components/AepComposition/AepPrecompRenderer.tsx` |
| Master timeline / context | `src/providers/GsapPixieContextProvider.tsx`, `src/components/PixiSequence/PixiSeqenceWrapper.tsx` |
| Supported/unsupported authoring features | `docs/AEP-TEMPLATE-AUTHORING.md` |
| Engine's agent-level guide | `CLAUDE.md` symlink |
