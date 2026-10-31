# Port map: reacthub-pixitweenjs (Pixi) → engine/src (Three only)

Library root: `tmp/reacthub-pixitweenjs/src`, a read-only copy inside this repo (commit in
`tmp/reacthub-pixitweenjs/SOURCE-COMMIT.txt`; it also has `specs/`, `docs/` and `test/`). Read it; never edit it;
never import it. Paths below are relative to `src/`.

**Copy** = bring the code over nearly as is. **Adapt** = take the logic or numbers, rewrite on Three.
**Idea** = read for the approach only. Status: ✅ built and kept, 🔁 to (re)build, 🗑 built in the Pixi era and deleted.

| Library | Engine | How | Status |
|---------|--------|-----|--------|
| `providers/GsapPixieContextProvider.tsx` | `core/clock.ts` | Idea: paused master timeline, update listeners | ✅ M1 |
| `components/PixiSequence/PixiSequence.tsx` | `core/visibility.ts` | Idea: start/end window from time | 🔁 R1 (moved from `pixi/`) |
| `hooks/usePixiAnimation.tsx`, `constants/animation.ts`, `utils/gsapEffects/*` (fade, slide, zoom, back, bounce, rotate, PULSE, SWING), `animationConfigs.ts` | `timeline/presets.ts`, `compile.ts` | Adapt: curves and eases as `Tween[]` builders; no `PixiPlugin` | ✅ M2 |
| `utils/blendMode.ts` | `core/transform.ts` (`blendingFor`) | Adapt: 4 modes as Three blending | 🔁 R1 |
| `hocs/AbstractContainer.tsx` (transform, anchor/pivot) | `core/transform.ts` | Idea: outer transform + pivot offset → `display` / `content` groups | 🔁 R1 |
| `components/PixiImageSprite/PixiImageSprite.tsx`, `utils/loadSpriteTexture.ts` | `stage2d/nodes/imageNode.ts`, `stage2d/textures.ts` | Adapt: sizing rules, tint, load errors; plane mesh + `TextureLoader` | 🔁 R2 |
| `components/PixiTextSprite/PixiTextSprite.tsx`, `utils/textStyleV8.ts`, `utils/fonts/fontLoader.ts`, `utils/sanitizeCanvasText.ts` | `stage2d/text/*`, `stage2d/nodes/textNode.ts` | Adapt: style fields, font loading; draw on a 2D canvas → `CanvasTexture` | 🔁 R2 |
| `components/PixiShapeLayer/drawShape.ts` | `stage2d/nodes/shapeNode.ts` | Adapt: rect, rounded rect, ellipse → `THREE.Shape` | 🔁 R2 |
| `components/PixiPreComp/PixiPreComp.tsx` | `stage2d/nodes/groupNode.ts` | Idea: nested time offset | 🔁 R2 |
| `components/AepComposition/model3d/geometry.ts`, `threeUtils.ts`, `lighting.ts`, `shadowFade.ts`, `framing.ts`, `animation.ts` | `three/build/*` | Copy | ✅ M4 |
| `components/AepComposition/model3d/Pixi3DModelLayer.tsx` | `three/threeNode.ts` | Idea: build vs per-frame split, report a render error once. Its canvas → Pixi texture path is replaced by a render target | 🔁 R1 |
| `components/AepComposition/model3d/ThreeOffscreenRenderer.ts` | – | Not needed: one renderer per player | 🗑 R1 deletes `three/offscreen.ts` |
| `components/AepComposition/Aep3DPostFx.tsx`, `types/aep/postFx.ts` | `effects/table.ts`, `effects/chain.ts` | Adapt: vanilla `postprocessing`, output into a render target | ✅ M6 → 🔁 R1 (moved, generalised) |
| `components/AepComposition/stage3d/dof.ts` | – | Idea: why a pooled renderer avoided `EffectComposer` (no longer pooled) | – |
| `hooks/useSpriteFilters.ts`, `withFiltersHook.tsx`, `withEffectsHook.tsx` (Pixi filters) | `effects/table.ts`, `effects/custom/*`, `effects/isolate.ts` | Adapt: which looks a sprite needs (blur, glow, shadow, outline, grading) → `postprocessing` effects on an isolated layer | 🔁 R3 (the M5 `filters/` port is deleted) |
| `node_modules/pixi-filters/lib/{glow,drop-shadow,outline}/*.frag` | `effects/custom/*` | Idea: shader approach for glow, drop shadow, outline (read only) | 🔁 R3 |
| `web/src/dev/three-check.tsx` (this repo) | `engine/lab/*` | Copy `hashCanvas`, double-rAF frame helper | 🔁 R1, R4 |

## Other sources (R5, R6)

| Source | Engine | How |
|--------|--------|-----|
| `tmp/three-story-controls/src/CameraRig.ts` (NYT, Apache-2.0) | `three/camera/rig.ts` | Port the camera-relative verbs with an attribution header; not its `flyTo` (runs off our clock) |
| `components/AepComposition/model3d/cameraMoves.ts` (library) | `timeline/presets.ts` camera presets | Adapt numbers for orbit, crane, dolly zoom, handheld |
| CozyClay (AGPL-3.0, not stored here) | `agent/*`, `three/camera/frameShot.ts` | Ideas only: compile → QA groups with hints, receipts/undo, JSON CLI, shot vocabulary, export pack. Never copy code |

## Read for the text extension only ([07-text3d.md](07-text3d.md))

`components/AepComposition/Aep3DTextMesh.tsx`, `utils/textLayout/typefaceMetricsProvider.ts` (ideas);
`components/AepComposition/AepMsdfTextMesh.tsx`, `utils/msdf/*` (read only, for the comparison).

## Not ported

Everything Pixi-specific (`utils/pixiExtend.ts`, `lib/pixi-essentials/*`, `PixiUnifiedTransformer`, `@pixi/react`
wiring), `importers/aep`, `types/aep`, `components/Aep*` (except the `model3d` files above), `stage3d/*`, Lottie, SVG,
Remotion, video, GIF, audio, captions, GL transitions, MSDF, text splitting and text animators, `typewriterEffect`,
`logoRevealEffects`, `lightSpeedEffect`, `flipEffects`, masks, overlays, `events/*`, `AppState*`, `filters/*`
(plate-key, edge-feather, animated-vfx, blend-mode), `model3d/toon.ts`, `model3d/sampleModel3D.ts`.
`model3d/cameraMoves.ts` (orbit, crane, dolly zoom, handheld) is a good later candidate for camera presets.
