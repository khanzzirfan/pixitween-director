# Motion: our own GSAP + Three.js engine

A small engine that lives in this repo, under `engine/`. It plays one JSON document (a `MotionDoc`) on a
Pixi stage, with GSAP as the only clock, Three.js scenes shown as Pixi sprites, 2D filters on any layer and
post-processing on 3D layers. We own every line, so we can change it the same day we need to.

It is built by porting code from `tmp/reacthub-pixitweenjs` (our library, MIT), keeping the parts that work
and dropping everything we do not need.

Branch: `feat/gsap-threejs`. The build is eight Ralph PRDs (`ralph/prd-m1-foundation.json` to `prd-m8-showcase.json`), run one after another in the
main checkout on this branch; nothing is merged to `main` by the PRDs.

## Folder layout

Everything the engine is lives in `engine/`. It is its own folder with its own `package.json` and
`tsconfig.json`, but not an npm workspace: it uses the repo's `node_modules` (adding `postprocessing` to the
root `package.json`). It never imports from `web/`, `server/` or `shared/`; an eslint rule enforces that.

```
engine/
  package.json  tsconfig.json  README.md  playwright.config.ts
  docs/        these specs
  src/         core/ schema/ timeline/ pixi/ three/ (build/, postfx/) filters/ runtime/ react/ index.ts
  fixtures/    *.json MotionDocs (+ fixtures.test.ts)
  lab/         motion-lab.tsx, three-smoke.tsx (the dev pages' code)
  e2e/         motion-lab.spec.ts
tmp/reacthub-pixitweenjs/   read-only copy of the library for agents (gitignored, not linted, never imported)
```

Outside `engine/` there are only: additive edits to the config files (`package.json`, `tsconfig.base.json`,
`web/tsconfig.json`, `web/vite.config.ts`, `vitest.config.ts`, `eslint.config.js`) and four tiny stubs in
`web/` (`motion-lab.html`, `motion-three-smoke.html` and a one-line `.tsx` for each in `web/src/dev/`),
because Vite only serves HTML from its root. The stubs just import `engine/lab/*`.

## Goals

1. **One clock.** A paused GSAP master timeline is the only source of time. Play, pause and seek all go
   through it, and every visible thing (2D transforms, 3D objects, the camera, lights, filter and
   post-processing values, glTF animation) is a function of its time.
2. **Deterministic.** Seeking to the same time twice gives the same pixels. No `Math.random`, no
   wall-clock reads, no state that depends on the order of seeks.
3. **3D is a sprite.** A `three` layer is a normal Pixi layer: it has a position, scale, rotation, alpha,
   2D filters, enter and exit presets, and sits in the layer order. Three draws it offscreen.
4. **Small surface.** Five layer types, about 15 2D filters, 7 post-processing effects, about 20 presets.
   Enough for product shots, title cards and kinetic text.
5. **Authorable by an agent.** The schema is zod, strict, with defaults, and exports JSON Schema, so a
   model can write a `MotionDoc` with tool calls later.

## Not in scope

No AEP, no Bodymovin or Lottie, no SVG, no Remotion, no video or GIF layers, no audio, no captions, no
MSDF text, no text splitting, no GL transitions, no masks or mattes, no interactive transformer, no
`stage3d` actors. No change to the director app: the existing `Player` and `AepCompositionJson` keep
working untouched. Wiring the director onto Motion is a later, separate decision (see "Later").

## Architecture

```
MotionDoc (JSON, zod-validated)                       engine/src/schema
        │
        ▼
MotionRuntime.load(doc)                               engine/src/runtime/*
   ├─ MotionClock         paused gsap timeline, fixed duration          engine/src/core/clock.ts
   ├─ assets              Pixi textures (image), glTF loaded by Three   engine/src/pixi/assets.ts
   ├─ nodes, one per layer, each a MotionNode                           engine/src/core/types.ts
   │    image · text · shape · group                                    engine/src/pixi/nodes/*
   │    three  ── Scene + Camera + lights + objects                     engine/src/three/*
   │              └─ shared offscreen WebGLRenderer ─► 2D canvas ─► Pixi Texture ─► Pixi Sprite
   │              └─ optional EffectComposer (postFx)                   engine/src/three/postfx/*
   ├─ filters on layers and on the stage (pixi-filters)                 engine/src/filters/*
   └─ tweens + presets compiled onto the clock                          engine/src/timeline/*
        │
        ▼
clock update(t) ─► visibility per node ─► node.update(t) (3D draws, time-driven filters) ─► app.render()
```

The React side is one component, `<MotionPlayer doc={…} />`, with a handle (`play`, `pause`, `seek`,
`whenReady`, `getCanvas`, `renderFrame`). The engine core is plain TypeScript classes, not React
components, which is the biggest change from the library.

## Decisions (and why)

| # | Decision | Why |
|---|----------|-----|
| D1 | The engine core is imperative TypeScript (`MotionRuntime`, nodes), with one thin React wrapper. We do **not** port `AbstractContainer`, `PixiSequence` or the `@pixi/react` component tree. | The library's React tree is where most of its bugs and hacks live (the 0.01 s seek, `@ts-nocheck`, effects that re-run per render). Plain classes are easy to unit test, deterministic, and render a frame on demand for export. |
| D2 | Port the **logic**, not the structure: the offscreen renderer and pool, lighting presets, geometry, material and disposal helpers, glTF clip timing, GSAP preset curves, filter constructors. `engine/docs/port-map.md` lists every file. | That is the part of the library that is hard won and works. |
| D3 | Time is in **seconds** in the schema (GSAP's unit). `fps` is only used for frame stepping, export and time-driven filter seeds. | GSAP is seconds-native; frames would mean converting everywhere. |
| D4 | Visibility (`start`/`end`) is computed from the clock time on every update, not by tweens. | Removes the library's zero-time `set` problem and the 0.01 s seek hack. |
| D5 | Every tween and every preset compiles to `fromTo` with `immediateRender: false`, never `overwrite`. After a build the timeline is primed with `progress(1).progress(0)` and then seeked. | Same frame, same props, whatever the order of seeks (the library learned this from parallel export shards). |
| D6 | Presets are pure functions that return `Tween[]`, compiled by the same compiler as hand-written tweens. | One code path, unit-testable on plain objects, no `gsap.registerEffect` or `PixiPlugin`. |
| D7 | Tween targets and properties come from an **allowlist** per node (`resolveTarget`). Angles are degrees in the schema, colours are hex strings. | An agent writing JSON cannot reach arbitrary object fields; the compiler converts units in one place. |
| D8 | One shared `WebGLRenderer` per Pixi application, reference counted (copied from the library). | Browsers cap live WebGL contexts at about 16. |
| D9 | 3D post-processing uses `postprocessing` (pmndrs, vanilla, not the React wrapper), one `EffectComposer` per `three` layer, drawn through the shared renderer's `draw` hook, with tone mapping as the last effect. | Same effects as the library's `Aep3DPostFx`, without needing an R3F `<Canvas>`. |
| D10 | 2D filters are a registry: type → create, apply params, tweenable keys, optional time driver. Time-driven filters (CRT, old film, godrays, glitch, noise) take their time and seed from the clock. Glitch's internal `Math.random` runs under a seeded PRNG. | Deterministic export; one place to add a filter. |
| D11 | The Pixi ticker is stopped. The runtime calls `app.render()` from the clock's update. | One loop, not two; a seek renders exactly once. |

## Spec documents

| Doc | What it defines |
|-----|-----------------|
| [01-schema.md](01-schema.md) | The `MotionDoc` JSON: every field, default, limit and validation rule |
| [02-timeline.md](02-timeline.md) | `MotionClock`, target paths, the tween compiler, presets, the determinism rules |
| [03-stage-2d.md](03-stage-2d.md) | Assets, the `MotionNode` contract, image, text, shape and group nodes |
| [04-three.md](04-three.md) | The `three` layer: offscreen renderer, scene build, lights, shadow, glTF, render loop |
| [05-filters-postfx.md](05-filters-postfx.md) | The 2D filter registry and the 3D post-processing chain |
| [06-runtime-player.md](06-runtime-player.md) | `MotionRuntime`, `<MotionPlayer>`, readiness, the lab page, the e2e checks |
| [07-text3d.md](07-text3d.md) | Extension, built after everything else by `ralph/prd-t1-text3d-core.json` and `prd-t2-text3d-lab.json`: 3D text with per-glyph animation, stagger, and its experiments |
| [port-map.md](port-map.md) | Library file → Motion file: copy, adapt or drop |

## Build plan (eight Ralph PRDs)

One PRD per phase, small enough for one Ralph run each. Sources `ralph/src/prd-m*.json` (profile `motion`:
copying from `tmp/reacthub-pixitweenjs` is allowed, the director app is off limits), built to `ralph/prd-m*.json`.

| Run | PRD | Stories | Delivers | Needs (all passed first) |
|-----|-----|---------|----------|--------------------------|
| 1 | `prd-m1-foundation` | 8 | folder, aliases, schema, fixtures, `MotionClock`, contracts | – |
| 2 | `prd-m2-timeline` | 7 | tween compiler, presets | M1 |
| 3 | `prd-m3-stage-2d` | 6 | assets, image, text, shape, group nodes, visibility | M1 |
| 4 | `prd-m4-three` | 7 | offscreen renderer pool, scene build, lights, shadow, glTF, `ThreeNode`, smoke page | M1 |
| 5 | `prd-m5-filters` | 6 | 2D filter registry, time-driven filters | M1 |
| 6 | `prd-m6-postfx` | 4 | 3D post-processing chain on `ThreeNode` | M4 |
| 7 | `prd-m7-runtime` | 6 | `MotionRuntime`, `<MotionPlayer>`, lab page, e2e determinism | M2, M3, M4, M5 |
| 8 | `prd-m8-showcase` | 3 | JSON Schema export, authoring guide, three showcase docs | M6, M7 |
| 9 | `prd-t1-text3d-core` | 8 | 3D text: schema, layout, glyph meshes, targets, stagger, presets ([07-text3d.md](07-text3d.md)) | M1 to M8 |
| 10 | `prd-t2-text3d-lab` | 4 | text fixture, lab page, measured experiments, .ttf experiment | T1 |

M2 to M5 own disjoint folders and depend only on M1, so they can run in any order, or at the same time in
separate worktrees. The seams between PRDs are fixed in M1 (`engine/src/core/types.ts`, `paths.ts`,
`transform.ts`). M1 has to pass before anything else.

Rebuild only the sources you edited (a bare `build_prds.py` rewrites every PRD and resets the `passes` flags,
director PRDs included):

```bash
python3 ralph/build_prds.py src/prd-m2-timeline.json
python3 ralph/build_prds.py --check      # validates everything, writes nothing
```

### Running

```bash
cd ~/Documents/code/trolio/pixitween-director      # main checkout, on feat/gsap-threejs
git status                                         # commit or stash unrelated changes first
export CMDC_KEY=...                                # see .ralph-tui/config.toml
ls tmp/reacthub-pixitweenjs/src | head -3          # the reference copy must be there
ralph-tui run --prd ./ralph/prd-m1-foundation.json --iterations 0     # 0 = until every story passes
# review, run the gates below, commit; then the next PRD in the table
# interrupted?  ralph-tui run --prd ./ralph/prd-m1-foundation.json --resume
```

Ralph leaves the tree uncommitted (`autoCommit = false`). After each PRD: read the stories' `notes`, run
`npm run typecheck && npm test && npm run lint` (and `npm run engine:e2e` from M7 on), commit on
`feat/gsap-threejs`, then start the next one. Concurrent runs need one git worktree each
(`git worktree add ../pixitween-m3 -b ralph/m3-stage-2d feat/gsap-threejs`, then `npm ci` and a symlink or copy
of `tmp/`, which is gitignored).

## Quality bar for every story

- `npm run typecheck`, `npm test`, `npm run lint` pass.
- No `@ts-nocheck`, no `@ts-ignore` in `engine/`. Ported files start with
  `// Ported from reacthub-pixitweenjs <path> (MIT).` and are cleaned up to strict TypeScript.
- Pure logic has unit tests (vitest, jsdom project). Anything that needs WebGL or text measurement is
  checked in the browser on the lab page (`/motion-lab.html`) or by `npm run engine:e2e`.
- `engine/` never imports from `web/`, `server/`, `shared/` or `reacthub-pixitweenjs`.

## Later (not in these PRDs)

- Frame export to video (the repo already has `mediabunny`; `renderFrame(n)` is the hook).
- An adapter from the director's composition to `MotionDoc`, or the director writing `MotionDoc` directly.
- Video layers, audio, text splitting, transitions between scenes.
- A server-side validator (`engine/src/schema` is pure zod and can be imported by the server as is).
