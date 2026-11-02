# 3D stage: characters and the product in one lit scene (engine aep-31)

A cartoon shot needs characters standing next to the product, under one light, casting shadows on
one floor, moving smoothly from one action to the next. A `model3d` layer cannot do that: each one
renders alone with its own camera. The engine's aep-31 work adds a **3D stage**, which this repo
writes for the toy-studio films (S16b).

Status on 30 October 2026: the engine spec is written and the build is in progress on the engine's
`feat/aep-31-stage3d` branch. It ships as `reacthub-pixitweenjs@0.3.0-alpha.6` once the engine's gate
G1 passes. Until then nothing here can run; this page is the plan for the tests to run when it lands.

Engine spec: `reacthub-pixitweenjs/specs/features/aep-31-stage3d/implementation.md` (the schema,
section 4; the Director authoring recipe, section 17).

## How it fits

Pixi stays the compositor. Three draws the 3D part offscreen and Pixi shows it as one sprite, so the
headline, the price, captions, transitions, the critic's frame capture and every chat edit work as
they do today.

```
Layer list of a scene precomp (one timeline row each)     Drawn as
───────────────────────────────────────────────────────    ─────────────────────────────────────
plate        image                                          Pixi sprite
world        stage3d   camera, set, lights, toon style       Pixi sprite ← one offscreen Three render
  hero       actor3d   stage: "world"   ┐                     nothing of its own:
  pal        actor3d   stage: "world"   │ gathered into       drawn inside the world
  can        prop3d    stage: "world", role: "product"       the world's scene
headline     text                                           Pixi text (editable)
price        text                                           Pixi text (editable)
```

- **`stage3d`** is the world: a locked camera, the set (ground, a curved backdrop wall with a painted
  image, fog), key, fill and rim lights plus up to two spots, shadows and the toon look. Its place in
  the layer list is its draw order; its 2D transform places it like any layer.
- **`actor3d`** is one character: a rigged glTF, its height in metres, `marks` keyframes
  (`[x, z, facingDeg]`) for blocking, and a sorted list of `clips` (idle, walk, wave, …) that
  cross-fade.
- **`prop3d`** is one object: the same `source` as `model3d` (primitive, extruded outline or glTF),
  a size in metres, and position, rotation and scale keyframes. `role: "product"` marks the hero
  product (at most one per world). A prop can be held in a hand with `attach` (P1 in the engine).
- Members name their world with `stage` and have no 2D transform. Per world: at most 3 actors,
  6 props and 1 product. A 2D layer cannot parent to or matte with a member; use the world.
- Every keyframe `t` and clip `startFrame` is a composition frame, like every other layer.
- Seeking is stateless: the pose at a frame is computed from the frame alone, so the same time gives
  the same picture.

## What changes in S16b

The S16b PRD (`ralph/prd-s16b-cartoon-crew.json`) was written against the first draft, which put
actors and props inside one big `stage3d` layer. Update these stories before running Ralph on them.

| Story                                 | First draft says                       | Write instead                                                                                                                               |
| ------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| US-005 `addStage`                     | one `stage3d` layer holding everything | one `stage3d` world (camera `[0, 1.4, 6]` → `[0, 0.9, 0]`, fov 35), placed before the scene's 2D title layers                               |
| US-005 `placeActor`                   | push into `stage3d.actors[]`           | add an `actor3d` layer right after the world, `stage` = the world id, `inPoint` = when it enters                                            |
| US-005 `cueClip`                      | edit `actors[i].clips`                 | edit that `actor3d` layer's `clips`, keep them sorted, at least `fadeFrames` (default 6) apart                                              |
| US-005 `moveActor`                    | edit `actors[i].marks`                 | add `marks` keyframes on the `actor3d` layer                                                                                                |
| US-005 `placeProp` / `placeProduct3D` | `props[]` / `product`                  | a `prop3d` layer; the product gets `role: "product"`. A `model3d` product converts with the engine's `model3dToProp3d(layer, stageId)` (P1) |
| US-005 `setLightCue`                  | unchanged                              | keyframes on the world's `lights`                                                                                                           |
| US-008 critic                         | compute boxes from the stage JSON      | prefer the engine's `onStageLayout` rects (each member's screen box, with `role`), P1; keep the JSON rules as the fallback                  |
| US-010 e2e                            | "stage canvas count ≤ 2"               | unchanged: there is still one offscreen render per world                                                                                    |

Run the engine's `lintAepStage3D(comp)` (P1) after each blocking job, next to the existing
composition checks.

## When is everything ready

All of these, in this order:

1. **Engine gate G1** passes on the engine branch: the boxes in
   `reacthub-pixitweenjs/specs/features/aep-31-stage3d/validation.md` up to and including the
   visual baselines, plus `yarn test`, `npx tsc --noEmit -p .` and `yarn test:3d` in the engine repo.
2. **Published:** `reacthub-pixitweenjs@0.3.0-alpha.6` is on npm.
3. **Characters exist:** the forge (S16a) can make a rigged character and clips, or use the engine's
   generated fixtures (`toy-character.glb`, `clip-walk.glb`, `clip-jump.glb`) until it can.
4. **S16b** stories are updated per the table above and merged.

## Tests to run, in order

Each step says what passes. Stop at the first failure, write a row in `docs/todos/ENGINE-NEEDS.md`
if it is an engine fault, and do not go on to the paid steps.

### 1. Install the engine

```bash
npm i reacthub-pixitweenjs@0.3.0-alpha.6
```

Set `ralph/ENGINE_SPEC` to `reacthub-pixitweenjs@0.3.0-alpha.6`.

```bash
npm test
```

Pass: everything that passed on alpha.5 still passes (the 1.11.0 schema accepts every older film).

### 2. Nothing old broke (free)

- `/three-check.html`: the S13 can still turns, the engine still says the 3D layer drew, and two
  seeks to one time give the same hash.
- `/clip-check.html?noclip=1`: still plays through the scene 1 → 2 boundary with no error.

### 3. The stage on its own (free) — `/stage-check.html`

**To build** (S16b, or by hand before it): a dev page like `web/src/dev/three-check.tsx` that loads a
fixture copied from the engine's `public/test-fixtures/aep/stage3d/` into `fixtures/s16b/` (the
`stage3d-overlay` film and its GLBs and backdrop). It shows the engine's ready flag, any layer
errors and a canvas hash, with buttons to seek and to edit the price.

| Check      | Pass                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| Ready      | the engine says the world drew (`onRenderReady`) within 10 s, with no layer error                                  |
| Look       | the character stands beside the can on one floor, both cast shadows, the toon outline shows, the text draws on top |
| Seek       | seek 3 s, then 1 s, then 3 s: the two 3 s hashes match                                                             |
| Play       | play 0 → 4 s: idle turns into wave with no pop, the walk ends on its mark                                          |
| Price edit | change "$24" to "$19": only the price changes, the 3D picture is the same (hash of the stage area unchanged)       |
| Late entry | a member with a later `inPoint` is absent before it and present after it                                           |
| Console    | no errors; a missing-bone warning only for a clip that is meant to miss one                                        |

### 4. Crew tests with fakes (free)

```bash
npm test
```

```bash
DIRECTOR_FAKE=1 CARTOON_MODE=1 npx playwright test e2e/cartoon.spec.ts
```

Pass: the S16b unit tests (stage tools, blocking, critic checks) and the cartoon e2e from the PRD.
The test that tries to keyframe the camera gets a validation error.

### 5. One real cartoon film (paid, MG-2 of S16b)

```bash
npm run live -- s16-cartoon
```

Read the estimate, then:

```bash
npm run live -- s16-cartoon --yes
```

Record in the table below: wall time, cost (models + GPU), how many critic findings and fixes, and
your 1 to 5 score for how finished it looks.

### 6. Keep it or fall back

Keep the stage in the demo if step 5 scores 4 or better and the film plays smoothly on the demo
laptop. Otherwise fall back: several `model3d` layers over a painted plate with the camera held still.
That needs no engine work, has no shared shadows and switches clips with a hard cut. The upgrade back
to a stage later is one world layer per shot plus `model3dToProp3d` for the product.

## Measured

| Number                                                                   | Value          |
| ------------------------------------------------------------------------ | -------------- |
| Engine gate G1 (engine repo, `yarn test:3d`)                             | to be measured |
| Time from load to the first stage frame (stage-check, fixture film)      | to be measured |
| Two seeks to one time give the same picture (stage-check)                | to be measured |
| Frame rate with 3 characters and the product at 1080p on the demo laptop | to be measured |
| Wall time and cost of one cartoon film (`s16-cartoon`)                   | to be measured |
| Look, scored 1 to 5 by the owner                                         | to be measured |
