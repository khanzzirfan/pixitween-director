# Motion: our own GSAP + Three.js engine (Three-only)

A small engine in `engine/` that plays one JSON document (a `MotionDoc`) with **GSAP as the only clock and
Three.js as the only renderer**. No Pixi anywhere. It is the `reacthub-pixitweenjs` library converted to Three.js:
the same idea (layers on a timeline, sprites, text, shapes, 3D models, filters, presets), the minimum set of
features, rebuilt on one `THREE.WebGLRenderer`.

Excluded: AEP, Bodymovin, Lottie, SVG, Remotion, video, GIF, audio, captions, MSDF text, GL transitions,
masks, the interactive transformer. The director app (`AepCompositionJson`, `web/src/player`) is not touched.

Branch: `feat/gsap-threejs`. Each Ralph PRD runs in the main checkout and you commit after it.

## Pixi → Three: what replaces what

| Library (Pixi) | Motion (Three) |
|----------------|----------------|
| Pixi `Application` + stage | one `WebGLRenderer`, one stage `Scene`, an `OrthographicCamera` in pixels |
| `PixiImageSprite` | image node: a plane `Mesh` with the image texture (`MeshBasicMaterial`) |
| `PixiTextSprite` | text node: text drawn on a 2D canvas → `CanvasTexture` on a plane |
| `PixiShapeLayer` (rect, ellipse) | shape node: `ShapeGeometry` (rounded rect, ellipse) + stroke ring |
| `Container` / precomp group | group node: `THREE.Group` |
| `PixiThreeSprite` / `model3d` (offscreen Three → canvas → Pixi texture) | `three` layer: its own `Scene` + `PerspectiveCamera` rendered into a `WebGLRenderTarget` on the **same** renderer, shown on a plane. No second WebGL context, no CPU copy |
| `pixi-filters` on a sprite | per-layer **effects**: the layer is rendered alone into a render target, run through a `postprocessing` effect chain, and shown on a plane |
| `@react-three/postprocessing` on the 3D scene | the same effect chain on a `three` layer's render target |
| filters on the whole stage | doc-level effects: one composer over the stage |
| `GsapPixieContext` master timeline | `MotionClock` (unchanged) |
| `gsap.registerEffect` + `PixiPlugin` | presets as pure `Tween[]` builders (unchanged) |

## Architecture

```
MotionDoc (zod)                                        engine/src/schema
   │
MotionRuntime.load(doc)                                engine/src/runtime
   ├─ MotionClock          paused GSAP timeline                         core/clock.ts
   ├─ WebGLRenderer        one per player; stage Scene + ortho camera   runtime, core/stage.ts
   ├─ nodes, one per layer (MotionNode, display = THREE.Object3D)       core/types.ts
   │    image · text · shape · group                                    stage2d/*
   │    three  → Scene + PerspectiveCamera → render target → plane      three/*
   ├─ effects: per layer (isolated render target + chain), per three layer, whole stage   effects/*
   └─ tweens + presets compiled onto the clock                          timeline/*

clock update(t) → visibility + opacity per node → render three layers and isolated layers into their
targets → render the stage (through the stage effect chain if any) → canvas
```

## Decisions

| # | Decision | Why |
|---|----------|-----|
| D1 | The core is plain TypeScript classes; one thin React component (`<MotionPlayer>`). | Testable, deterministic, renders a frame on demand. |
| D2 | Port the library's logic (lighting, glTF timing, geometry, materials, preset curves, effect params), not its React or Pixi structure. | That is the part that is hard won. |
| D3 | Time is seconds; `fps` only for frame stepping and export. | GSAP is seconds-native. |
| D4 | Visibility comes from clock time, not tweens. | No zero-time `set` problem. |
| D5 | Every tween compiles to `fromTo` with `immediateRender: false`, no `overwrite`; the timeline is primed after a build. | Same time, same pixels, whatever the seek order. |
| D6 | Presets are pure functions returning `Tween[]`. | One code path, unit-testable. |
| D7 | Tween targets come from an allowlist per node; degrees and hex colours in the schema. | Agents cannot reach arbitrary fields. |
| D8 | **One `WebGLRenderer` per player.** 3D layers and isolated 2D layers render into `WebGLRenderTarget`s on it. | No context limits, no GPU→CPU copies. |
| D9 | **One effect system** (`postprocessing`, pmndrs) for 2D layers, 3D layers and the stage, plus three small custom effects (glow, drop shadow, outline). | Replaces both `pixi-filters` and the R3F post-processing with one list. |
| D10 | Stage space is pixels: an `OrthographicCamera(0, width, 0, -height)`, doc `y` down maps to world `-y`, rotation in the doc is clockwise degrees (world `rotation.z = -deg`). 2D materials use `depthTest: false` and draw order is `renderOrder`. | The doc reads like a 2D design tool; Three's y-up stays an internal detail. |
| D11 | Colour: renderer output sRGB, no tone mapping for the stage, so a `#ff0000` shape is exactly (255, 0, 0). A `three` layer always renders through its chain, which ends in ACES tone mapping, into a target shown with `toneMapped: false`. | 2D colours match CSS; 3D keeps a filmic look. |
| D12 | GSAP's ticker drives playback; the runtime renders from the clock's update. | One loop; a seek renders exactly once. |

## Folder layout

```
engine/
  package.json  tsconfig.json  README.md  playwright.config.ts
  docs/        these specs
  src/         core/ schema/ timeline/ stage2d/ three/ (build/) effects/ runtime/ react/ index.ts
  fixtures/    *.json MotionDocs (+ fixtures.test.ts)
  lab/         motion-lab.tsx, three-smoke.tsx
  e2e/         motion-lab.spec.ts
tmp/reacthub-pixitweenjs/   read-only copy of the library (gitignored)
```

Outside `engine/`: additive config edits and tiny HTML/TSX stubs in `web/` that import `engine/lab/*` (Vite serves
HTML only from `web/`). An eslint rule forbids `pixi.js`, `pixi-filters`, `@pixi/*`, `@react-three/*` and
`reacthub-pixitweenjs` imports under `engine/`.

## Spec documents

| Doc | Defines |
|-----|---------|
| [01-schema.md](01-schema.md) | the `MotionDoc` JSON |
| [02-timeline.md](02-timeline.md) | `MotionClock`, target paths, tween compiler, presets, determinism |
| [03-stage-2d.md](03-stage-2d.md) | stage space, the `MotionNode` contract, image, text, shape, group nodes |
| [04-three.md](04-three.md) | the `three` layer: scene build, lights, shadow, glTF, render target |
| [05-effects.md](05-effects.md) | the effect list, custom effects, layer isolation, stage effects |
| [06-runtime-player.md](06-runtime-player.md) | `MotionRuntime`, `<MotionPlayer>`, lab page, e2e |
| [07-text3d.md](07-text3d.md) | extension: 3D text with per-glyph animation |
| [port-map.md](port-map.md) | library file → engine file |

## Build plan

Already built and committed (Pixi era): M1 foundation, M2 timeline, M4 three (scene builders), M6 post-processing.
Their pure parts are kept. M3 (Pixi 2D stage) and M5 (`pixi-filters`) are deleted by R1. The old M7 (Pixi runtime)
is replaced by R4.

| Run | PRD | Stories | Delivers | Needs |
|-----|-----|---------|----------|-------|
| 1 | `prd-r1-three-core` | 7 | delete Pixi code, unified `effects` schema, Three stage space and contracts, `three` layer on a render target, effect chain with output target, smoke page | M1–M6 committed |
| 2 | `prd-r2-stage-2d` | 7 | textures, image, text, shape, group nodes, opacity propagation | R1 |
| 3 | `prd-r3-effects` | 5 | glow, drop shadow, outline effects, layer isolation, stage effects, effects fixture | R1 |
| 4 | `prd-r4-runtime` | 7 | `MotionRuntime` on `WebGLRenderer`, `<MotionPlayer>`, lab page, e2e | R2, R3 |
| 5 | `prd-m8-showcase` | 3 | JSON Schema export, authoring guide, showcase docs | R4 |
| 6 | `prd-t1-text3d-core` | 8 | 3D text: per-glyph meshes, targets, stagger, presets | M8 |
| 7 | `prd-t2-text3d-lab` | 4 | text fixture, lab page, experiments | T1 |

R2 and R3 own different folders and can run in either order. Rebuild only the sources you edit:

```bash
python3 ralph/build_prds.py src/prd-r2-stage-2d.json     # a bare build_prds.py resets every PRD's passes
python3 ralph/build_prds.py --check
```

### Running

```bash
cd ~/Documents/code/trolio/pixitween-director      # on feat/gsap-threejs, clean
export CMDC_KEY=...                                # see .ralph-tui/config.toml
ralph-tui run --prd ./ralph/prd-r1-three-core.json --iterations 0
# then: notes → npm run typecheck && npm test && npm run lint (+ npm run engine:e2e from R4) → commit → next PRD
```

## Quality bar

- `npm run typecheck`, `npm test`, `npm run lint` pass; no `@ts-nocheck` or `@ts-ignore` in `engine/`.
- Ported files start with `// Ported from reacthub-pixitweenjs <path> (MIT).`
- Pure logic is unit-tested (vitest, jsdom). Three's scene graph, geometry and materials work in jsdom; anything that
  needs WebGL is tested with an injected fake renderer and checked in the browser.
- `engine/` imports only `three`, `three/examples/jsm/*`, `postprocessing`, `gsap`, `zod`, `react`.

## Later

Frame export to video (`renderFrame(n)` is the hook), an adapter from the director's composition, video layers,
audio, scene transitions.
