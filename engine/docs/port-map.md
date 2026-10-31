# Port map: reacthub-pixitweenjs → engine/src/

Library root: `tmp/reacthub-pixitweenjs/src`, a read-only copy inside this repo (commit in
`tmp/reacthub-pixitweenjs/SOURCE-COMMIT.txt`; it also has `specs/`, `docs/` and `test/`). Read it; copy what
the table says; never edit it. Paths in the table below are relative to `src/`.

**Copy** = bring the code over nearly as is (rename, strict types, drop dead code).
**Adapt** = take the logic or numbers, rewrite around Motion's contracts.
**Idea** = read it for the approach only.

## Kept

| Library file | Motion file | How | PRD |
|--------------|-------------|-----|-----|
| `providers/GsapPixieContextProvider.tsx` | `engine/src/core/clock.ts` | Idea: paused master timeline, update listeners, seek emits. No React, no events, no hacks | m1 |
| `components/PixiSequence/PixiSequence.tsx` | `engine/src/pixi/visibility.ts` | Idea: start/end window. Computed from time, not tweens | m3 |
| `hooks/usePixiAnimation.tsx` | `engine/src/timeline/presets.ts`, `compile.ts` | Adapt: enter at 0, exit at end − duration, loop in between, `immediateRender`/`overwrite` lessons | m2 |
| `constants/animation.ts` | `engine/src/timeline/presets.ts` | Copy: loop speed defaults and clamps (`DEFAULT_LOOP_ROTATIONS_PER_SEC`, min, max) | m2 |
| `utils/gsapEffects/fadeEffects.ts`, `slideEffects.ts`, `zoomEffects.ts`, `backEffects.ts`, `bounceEffects.ts`, `rotateEffects.ts`, `registerEffects.ts` (PULSE, SWING), `animationConfigs.ts` | `engine/src/timeline/presets.ts` | Adapt: curves, distances, eases and default durations, rewritten as `Tween[]` builders without `PixiPlugin` | m2 |
| `utils/textStyleV8.ts` | `engine/src/pixi/nodes/textStyle.ts` | Adapt: only the fields the schema has | m3 |
| `utils/loadSpriteTexture.ts` | `engine/src/pixi/assets.ts` | Idea: `Assets.load`, error handling | m3 |
| `components/AepComposition/model3d/ThreeOffscreenRenderer.ts` | `engine/src/three/offscreen.ts` | Copy, with the size-check change in [04](04-three.md#offscreen-renderer-and-pool-m4-enginesrcthreeoffscreents) | m4 |
| `components/AepComposition/model3d/geometry.ts` | `engine/src/three/build/geometry.ts` | Copy `buildPrimitiveGeometry` (box, sphere, cylinder); add torus and plane. Drop extrude | m4 |
| `components/AepComposition/model3d/threeUtils.ts` | `engine/src/three/build/materials.ts`, `dispose.ts` | Copy `makeMaterial` (as `MeshStandardMaterial`), `loadTexture`, `disposeObject3D`, `isSharedTexture` | m4 |
| `components/AepComposition/model3d/lighting.ts` | `engine/src/three/build/lighting.ts` | Copy: presets, rig create/apply/dispose, room environment | m4 |
| `components/AepComposition/model3d/shadowFade.ts`, `framing.ts` (`shadowEdgeFade`, `SHADOW_FADE_START`, `resolveFramingBounds`) | `engine/src/three/build/shadow.ts` | Adapt: one shadow catcher plane with a soft edge | m4 |
| `components/AepComposition/model3d/animation.ts` | `engine/src/three/build/gltf.ts` | Copy `pickClip`, `HOLD_EPSILON`; adapt `animationTimeSeconds` to seconds-in (`clipTime`) | m4 |
| `components/AepComposition/model3d/Pixi3DModelLayer.tsx` | `engine/src/three/threeNode.ts` | Idea: canvas → `Texture.from` → sprite, `texture.source.update()` after each draw, acquire/release per app, build vs per-frame split, report a render error once | m4 |
| `components/AepComposition/model3d/readiness.tsx` | `engine/src/runtime/MotionRuntime.ts` (`whenReady`) | Idea: register, mark ready, error, timeout | m7 |
| `components/AepComposition/Aep3DPostFx.tsx`, `types/aep/postFx.ts` | `engine/src/three/postfx/chain.ts` | Adapt: same five effects plus three, vanilla `postprocessing` instead of `@react-three/postprocessing` | m6 |
| `components/AepComposition/stage3d/dof.ts` | – | Idea only: why the library avoided `EffectComposer` on a pooled renderer (it owns targets and clear state). Motion uses a composer per layer and restores tone mapping; read this before m6 | m6 |
| `hooks/useSpriteFilters.ts`, `hooks/withFiltersHook.tsx`, `hooks/withEffectsHook.tsx` | `engine/src/filters/registry.ts` | Adapt: constructors for the 15 types in [05](05-filters-postfx.md), the colour-matrix presets, time-driven seeding via the clock | m5 |
| `utils/blendMode.ts` | `engine/src/core/transform.ts` | Adapt: 4 blend modes only | m1 |
| `web/src/dev/three-check.tsx` (this repo) | `engine/lab/motion-lab.tsx` | Copy `hashCanvas` and the double-rAF `frame()` helper | m7 |

## Read for the text extension only (see [07-text3d.md](07-text3d.md))

| Library file | Use |
|--------------|-----|
| `components/AepComposition/Aep3DTextMesh.tsx` | Idea: one extruded `Text3D` per glyph placed from a layout table, animator offsets per glyph |
| `utils/textLayout/typefaceMetricsProvider.ts` | Idea: glyph advance from the typeface JSON |
| `components/AepComposition/AepMsdfTextMesh.tsx`, `utils/msdf/*` | Read only, to answer what MSDF would add (experiment US-011); not ported |

## Dropped (do not port)

Everything under `importers/aep`, `types/aep` (except reading `postFx.ts`), `components/Aep*` (except the
`model3d` files above), `stage3d/*`, `PixiLottieSprite`, `PixiSVGSprite`, `PixiRemotionSprite`, `remotion/*`,
`PixiVideoSprite`, `hooks/video/*`, `PixiGifSprite`, `PixiAudioSprite`, `utils/audio/*`, `AudioContextProvider`,
`PixiCaptionsTrack`, `utils/captions/*`, `PixiGlTransition`, `utils/glTransitions/*`,
`hooks/glTransitions/*`, `utils/msdf/*`, `utils/textLayout/*`, `PixiTextSplit`, `textAnimator.ts`,
`gsapEffects/text*`, `typewriterEffect.ts`, `staggerTextEffects.ts`, `logoRevealEffects.ts`,
`lightSpeedEffect.ts`, `flipEffects.ts`, `PixiUnifiedTransformer`, `lib/pixi-essentials/*`,
`hocs/AbstractContainer.tsx`, `BorderMaskContainer`, `OverlayTilingSprite`, `drawMaskShape`, `events/*`,
`AppState*`, `ContextBridge`, `PixiStage`, `AppWrapper`, `filters/plate-key`, `filters/edge-feather`,
`filters/animated-vfx`, `filters/blend-mode`, `model3d/toon.ts`, `model3d/cameraMoves.ts`,
`model3d/sampleModel3D.ts` (keyframe sampling; GSAP replaces it).

`cameraMoves.ts` (orbit, crane, dolly zoom, handheld) is a good candidate for presets on `camera` after v1.
