# Ralph master plan: GSAP + Three.js engine, drop `reacthub-pixitweenjs`

Draft, Sun 1 Nov 2026. Branch `feat/gsap-threejs`. Freeze Tue 3 Nov 23:59 ET, submit Wed 4 Nov.

## Where things stand

| Area | State |
|------|-------|
| Engine M1 foundation, M2 timeline, M4 three builders, M6 post-fx | done, committed (Pixi era, pure parts kept) |
| Engine M3 (Pixi 2D), M5 (pixi-filters), M7 (Pixi runtime) | archived; R1 deletes the code (`engine/src/pixi`, `engine/src/filters` still on disk) |
| Engine R1 → R6, M8, T1, T2 (Three-only) | written, **0 stories run** (54 stories) |
| Director app (`server/`, `web/`, `shared/`, `scripts/`) | still on `reacthub-pixitweenjs`: 64 files, 42 uses of `AepCompositionJson`, Pixi in 25 files |
| App → engine migration | **no PRD exists** |
| S-series PRDs | `passes` flags stale: S02–S09, S12f, S16b show 0 but are built (git log). S15a–c, S16a not built |

The engine is self-contained and never imports the app. Nothing plays a director film on it yet. Removing the
library needs a second track that moves the app onto the engine.

## What the director authors today (the parity target)

Layer types written by `server/`: image (80), text (69), shape (40), video (7), precomp (3), audio (3), model3d,
stage3d, actor3d, prop3d. Plus frame keyframes, enter/exit presets, blend modes, lighting presets
(studio/window/golden/night/disco), scene precomps cut back to back.

MotionDoc today covers image, text, shape, group, three (primitives + glTF with one clip), tweens in seconds,
presets, effects. Missing: video, audio timing, scene transitions, blend modes, `night`/`disco` lighting,
skinned actors with blocking marks and clip cross-fades (the cartoon stage), frame export.

## Key decision (needs your call)

**Keep `AepCompositionJson` as the app's format and convert at the player (recommended for the hackathon).**
Vendor the subset of the AEP zod schema the app uses into `shared/aep/` (MIT, with a header), repoint the 42
imports, and add a pure `aepToMotionDoc()` adapter. Agents, prompts, review rules, chat tools and stored films
stay as they are. The npm dependency goes away. Native MotionDoc authoring is a post-hackathon track (N below).

Alternative: switch every agent and tool to write MotionDoc now. Cleaner, but touches prompts, tools, review,
fixtures and stored films 2 days before freeze.

## Tracks and PRDs

Existing PRDs keep their names. New ones are proposals (story counts are estimates).

### E: engine core (existing, unchanged)

| PRD | Stories | Delivers | Requires |
|-----|---------|----------|----------|
| `r1-three-core` | 7 | delete Pixi, one effects list, stage space, three layer on a render target | – |
| `r2-stage-2d` | 7 | image, text, shape, group nodes on Three | R1 |
| `r3-effects` | 5 | glow, drop shadow, outline, isolation, stage effects | R1 |
| `r4-runtime` | 6 | `MotionRuntime`, `<MotionPlayer>`, lab page, e2e | R2, R3 |
| `m8-showcase` | 3 | JSON Schema export, authoring guide | R4 |
| `t1-text3d-core` | 8 | 3D text, per-glyph targets, stagger, presets | R4, M8 |
| `t2-text3d-lab` | 4 | text fixture, lab, measurements | T1 |
| `r5-agent-tools` | 8 | headless bake, QA with worst frame + hint, explain codes, edit receipts + undo, CLI, capture (frames, contact sheet, depth/normal), export pack for image-to-video | R4 |
| `r6-camera` | 6 | `frameShot` (size/angle/side), rig moves pan/tilt/roll/dolly/truck/pedestal, presets cameraTo/orbit/crane/dollyZoom/handheld, stateless camera paths | R4 |

### P: engine parity with what the director needs (new)

| PRD | Stories | Delivers | Requires |
|-----|---------|----------|----------|
| `r7-media` | ~6 | `video` layer (VideoTexture, frame-accurate seek via mediabunny decode for export), `audio` layer as timing metadata only, blend modes (normal/add/multiply/screen), `night` + `disco` lighting presets | R2 |
| `r8-scenes` | ~5 | scene sequencing (`group` with start/end as a scene) + transitions between scenes: cut, crossfade, slide, wipe, zoom (render both scenes into targets, mix in one shader) | R3 |
| `r9-stage3d` | ~8 | cartoon world in the three layer: skinned glTF actors, `marks` blocking `[x, z, facing]`, clip list with cross-fades (stateless), props with `role: product`, held props (`attach`), toon look, curved backdrop + painted wall. Uses R6 `frameShot` for the locked camera | R1, R6 |
| `r10-export` | ~4 | video file from R5 capture frames: mediabunny `VideoEncoder` in the browser, audio mix from audio layers, progress + cancel | R5, R7 |

### A: move the app onto the engine (new)

| PRD | Stories | Delivers | Requires |
|-----|---------|----------|----------|
| `a1-own-schema` | ~5 | `shared/aep/` vendored schema + types + `parseAepComposition(Safe)`; repoint all `server/`, `shared/`, `scripts/` imports. Server no longer needs the library | – |
| `a2-adapter` | ~8 | pure `aepToMotionDoc(comp, assets)`: frames → seconds, keyframes → tweens, presets → PresetRef, precomps → scenes, model3d → three layer, stage3d/actor3d/prop3d → R9 shape, unsupported fields → warnings list. Golden tests on every stored film in `data*/films` | A1 (R7–R9 for full coverage, map as warnings until then) |
| `a3-player-swap` | ~6 | `web/src/player` on `<MotionPlayer>`: same `PlayerHandle`, ready signal, seek/play, `PlayerBridge`, review frame capture via `readPixel`/`toDataURL`; feature flag `ENGINE=motion\|library` until e2e passes | R4, A2 |
| `a4-selection` | ~4 | hit testing and the selection overlay on the Three stage (replace `pixiTarget.ts`), layer list | A3 |
| `a5-export-swap` | ~3 | export panel on R10; `audioPlan` kept | A3, R10 |
| `a7-review-on-engine` | ~4 | server review loop and critic use R5 QA (`bake`, worst frame, hints) and R5 capture instead of browser screenshots of the Pixi player; chat edits go through `applyEdit` receipts so undo is exact | A3, R5 |
| `a6-remove-library` | ~5 | rewrite agreement tests and dev pages (`stage-check`, `three-check`, `clip-check`, `FixturePage`), preflight engine check, drop `reacthub-pixitweenjs`, `pixi.js`, `@pixi/*`, `pixi-filters`, `@react-three/*`, `gl-transitions` from `package.json`, repo-wide lint fence | A3, A4, A5 |

### C: Three.js showcase for the demo (new, the hackathon payoff)

| PRD | Stories | Delivers | Requires |
|-----|---------|----------|----------|
| `c1-looks` | ~4 | named looks on top of R6 camera: lighting looks (incl. `night`, `disco`), rack focus via DOF, bloom/vignette/grain grade presets; shot-list vocabulary from `docs/direction/upstream/*` mapped to `frameShot` + presets | R6 |
| `c2-director-3d` | ~6 | director/crew prompts and tools learn the 3D hero shot, text3d titles, `frameShot` and camera presets; 3D review uses R5 QA 3D checks | A3, C1, T1, R5 |
| `c3-demo-films` | ~4 | hero films (`data-s19-hero3d`, `data-s20-cine`) rebuilt and featured; gallery replay on the new player; e2e on both | C2 |

### N: after the hackathon

Native MotionDoc authoring (agents write MotionDoc, delete `shared/aep` and the adapter), MSDF text, masks,
Lottie. Also S15a–c catalog and S16a forge if still wanted.

### H: housekeeping (do first, by hand, ~15 min)

- Reset stale `passes` on built S-series PRDs to true (or move them to `ralph/archive/`), so the board is honest.
- Commit or ignore the untracked `data-s19-hero3d/`, `data-s20-cine/`, `docs/direction/upstream/`.

## Waves (each lane is one worktree + one Ralph run; lanes in a wave own disjoint files)

| Wave | Lanes | Stories |
|------|-------|---------|
| 1 | R1 · A1 | 12 |
| 2 | R2 · R3 · A2 | ~20 |
| 3 | R4 · R7 · R8 | ~17 |
| 4 | A3 · R5 · R6 · M8 · T1 | ~31 |
| 5 | A4 · R9 · R10 · C1 · T2 | ~24 |
| 6 | A5 · A7 · C2 | ~13 |
| 7 | A6 · C3 | ~9 |

Total ≈ 126 stories (54 already written: R1–R6, M8, T1, T2; ~72 new). R1 is the bottleneck: nothing in E, P or
A3+ starts until it is merged. R4 is the second one: R5, R6, M8, T1 and A3 all wait on it.

## Risks and cut order

- The demo runs on the library today. Keep `ENGINE=library` as the default until A3's e2e passes on the featured
  films; flip at the end of wave 5. If A3 slips, submit on the library and show the engine in the lab and C3.
- R9 (cartoon stage) is the biggest unknown; it is behind a warning in A2, so the rest does not wait for it.
- `owns` check: R5 owns `engine/src/runtime/capture.ts`, inside R4's runtime folder; R4 must merge first (it does,
  by `requires`). R6 owns `engine/src/three/camera/*`; R9 must not edit it, only call it.
- Engine README says R runs happen in the main checkout. Parallel lanes need worktrees with the `docs/` symlinks
  (ralph/README §3), and `owns` must not overlap; `shared/` edits only in A1.

Cut first: T2 → R5 US-008 export pack → R8 transitions beyond crossfade → R10 (keep library export) → A4 → R9 → A6.
Never cut: R1–R4, R6, A1–A3, C3.
